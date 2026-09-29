// Guided scan scenario (spec ch. 7). A resumable-ish state machine driven through a "driver":
//   call(fn, ...args), setViewport(w,h), reload(), screenshot(clip?), fullPage?(), wheel(x,y,dy), mouseMove(x,y)
// Each step has a timeout; a failed step is logged and does not stop the scan.
import { analyze, analyzeScene } from './analyzer.js';

export const DEFAULT_OPTIONS = {
  breakpoints: [1440, 1024, 390],
  heights: { 1440: 900, 1024: 768, 390: 844 },
  consent: 'reject', // reject | hide | none
  maxHovers: 30,
  maxRefEffects: 10,
  mouseSweep: true,
  includeAssets: true, // study mode: download images/fonts into the pack
  maxAssetBytes: 25e6,
  scrollStepPx: 100,
  scrollStepMs: 90,
  maxScrollMs: 90000,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(p, ms, label) {
  let to;
  return Promise.race([p.finally(() => clearTimeout(to)), new Promise((_, rej) => (to = setTimeout(() => rej(new Error(`${label}: timeout after ${ms}ms`)), ms)))]);
}

export async function runScan(driver, meta, options, onProgress) {
  const o = { ...DEFAULT_OPTIONS, ...(options || {}) };
  const log = [];
  const progress = (step, label, pct) => {
    try {
      onProgress && onProgress({ step, label, pct });
    } catch (e) {
      /* ignore */
    }
  };
  const cap = {
    meta: { ...meta, date: new Date().toISOString(), dipVersion: '0.1.0' },
    breakpoints: {},
    screenshots: {},
    refFrames: [],
    hovers: [],
    assetFiles: {},
    log,
  };
  const step = async (name, ms, fn) => {
    const t0 = Date.now();
    try {
      const r = await withTimeout(Promise.resolve().then(fn), ms, name);
      log.push({ step: name, level: 'info', ms: Date.now() - t0 });
      return r;
    } catch (e) {
      log.push({ step: name, level: 'error', ms: Date.now() - t0, error: String((e && e.message) || e) });
      return undefined;
    }
  };
  const call = (fn, ...args) => driver.call(fn, ...args);
  const main = o.breakpoints[0] || 1440;
  const mainH = o.heights[main] || 900;
  let vw = main, vh = mainH;

  const shoot = async (path, clip) => {
    try {
      cap.screenshots[path] = await driver.screenshot(clip);
    } catch (e) {
      log.push({ step: 'screenshot ' + path, level: 'warn', error: String(e.message || e) });
    }
  };

  // ---------------------------------------------------------------- 1. arm & reload
  progress(1, 'arm', 2);
  await step('arm-reload', 45000, async () => {
    if (driver.capabilities.emulation) await driver.setViewport(main, mainH);
    await driver.reload();
    await sleep(300);
    const t0 = Date.now();
    let ping = null;
    while (Date.now() - t0 < 40000) {
      try {
        ping = await driver.call('ping');
        if (ping && ping.readyState !== 'loading') break;
      } catch (e) {
        /* page navigating */
      }
      await sleep(250);
    }
    if (!ping) throw new Error('probes did not answer (page blocked script injection?)');
    cap.ping = ping;
    vw = ping.vw;
    vh = ping.vh;
    cap.meta.url = ping.url;
    cap.meta.title = ping.title || cap.meta.title || null;
  });
  if (!cap.ping) {
    progress(10, 'failed', 100);
    return { cap, analysis: null, failed: true };
  }

  // ---------------------------------------------------------------- 2. intro
  progress(2, 'intro', 8);
  await step('intro', 20000, async () => {
    await call('mark', 'intro');
    const preloader = await call('detectPreloader');
    const st = await call('waitStable', 800, 9000);
    cap.intro = { ...st, preloader };
  });

  // ---------------------------------------------------------------- 3. consent
  progress(3, 'consent', 12);
  await step('consent', 8000, async () => {
    await call('mark', 'consent');
    cap.consent = await call('handleConsent', o.consent);
    if (cap.consent && cap.consent.found) await sleep(900);
  });

  // ---------------------------------------------------------------- manual recording (spec §5.5)
  if (o.manual) {
    progress(4, 'manual', 20);
    await call('mark', 'manual');
    await o.manual.waitForStop;
    await call('mark', 'manual-end');
    progress(5, 'snapshot', 40);
    const bpm = {};
    const pingM = await call('ping');
    vw = pingM.vw;
    vh = pingM.vh;
    bpm.viewport = { w: vw, h: vh };
    bpm.sections = (await step('sections', 10000, () => call('getSections'))) || [];
    bpm.dom = await step('dom', 20000, () => call('snapshotDOM', { maxNodes: 2500 }));
    bpm.tokens = await step('tokens', 30000, () => call('getTokens'));
    bpm.grid = await step('grid', 10000, () => call('getGrid'));
    cap.breakpoints[String(vw >= 1200 ? 1440 : vw)] = bpm;
    cap.tokens = bpm.tokens;
    cap.reducedMotion = { handled: !!(bpm.tokens && bpm.tokens.reducedMotionRules) };
    await step('splits', 10000, async () => (cap.splits = await call('getSplits')));
    await step('content', 10000, async () => (cap.content = await call('getContent', bpm.sections)));
    await shoot(`reference/${vw >= 1200 ? 1440 : vw}/manual-viewport.png`);
    cap.cursor = await step('cursor', 5000, () => call('findCursorCandidates'));
    return finalize(driver, cap, o, call, step, progress, log);
  }

  // ---------------------------------------------------------------- scroll system + impulse
  await step('scroll-detect', 10000, async () => {
    const detect = await call('detectScroll');
    await call('scrollToY', 0, 500);
    await call('startImpulse', 1600);
    await driver.wheel(6, Math.round(vh / 2), 100);
    const samples = await call('getImpulse');
    cap.scroll = { detect, impulse: { delta: 100, samples } };
    await call('scrollToY', 0, 400);
  });

  // ---------------------------------------------------------------- 4. scroll pass
  progress(4, 'scroll', 15);
  let sections0 = (await step('sections-pre', 10000, () => call('getSections'))) || [];
  await step('track-sections', 5000, () => call('trackRects', sections0.map((s) => s.nid)));
  await step('scroll-pass', o.maxScrollMs + 10000, async () => {
    await call('mark', 'scroll');
    cap.scene = [];
    const sample = async () => {
      const sc = await call('sceneSample').catch(() => null);
      if (sc && cap.scene.length < 600) cap.scene.push(sc);
    };
    await sample();
    const t0 = Date.now();
    let pos = await call('scrollPos');
    let docH = await call('docHeight');
    let stuck = 0;
    let nextPause = 0;
    while (Date.now() - t0 < o.maxScrollMs) {
      // wheel near the left edge: a pointer in the middle of the page would trigger hover effects while scrolling
      await driver.wheel(6, Math.round(vh / 2), o.scrollStepPx + Math.round(Math.random() * 20 - 10));
      await sleep(o.scrollStepMs + Math.round(Math.random() * 30));
      const p = await call('scrollPos');
      await sample();
      if (p <= pos + 1) stuck++;
      else stuck = 0;
      pos = p;
      if (sections0.length && nextPause < sections0.length && pos >= sections0[nextPause].top) {
        await sleep(500);
        await sample(); // décor after a section's own transition settled
        nextPause++;
      }
      if (stuck > 12) {
        docH = await call('docHeight');
        if (pos + vh >= docH - 4 || stuck > 25) break;
      }
      progress(4, 'scroll', 15 + Math.min(20, Math.round((pos / Math.max(1, docH - vh)) * 20)));
    }
    await sleep(800);
    cap.scrollPass = { reached: pos, docHeight: docH, ms: Date.now() - t0 };
  });
  // décor changes: park mid-change and wait — an intermediate colour at rest means the change is scrubbed
  cap.sceneChecks = [];
  await step('scene-checks', 20000, async () => {
    const pre = analyzeScene({ scene: cap.scene }, { sections: [] }, vh);
    for (const sh of pre.shifts.slice(0, 6)) {
      const mid = Math.round((sh.startScroll + sh.endScroll) / 2);
      await call('scrollToY', mid, 300);
      await sleep(1300);
      const sc = await call('sceneSample');
      cap.sceneChecks.push({ mid, bg: sc && sc.bg });
    }
    await call('scrollToY', 0, 300);
  });

  // ---------------------------------------------------------------- snapshots at main breakpoint
  progress(5, 'snapshot', 36);
  const snapBreakpoint = async (bp) => {
    const d = { viewport: { w: vw, h: vh } };
    await call('scrollToY', 0, 500);
    await sleep(300);
    d.sections = (await step(`sections-${bp}`, 10000, () => call('getSections'))) || [];
    d.dom = await step(`dom-${bp}`, 20000, () => call('snapshotDOM', { maxNodes: 2500 }));
    d.tokens = await step(`tokens-${bp}`, 30000, () => call('getTokens'));
    d.grid = await step(`grid-${bp}`, 10000, () => call('getGrid'));
    if (bp === main) d.mediaGroups = (await step(`media-groups-${bp}`, 8000, () => call('mediaGroups', 12))) || [];
    // section references
    for (const s of d.sections) {
      await step(`ref-${bp}-${s.id}`, 12000, async () => {
        const docH = await call('docHeight');
        const target = Math.max(0, Math.min(s.top, docH - vh));
        const real = await call('scrollToY', target, 350);
        await sleep(650);
        const offset = s.top - real;
        const h = Math.max(1, Math.min(s.height, vh - Math.max(0, offset)));
        await shoot(`reference/${bp}/${s.id}.png`, { x: 0, y: Math.max(0, offset), w: vw, h });
      });
    }
    return d;
  };
  cap.breakpoints[String(main)] = await snapBreakpoint(main);
  const tokensMain = cap.breakpoints[String(main)].tokens;
  cap.tokens = tokensMain;
  cap.reducedMotion = { handled: !!(tokensMain && tokensMain.reducedMotionRules) };
  if (driver.fullPage) await step('fullpage', 20000, async () => (cap.screenshots[`reference/fullpage-${main}.png`] = await driver.fullPage(16000)));
  await step('splits', 10000, async () => (cap.splits = await call('getSplits')));
  await step('content', 10000, async () => (cap.content = await call('getContent', cap.breakpoints[String(main)].sections)));

  // ---------------------------------------------------------------- 5. reference frames for scrubbed effects
  progress(6, 'frames', 45);
  await step('ref-frames', 90000, async () => {
    const motion = await call('collectMotion');
    const partial = analyze({ ...cap, motion, stack: [] });
    const scrub = partial.effects.filter((e) => e.trigger === 'scroll-scrub').slice(0, o.maxRefEffects);
    await call('mark', 'refs');
    for (const e of scrub) {
      const range = (e.animation && e.animation.scroll) || (e.scrollTrigger && e.scrollTrigger.startPx != null ? { startPx: e.scrollTrigger.startPx, endPx: e.scrollTrigger.endPx } : null);
      if (!range || range.startPx == null || range.endPx == null) continue;
      const nids = (e.targets || []).map((t) => t.nid).filter(Boolean);
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const y = Math.round(range.startPx + (range.endPx - range.startPx) * p);
        await call('scrollToY', y, 400);
        await sleep(450);
        const path = `reference/${main}/_frame_${cap.refFrames.length}.png`;
        await shoot(path);
        cap.refFrames.push({ nids, selectors: (e.targets || []).map((t) => t.selector), scrollY: y, p, path });
      }
    }
  });

  // ---------------------------------------------------------------- 6. hover sweep
  progress(7, 'hover', 55);
  if (driver.capabilities.trustedInput) {
    await step('hover-sweep', 150000, async () => {
      await call('mark', 'hover');
      const items = (await call('listInteractive', o.maxHovers)) || [];
      let shots = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        progress(7, 'hover', 55 + Math.round((i / Math.max(1, items.length)) * 15));
        try {
          const docH = await call('docHeight');
          await call('scrollToY', Math.max(0, Math.min(docH - vh, it.rect.y - vh / 2 + it.rect.h / 2)), 250);
          await driver.mouseMove(4, 4);
          await sleep(250);
          const r = await call('rectOf', it.nid);
          if (!r || r.y < 0 || r.y + r.h > vh || r.w < 2) continue;
          const before = await call('styleSnapshot', it.nid);
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          const pad = 24;
          const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), w: Math.min(vw, r.w + pad * 2), h: Math.min(vh, r.h + pad * 2) };
          // approach on a smoothed trajectory
          for (let k = 1; k <= 6; k++) {
            const f = k / 6;
            await driver.mouseMove(cx - (1 - f) * (r.w / 2 + 60), cy);
            await sleep(30);
          }
          await sleep(650);
          const after = await call('styleSnapshot', it.nid);
          const rAfter = await call('rectOf', it.nid);
          // magnetic probe: move pointer off-centre and see if the element follows
          let magnetic = null;
          await driver.mouseMove(cx + r.w * 0.3, cy + r.h * 0.3);
          await sleep(400);
          const rMag = await call('rectOf', it.nid);
          if (rMag && rAfter) {
            const dx = rMag.x - rAfter.x, dy = rMag.y - rAfter.y;
            if (Math.hypot(dx, dy) > 2) magnetic = { maxShiftPx: Math.round(Math.hypot(dx, dy) * 10) / 10, offsetPx: Math.round(Math.hypot(r.w * 0.3, r.h * 0.3)), strength: Math.round((Math.hypot(dx, dy) / Math.hypot(r.w * 0.3, r.h * 0.3)) * 100) / 100 };
          }
          // titles and large text: traverse slowly from left to right (letter-by-letter / scramble / skew effects)
          let sweep = false;
          if (it.heading || r.w > 320) {
            sweep = true;
            for (let k = 0; k <= 14; k++) {
              await driver.mouseMove(r.x + 4 + ((r.w - 8) * k) / 14, cy + Math.sin(k / 2) * Math.min(12, r.h / 4));
              await sleep(55);
            }
            await sleep(500);
          }
          const diff = diffStyles(before, after);
          const entry = { target: { selector: it.selector, nid: it.nid, rect: it.rect }, why: it.why, heading: !!it.heading, sweep, diff, magnetic, transition: before && before.transitions, shots: [] };
          if ((diff.length || magnetic) && shots < 24) {
            const key = `reference/${main}/hover/h${String(cap.hovers.length + 1).padStart(2, '0')}`;
            // re-shoot before/after cleanly
            await driver.mouseMove(4, 4);
            await sleep(500);
            await shoot(key + '_before.png', clip);
            await driver.mouseMove(cx, cy);
            await sleep(650);
            await shoot(key + '_after.png', clip);
            entry.shots = [key + '_before.png', key + '_after.png'];
            shots++;
          }
          cap.hovers.push(entry);
          await driver.mouseMove(4, 4);
          await sleep(200);
        } catch (e) {
          log.push({ step: 'hover ' + it.selector, level: 'warn', error: String(e.message || e) });
        }
      }
    });
  } else log.push({ step: 'hover-sweep', level: 'warn', error: 'skipped: needs trusted input (Deep mode)' });

  // ---------------------------------------------------------------- 7. free mouse movement
  progress(8, 'mouse', 72);
  if (o.mouseSweep && driver.capabilities.trustedInput) {
    await step('mouse-sweep', 40000, async () => {
      await call('mark', 'mouse');
      const secs = cap.breakpoints[String(main)].sections || [];
      const targets = [secs[0], secs.find((s, i) => i > 0 && s.height > vh * 0.6)].filter(Boolean).slice(0, 2);
      const deadline = Date.now() + 25000; // slow pages (software WebGL): stop moving, keep what was recorded
      for (const s of targets) {
        if (Date.now() > deadline) break;
        await call('scrollToY', s.top, 300);
        await sleep(300);
        for (let row = 0; row < 3 && Date.now() < deadline; row++) {
          for (let col = 0; col <= 10 && Date.now() < deadline; col++) {
            const x = row % 2 === 0 ? (col / 10) * (vw - 20) + 10 : ((10 - col) / 10) * (vw - 20) + 10;
            await driver.mouseMove(x, ((row + 1) / 4) * vh);
            await sleep(45);
          }
        }
        await sleep(300);
      }
      await driver.mouseMove(vw / 2, vh / 2);
      await sleep(300);
      cap.cursor = await call('findCursorCandidates');
    });
  } else cap.cursor = await step('cursor', 5000, () => call('findCursorCandidates'));

  // guard: an interaction must never leave the page; go back if it navigated
  const startUrl = cap.meta.url;
  const backHome = async (st) => {
    if (st && st.url && st.url.split('#')[0] !== startUrl.split('#')[0] && driver.navigate) {
      log.push({ step: 'interaction', level: 'warn', error: 'navigated to ' + st.url + ', going back' });
      await driver.navigate(startUrl);
      await sleep(2500);
      await call('waitStable', 500, 6000).catch(() => {});
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- 7b. press & hold
  cap.presses = [];
  if (driver.capabilities.trustedInput && driver.mouseDown) {
    progress(8, 'press', 73);
    await step('press-hold', 60000, async () => {
      await call('mark', 'press');
      const secs = cap.breakpoints[String(main)].sections || [];
      // neutral points (canvas / hero backgrounds often react to a long press)
      for (const s of secs.slice(0, 2)) {
        await call('scrollToY', s.top, 250);
        await sleep(300);
        const pts = [[vw * 0.5, vh * 0.55], [vw * 0.7, vh * 0.4], [vw * 0.3, vh * 0.7]];
        const pt = [];
        for (const p of pts) if (await call('isNeutralPoint', p[0], p[1])) {
          pt.push(p);
          break;
        }
        if (!pt.length) continue;
        const [x, y] = pt[0];
        await driver.mouseMove(x, y);
        await sleep(300);
        const key = `reference/${main}/press/p${String(cap.presses.length + 1).padStart(2, '0')}`;
        await shoot(key + '_before.png');
        await driver.mouseDown(x, y);
        await sleep(1300);
        await shoot(key + '_hold.png');
        await driver.mouseUp(x, y);
        await sleep(700);
        cap.presses.push({ point: [Math.round(x), Math.round(y)], section: s.id, holdMs: 1300, shots: [key + '_before.png', key + '_hold.png'], t: null });
        if (await backHome(await call('toggleState', 'body'))) break;
      }
      // buttons: :active / pressed states (released outside the button so that no click fires)
      const items = ((await call('listInteractive', 30)) || []).filter((it) => it.tag !== 'a' && !it.heading && it.why !== 'css').slice(0, 6);
      for (const it of items) {
        try {
          const docH = await call('docHeight');
          await call('scrollToY', Math.max(0, Math.min(docH - vh, it.rect.y - vh / 2)), 200);
          const r = await call('rectOf', it.nid);
          if (!r || r.y < 0 || r.y + r.h > vh) continue;
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          await driver.mouseMove(cx, cy);
          await sleep(500);
          const before = await call('styleSnapshot', it.nid);
          await driver.mouseDown(cx, cy);
          await sleep(700);
          const after = await call('styleSnapshot', it.nid);
          await driver.mouseMove(4, 4);
          await driver.mouseUp(4, 4);
          await sleep(400);
          const diff = diffStyles(before, after);
          if (diff.length) cap.presses.push({ target: { selector: it.selector, nid: it.nid, rect: it.rect }, diff, holdMs: 700 });
          if (await backHome(await call('toggleState', 'body'))) break;
        } catch (e) {
          log.push({ step: 'press ' + it.selector, level: 'warn', error: String(e.message || e) });
        }
      }
    });
  }

  // ---------------------------------------------------------------- 7c. menus, burgers, accordions, tabs
  cap.toggles = [];
  if (driver.capabilities.trustedInput) {
    progress(8, 'toggle', 75);
    await step('toggles', 90000, async () => {
      await call('mark', 'toggle');
      const list = (await call('listToggles', 8)) || [];
      for (const tg of list) {
        try {
          if (!tg.fixed) {
            const docH = await call('docHeight');
            await call('scrollToY', Math.max(0, Math.min(docH - vh, tg.rect.y - vh / 2)), 250);
          } else await call('scrollToY', 0, 250);
          const r = await call('rectOf', tg.nid);
          if (!r || r.y < 0 || r.y + r.h > vh || r.w < 2) continue;
          const before = await call('toggleState', tg.nid);
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          const key = `reference/${main}/toggle/t${String(cap.toggles.length + 1).padStart(2, '0')}`;
          await shoot(key + '_closed.png');
          await driver.mouseMove(cx, cy);
          await sleep(200);
          const t0 = await call('mark', 'toggle-' + tg.kind);
          await driver.mouseClick(cx, cy);
          const settle = await call('waitStable', 300, 3000).catch(() => null);
          await sleep(300);
          const after = await call('toggleState', tg.nid);
          if (await backHome(after)) continue;
          await shoot(key + '_open.png');
          const changed = before.expanded !== after.expanded || before.selected !== after.selected || before.open !== after.open || before.htmlClass !== after.htmlClass || before.bodyClass !== after.bodyClass || before.overlays.length !== after.overlays.length || JSON.stringify(before.controls) !== JSON.stringify(after.controls);
          cap.toggles.push({
            target: { selector: tg.selector, nid: tg.nid },
            kind: tg.kind,
            label: tg.label,
            controls: after.controls || before.controls,
            expanded: [before.expanded, after.expanded],
            changed,
            coversViewport: after.overlays.length > before.overlays.length,
            opened: { htmlClass: after.htmlClass !== before.htmlClass ? after.htmlClass : undefined, bodyOverflow: after.bodyOverflow !== before.bodyOverflow ? after.bodyOverflow : undefined, newOverlays: after.overlays.filter((o) => !before.overlays.includes(o)) },
            settleMs: settle ? settle.ms : null,
            shots: [key + '_closed.png', key + '_open.png'],
            t: t0,
          });
          // restore the initial state
          if (changed && tg.kind !== 'tab') {
            cap.toggles[cap.toggles.length - 1].closeT = await call('mark', 'toggle-close');
            const again = await call('rectOf', tg.nid);
            if (again && again.w > 0 && again.y >= 0 && again.y < vh) await driver.mouseClick(again.x + again.w / 2, again.y + again.h / 2);
            else if (driver.key) await driver.key('Escape');
            await sleep(900);
            const st = await call('toggleState', tg.nid);
            if (st.overlays.length > before.overlays.length && driver.key) {
              await driver.key('Escape');
              await sleep(700);
            }
          }
        } catch (e) {
          log.push({ step: 'toggle ' + tg.selector, level: 'warn', error: String(e.message || e) });
        }
      }
      // tabs: go back to the first tab of each group
      const firstTab = list.find((t) => t.kind === 'tab');
      if (firstTab) {
        const r = await call('rectOf', firstTab.nid).catch(() => null);
        if (r && r.y >= 0 && r.y < vh) await driver.mouseClick(r.x + r.w / 2, r.y + r.h / 2);
      }
    });
  }

  // ---------------------------------------------------------------- 7d. click feedback (navigation blocked)
  cap.clicks = [];
  if (driver.capabilities.trustedInput) {
    progress(8, 'click', 76);
    await step('clicks', 45000, async () => {
      await call('guardNav', true);
      const list = (await call('listClickables', 6)) || [];
      for (const it of list) {
        try {
          const docH = await call('docHeight');
          await call('scrollToY', Math.max(0, Math.min(docH - vh, it.rect.y - vh / 2)), 200);
          const r = await call('rectOf', it.nid);
          if (!r || r.y < 0 || r.y + r.h > vh || r.w < 2) continue;
          const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
          await driver.mouseMove(cx, cy);
          await sleep(450);
          const before = await call('styleSnapshot', it.nid);
          const y0 = await call('scrollPos');
          const t0 = await call('mark', 'click-feedback');
          await driver.mouseClick(cx, cy);
          await sleep(160);
          const during = await call('styleSnapshot', it.nid);
          await sleep(900);
          const after = await call('styleSnapshot', it.nid);
          const st = await call('toggleState', 'body');
          if (await backHome(st)) continue;
          if (Math.abs((await call('scrollPos')) - y0) > 4) continue; // the click scrolled the page: not a feedback effect
          const diff = diffStyles(before, during);
          const stays = diffStyles(before, after);
          if (diff.length || stays.length) cap.clicks.push({ target: { selector: it.selector, nid: it.nid, rect: it.rect }, diff, stays, t: t0 });
          if (st.overlays && st.overlays.length && driver.key) await driver.key('Escape');
          await driver.mouseMove(4, 4);
          await sleep(300);
        } catch (e) {
          log.push({ step: 'click ' + it.selector, level: 'warn', error: String(e.message || e) });
        }
      }
      await call('guardNav', false);
    });
  }

  // ---------------------------------------------------------------- 7e. drag (galleries, sliders)
  cap.drags = [];
  if (driver.capabilities.trustedInput && driver.mouseDown && driver.mouseDrag) {
    progress(8, 'drag', 78);
    await step('drags', 45000, async () => {
      await call('guardNav', true);
      const list = (await call('listDraggables', 3)) || [];
      for (const it of list) {
        try {
          const docH = await call('docHeight');
          await call('scrollToY', Math.max(0, Math.min(docH - vh, it.rect.y - vh / 2 + it.rect.h / 2)), 250);
          const r = await call('rectOf', it.nid);
          if (!r || r.y < 0 || r.y + r.h > vh) continue;
          const cy = r.y + r.h / 2;
          const x0 = Math.min(vw - 40, r.x + r.w * 0.7), dx = -Math.min(360, r.w * 0.45);
          const key = `reference/${main}/drag/d${String(cap.drags.length + 1).padStart(2, '0')}`;
          await driver.mouseMove(x0, cy);
          await sleep(300);
          await shoot(key + '_before.png', { x: 0, y: Math.max(0, r.y), w: vw, h: Math.min(vh - Math.max(0, r.y), r.h) });
          // content that moves by itself (marquee, autoplay) is not evidence of a drag
          const sA = await call('dragState', it.nid);
          await sleep(350);
          const s0 = await call('dragState', it.nid);
          if (!it.grab && sA && s0 && Math.abs(s0.x - sA.x) + Math.abs(s0.scrollLeft - sA.scrollLeft) > 3) continue;
          const t0 = await call('mark', 'drag');
          await driver.mouseDown(x0, cy);
          // fast flick: 10 moves in ~200 ms, then release (inertia shows after the release)
          for (let k = 1; k <= 10; k++) {
            await driver.mouseDrag(x0 + (dx * k) / 10, cy);
            await sleep(20);
          }
          const sRelease = await call('dragState', it.nid);
          await driver.mouseUp(x0 + dx, cy);
          const settle = await call('waitStable', 250, 3000).catch(() => null);
          const s1 = await call('dragState', it.nid);
          await shoot(key + '_after.png', { x: 0, y: Math.max(0, r.y), w: vw, h: Math.min(vh - Math.max(0, r.y), r.h) });
          const moved = s0 && s1 ? Math.round(s1.x - s0.x + (s0.scrollLeft - s1.scrollLeft)) : 0;
          const atRelease = s0 && sRelease ? Math.round(sRelease.x - s0.x + (s0.scrollLeft - sRelease.scrollLeft)) : 0;
          if (Math.abs(moved) > 8 || Math.abs(atRelease) > 8)
            cap.drags.push({ target: { selector: it.selector, nid: it.nid, rect: it.rect }, why: it.why, grab: it.grab, dragPx: Math.round(dx), atReleasePx: atRelease, movedPx: moved, inertia: atRelease ? Math.round((moved / atRelease) * 100) / 100 : null, settleMs: settle ? settle.ms : null, t: t0, shots: [key + '_before.png', key + '_after.png'] });
          // drag back so the page returns to its initial state
          await driver.mouseDown(x0 + dx, cy);
          for (let k = 1; k <= 10; k++) {
            await driver.mouseDrag(x0 + dx - (dx * k) / 10, cy);
            await sleep(20);
          }
          await driver.mouseUp(x0, cy);
          await sleep(900);
          if (await backHome(await call('toggleState', 'body'))) continue;
        } catch (e) {
          log.push({ step: 'drag ' + it.selector, level: 'warn', error: String(e.message || e) });
        }
      }
      await call('guardNav', false);
      await driver.mouseMove(4, 4);
    });
  }

  // ---------------------------------------------------------------- 8. breakpoints
  const others = o.breakpoints.slice(1);
  if (others.length && driver.capabilities.emulation) {
    for (let i = 0; i < others.length; i++) {
      const bp = others[i];
      progress(9, 'bp-' + bp, 76 + i * 7);
      await step(`breakpoint-${bp}`, 120000, async () => {
        await driver.setViewport(bp, o.heights[bp] || 900);
        await sleep(1200);
        const ping = await call('ping');
        vw = ping.vw;
        vh = ping.vh;
        await call('mark', 'bp-' + bp);
        await call('scrollToY', 0, 300);
        // light scroll pass to trigger reveals / lazy loading
        const docH = await call('docHeight');
        for (let y = 0; y < docH; y += Math.round(vh * 0.8)) {
          await call('scrollToY', y, 150);
          await sleep(120);
        }
        cap.breakpoints[String(bp)] = await snapBreakpoint(bp);
      });
    }
    await driver.setViewport(main, mainH);
    await sleep(1000);
    const ping = await driver.call('ping').catch(() => null);
    if (ping) {
      vw = ping.vw;
      vh = ping.vh;
    }
  } else if (others.length) log.push({ step: 'breakpoints', level: 'warn', error: 'skipped: device emulation needs Deep mode' });

  return finalize(driver, cap, o, call, step, progress, log);
}

async function finalize(driver, cap, o, call, step, progress, log) {
  // ---------------------------------------------------------------- 9. final collect
  progress(10, 'collect', 92);
  await call('mark', 'collect').catch(() => {});
  cap.stack = (await step('stack', 30000, () => call('detectStack'))) || [];
  cap.motion = (await step('motion', 30000, () => call('collectMotion'))) || {};
  await step('target-rects', 10000, async () => {
    const ids = new Set();
    const g = cap.motion.gsap || {};
    for (const c of g.calls || []) for (const t of c.targets || []) if (t.nid) ids.add(t.nid);
    for (const a of ((cap.motion.waapi || {}).animations || [])) if (a.nid) ids.add(a.nid);
    for (const st of g.scrollTriggers || []) if (st.triggerNid) ids.add(st.triggerNid);
    for (const c of g.scrollTriggerCreates || []) if (c.vars && c.vars.trigger && c.vars.trigger.nid) ids.add(c.vars.trigger.nid);
    for (const c of g.calls || []) { const tr = c.vars && c.vars.scrollTrigger && c.vars.scrollTrigger.trigger; if (tr && tr.nid) ids.add(tr.nid); }
    for (const t of ((cap.motion.recorder || {}).tracks || [])) if (t.nid) ids.add(t.nid);
    await call('scrollToY', 0, 200);
    cap.nidRects = await call('rectsFor', [...ids].slice(0, 3000));
  });
  cap.webgl = (await step('webgl', 10000, () => call('glState'))) || {};
  cap.three = (await step('three', 10000, () => call('threeState'))) || {};
  cap.lottie = (await step('lottie', 5000, () => call('lottieState'))) || [];
  // custom 3D geometry (study mode only: vertex data of the original site is never shared)
  if (o.exportMode !== 'share' && cap.three.scenes && cap.three.scenes.length) cap.threeGeometry = (await step('three-geometry', 15000, () => call('threeGeometries', 80000, 6e6))) || [];
  cap.assets = (await step('assets', 15000, () => call('getAssets'))) || {};
  cap.perf = (await step('perf', 5000, () => call('getPerf'))) || {};
  cap.errors = cap.motion.errors || [];

  if (o.includeAssets && o.exportMode !== 'share') {
    await step('asset-files', 60000, async () => {
      let total = 0;
      const want = [];
      for (const f of (cap.assets.fonts || []).slice(0, 20)) want.push(f.url);
      for (const i of (cap.assets.images || []).slice(0, 60)) if (i.url && !i.url.startsWith('data:')) want.push(i.url);
      for (const m of (cap.assets.models || []).slice(0, 5)) want.push(m.url);
      const seen = new Set();
      const deadline = Date.now() + 45000;
      for (const url of want) {
        if (Date.now() > deadline) {
          log.push({ step: 'asset-files', level: 'warn', error: 'time budget reached: some assets were not downloaded' });
          break;
        }
        if (seen.has(url) || total > o.maxAssetBytes) continue;
        seen.add(url);
        const r = await call('fetchBase64', url, 4e6).catch(() => null);
        if (!r || !r.b64) continue;
        total += r.bytes;
        let name = url.split('?')[0].split('/').pop() || 'asset';
        name = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        let path = 'assets/files/' + name;
        let k = 1;
        while (cap.assetFiles[path]) path = 'assets/files/' + k++ + '-' + name;
        cap.assetFiles[path] = r.b64;
      }
    });
  }

  await call('scrollToY', 0, 200).catch(() => {});

  // ---------------------------------------------------------------- 10. analysis
  progress(11, 'analysis', 96);
  let analysis = null;
  try {
    analysis = analyze(cap);
    renameFrames(cap, analysis);
  } catch (e) {
    log.push({ step: 'analysis', level: 'error', error: String(e.stack || e) });
  }
  progress(12, 'done', 100);
  return { cap, analysis };
}

// Rename temporary reference frames to <effectId>_pNNN.png once effect ids are final.
export function renameFrames(cap, analysis) {
  if (!analysis) return;
  for (const f of cap.refFrames || []) {
    const e = analysis.effects.find((x) => (x.targets || []).some((t) => (t.nid && f.nids.includes(t.nid)) || f.selectors.includes(t.selector)));
    const data = cap.screenshots[f.path];
    if (!data) continue;
    delete cap.screenshots[f.path];
    const bp = f.path.split('/')[1];
    const name = e ? `${e.id}_p${String(Math.round(f.p * 100)).padStart(3, '0')}` : `scroll-${f.scrollY}`;
    f.path = `reference/${bp}/${name}.png`;
    cap.screenshots[f.path] = data;
    if (e) {
      e.refFrames = e.refFrames || [];
      e.refFrames.push({ p: f.p, scrollY: f.scrollY, path: f.path });
    }
  }
}

function diffStyles(before, after) {
  const out = [];
  if (!before || !after) return out;
  const map = new Map(after.styles.map((s) => [s.sel, s]));
  for (const b of before.styles) {
    const a = map.get(b.sel);
    if (!a) continue;
    for (const k of Object.keys(b)) {
      if (k === 'sel' || k === 'nid') continue;
      if (b[k] !== a[k]) out.push({ sel: b.sel, prop: k, before: b[k], after: a[k] });
    }
  }
  return out.slice(0, 40);
}
