#!/usr/bin/env node
// dip-verify — fidelity loop (spec ch. 11). Compares a local clone with the pack's references and prints
// a report meant to be read by a coding agent. Exit code 1 when the global threshold is not met.
//
//   dip-verify --pack <dir> [--url http://localhost:5173] [--all | --section s01-hero | --tokens] [--headless]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpDriver } from '../extension/lib/cdp-driver.js';
import { measureTrack } from '../extension/lib/analyzer.js';
import { launchBrowser } from './lib/browser.js';
import { curveRms, compareInPage, hexToLab, deltaE2000 } from './lib/verify-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROBES = fs.readFileSync(path.join(__dirname, '../extension/probes/probes.js'), 'utf8');
const HEIGHTS = { 1440: 900, 1024: 768, 390: 844 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[k.slice(2)] = true;
      else {
        a[k.slice(2)] = next;
        i++;
      }
    } else a._.push(k);
  }
  return a;
}

function guessUrl(cwd) {
  for (const dir of [cwd, path.dirname(cwd)]) {
    const p = path.join(dir, 'package.json');
    if (!fs.existsSync(p)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
      const dev = (pkg.scripts && (pkg.scripts.dev || pkg.scripts.start)) || '';
      const port = /--port[= ](\d+)|-p (\d+)/.exec(dev);
      if (port) return `http://localhost:${port[1] || port[2]}`;
      if (/next/.test(dev)) return 'http://localhost:3000';
      if (/astro/.test(dev)) return 'http://localhost:4321';
      if (/vite/.test(dev)) return 'http://localhost:5173';
    } catch (e) {
      /* ignore */
    }
  }
  return 'http://localhost:5173';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packDir = path.resolve(args.pack || args._[0] || '.');
  const cfgPath = path.join(packDir, 'verify', 'dip.verify.json');
  if (!fs.existsSync(cfgPath)) {
    console.error(`✗ ${cfgPath} not found. Run dip-verify from a DIP pack folder or pass --pack <dir>.`);
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const url = args.url || guessUrl(process.cwd());
  const onlySection = typeof args.section === 'string' ? args.section : null;
  const tokensOnly = !!args.tokens && !args.all;
  const mainBp = Math.max(...cfg.breakpoints);
  const bps = args.breakpoints ? String(args.breakpoints).split(',').map(Number) : onlySection ? [mainBp] : cfg.breakpoints.slice().sort((a, b) => b - a);
  const iterFile = path.join(packDir, 'verify', '.iteration');
  const iteration = (fs.existsSync(iterFile) ? +fs.readFileSync(iterFile, 'utf8') || 0 : 0) + 1;
  fs.writeFileSync(iterFile, String(iteration));

  const { browser, context } = await launchBrowser({ headless: !!args.headless });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const driver = new CdpDriver((m, p) => cdp.send(m, p));
  await driver.init(PROBES);
  const helper = await context.newPage(); // image maths
  await helper.goto('about:blank');

  const res = { url, pack: packDir, iteration, date: new Date().toISOString(), breakpoints: {}, sections: {}, effects: {}, tokens: null, issues: [] };
  const issue = (scope, msg, gain) => res.issues.push({ scope, msg, gain: gain || 0 });
  const diffDir = path.join(packDir, 'verify', 'diff');

  const load = async (w) => {
    await driver.setViewport(w, HEIGHTS[w] || 900);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    } catch (e) {
      console.error(`✗ cannot open ${url}: ${e.message}`);
      await browser.close();
      process.exit(2);
    }
    await driver.call('waitStable', 700, 8000).catch(() => {});
    await driver.call('handleConsent', 'none').catch(() => {});
  };

  const sections = cfg.sections.filter((s) => !onlySection || s.id === onlySection);
  const effects = cfg.effects.filter((e) => !onlySection || e.section === onlySection);

  if (!tokensOnly) {
    for (const bp of bps) {
      await load(bp);
      const ping = await driver.call('ping');
      const vh = ping.vh;
      res.breakpoints[bp] = { viewport: [ping.vw, ping.vh], docHeight: ping.docHeight };
      for (const s of sections) {
        const r = (res.sections[s.id] = res.sections[s.id] || { visual: {}, layout: {}, notes: [] });
        const rect = await driver.call('rectOf', s.anchor).catch(() => null);
        if (!rect) {
          r.visual[bp] = 0;
          r.layout[bp] = 0;
          r.notes.push(`@${bp}: element ${s.anchor} not found — add data-dip-section="${s.id}" on the section root`);
          issue(s.id, `missing ${s.anchor}`, 0.05);
          continue;
        }
        // layout: section height & position
        const refH = s.height && s.height[bp];
        const hScore = refH ? clamp01(1 - Math.abs(rect.abs.h - refH) / refH) : 1;
        const refTop = bp === mainBp ? s.top : null;
        const tScore = refTop != null ? clamp01(1 - Math.abs(rect.abs.y - refTop) / Math.max(vh, refTop || 1)) : 1;
        let anchorScore = 1;
        const anchored = effects.filter((e) => e.section === s.id && e.rect && bp === mainBp);
        const ious = [];
        const secLayout = await driver.call('layoutOf', s.anchor).catch(() => null);
        for (const e of anchored) {
          const er = await driver.call('layoutOf', e.anchor).catch(() => null);
          if (!er || !secLayout) continue;
          ious.push(iou({ x: er.x, y: er.y - secLayout.y, w: er.w, h: er.h }, { x: e.rect.x, y: e.rect.y - (s.top || 0), w: e.rect.w, h: e.rect.h }));
        }
        r.layoutDetail = r.layoutDetail || {};
        r.layoutDetail[bp] = { height: r2(hScore), top: r2(tScore), anchors: r2(anchorScore) };
        if (ious.length) anchorScore = ious.reduce((a, b) => a + b, 0) / ious.length;
        r.layout[bp] = r2(0.5 * hScore + 0.2 * tScore + 0.3 * anchorScore);
        if (refH && Math.abs(rect.abs.h - refH) / refH > 0.08) r.notes.push(`@${bp}: section height ${Math.round(rect.abs.h)}px, expected ${refH}px`);
        // visual
        const refPath = s.reference && s.reference[bp] ? path.join(packDir, s.reference[bp]) : null;
        if (!refPath || !fs.existsSync(refPath)) {
          r.visual[bp] = null;
          continue;
        }
        const docH = await driver.call('docHeight');
        const target = Math.max(0, Math.min(rect.abs.y, docH - vh));
        const real = await driver.call('scrollToY', target, 350);
        await sleep(650);
        const offset = rect.abs.y - real;
        const h = Math.max(1, Math.min(rect.abs.h, vh - Math.max(0, offset)));
        const shot = await driver.screenshot({ x: 0, y: Math.max(0, offset), w: ping.vw, h });
        // media areas (proprietary assets are replaced in the clone): masked in both images, in clip coordinates
        const clipY = Math.max(0, offset);
        // time-looping effects (marquees…) are not deterministic: masked too
        const maskSel = [...cfg.masks, ...effects.filter((e) => e.trigger === 'time-loop').map((e) => e.anchor)].join(',');
        const masks = await driver.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(s.anchor)}); if (!root) return []; return [...root.querySelectorAll(${JSON.stringify(maskSel)})].map((m) => m.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0).map((b) => ({ x: b.x, y: b.y - ${clipY}, w: b.width, h: b.height })); })()`);
        const cmp = await helper.evaluate(compareInPage, { refB64: fs.readFileSync(refPath).toString('base64'), gotB64: shot, masks, width: 320 });
        r.visual[bp] = r2(cmp.ssim);
        fs.mkdirSync(path.join(diffDir, String(bp)), { recursive: true });
        fs.writeFileSync(path.join(diffDir, String(bp), s.id + '.png'), Buffer.from(cmp.diffB64, 'base64'));
        if (cmp.ssim < cfg.thresholds.visual) {
          r.notes.push(`@${bp}: visual ${r2(cmp.ssim)} (${Math.round(cmp.mismatch * 100)}% pixels differ${cmp.worst ? `, worst zone x${cmp.worst.x} y${cmp.worst.y} ${cmp.worst.w}×${cmp.worst.h}px` : ''}) — see verify/diff/${bp}/${s.id}.png`);
          issue(s.id, `visual @${bp} ${r2(cmp.ssim)}`, (cfg.thresholds.visual - cmp.ssim) * cfg.weights.visual / Math.max(1, sections.length));
        }
      }
    }

    // motion (main breakpoint)
    const main = mainBp;
    for (const e of effects) {
      if (!e.curve && e.metric !== 'hover-style' && e.metric !== 'loop-speed') continue;
      await load(main);
      const out = (res.effects[e.id] = { section: e.section, trigger: e.trigger, notes: [] });
      const present = await driver.call('rectOf', e.anchor).catch(() => null);
      if (!present) {
        out.score = 0;
        out.notes.push(`element ${e.anchor} not found — add data-dip-effect="${e.id}" on the effect target`);
        issue(e.id, `missing ${e.anchor}`, 0.03);
        continue;
      }
      try {
        if (e.metric === 'hover-style') Object.assign(out, await verifyHover(driver, e));
        else if (e.metric === 'loop-speed') Object.assign(out, await verifyLoop(driver, e));
        else if (e.trigger === 'scroll-scrub') Object.assign(out, await verifyScrub(driver, e, packDir));
        else Object.assign(out, await verifyTimed(driver, page, e, packDir));
      } catch (err) {
        out.score = 0;
        out.notes.push('verification failed: ' + err.message);
      }
      if (out.score < 1 - (e.threshold || 0.05) * 2) issue(e.id, out.notes[0] || `motion ${out.score}`, ((1 - out.score) * cfg.weights.motion) / Math.max(1, effects.length));
    }
  }

  // tokens
  if (!onlySection || tokensOnly) {
    await load(mainBp);
    res.tokens = await verifyTokens(driver, cfg);
    for (const n of res.tokens.notes.slice(0, 6)) issue('tokens', n, ((1 - res.tokens.score) * cfg.weights.tokens) / Math.max(1, res.tokens.notes.length));
  }

  await browser.close();

  // aggregate
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const vis = avg(Object.values(res.sections).flatMap((s) => Object.values(s.visual).filter((v) => v != null)));
  const lay = avg(Object.values(res.sections).flatMap((s) => Object.values(s.layout)));
  const mot = avg(Object.values(res.effects).map((e) => e.score).filter((v) => v != null));
  const tok = res.tokens ? res.tokens.score : null;
  const parts = [
    ['visual', vis],
    ['layout', lay],
    ['motion', mot],
    ['tokens', tok],
  ].filter(([, v]) => v != null);
  const wsum = parts.reduce((a, [k]) => a + cfg.weights[k], 0) || 1;
  const S = parts.reduce((a, [k, v]) => a + cfg.weights[k] * v, 0) / wsum;
  res.scores = { global: r2(S), visual: vis != null ? r2(vis) : null, layout: lay != null ? r2(lay) : null, motion: mot != null ? r2(mot) : null, tokens: tok != null ? r2(tok) : null };
  res.pass = S >= cfg.thresholds.global;

  const md = report(res, cfg, onlySection);
  fs.writeFileSync(path.join(packDir, 'verify-report.md'), md);
  fs.writeFileSync(path.join(packDir, 'verify-report.json'), JSON.stringify(res, null, 2));
  console.log(md);
  process.exit(res.pass ? 0 : 1);
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

function readCurve(packDir, e) {
  if (!e.curve) return null;
  const p = path.join(packDir, e.curve);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).points : null;
}

async function pickTrack(driver, e) {
  const under = await driver.call('tracksUnder', e.anchor);
  if (!under || !under.tracked.length) return { tracks: [] };
  const rec = await driver.call('recorderData');
  const set = new Set(under.tracked);
  const tracks = rec.tracks.filter((t) => set.has(t.nid));
  return { tracks, rootNid: under.nid };
}

async function verifyTimed(driver, page, e, packDir) {
  // reload with the anchor watched from the start, then trigger (scroll into view) and record
  await driver.reload();
  await sleep(150);
  for (let i = 0; i < 20; i++) {
    const ok = await driver.call('watch', e.anchor).catch(() => false);
    if (ok) break;
    await sleep(100);
  }
  if (e.trigger === 'scroll-enter') {
    const r = await driver.call('rectOf', e.anchor);
    const ping = await driver.call('ping');
    await driver.call('scrollToY', Math.max(0, r.abs.y - ping.vh * 0.5), 200);
  }
  await sleep(((e.duration || 1) + (e.delay || 0) + (e.stagger || 0) * 10) * 1000 + 1200);
  const { tracks } = await pickTrack(driver, e);
  const ms = tracks.map((t) => measureTrack(t, { marks: [], segmentPick: 'largest' })).filter((m) => m && m.driver === 'time' && m.curve);
  const notes = [];
  if (!ms.length) return { score: 0.2, notes: ['no motion measured on the anchor or its children — is the animation implemented and triggered?'] };
  ms.sort((a, b) => a.start - b.start);
  const m = ms[0];
  const ref = readCurve(packDir, e);
  const rms = ref ? curveRms(ref, m.curve) : null;
  const thr = e.threshold || 0.05;
  const curveScore = rms == null ? 0.7 : clamp01(1 - Math.max(0, rms - thr / 2) / (thr * 4));
  let durScore = 1;
  if (e.duration) {
    const err = Math.abs(m.duration - e.duration) / e.duration;
    durScore = clamp01(1 - Math.max(0, err - 0.1) / 0.3); // ±10%: frame sampling blurs the tail of long eases
    if (err > 0.1) notes.push(`duration ${m.duration}s, expected ${e.duration}s`);
  }
  let stScore = 1;
  if (e.stagger && ms.length > 1) {
    const diffs = ms.slice(1).map((x, i) => x.start - ms[i].start).filter((d) => d >= 0).sort((a, b) => a - b);
    const st = diffs.length ? diffs[Math.floor(diffs.length / 2)] / 1000 : 0;
    const err = Math.abs(st - e.stagger);
    stScore = clamp01(1 - Math.max(0, err - 0.01) / 0.08);
    if (err > 0.01) notes.push(`stagger ${r2(st)}s, expected ${e.stagger}s`);
  }
  if (rms != null && rms > thr) notes.unshift(`curve RMS ${r2(rms)} > ${thr}: measured ease ≈ ${m.fit ? m.fit.best : '?'}${m.fit && m.fit.named !== m.fit.best ? ` (nearest named ${m.fit.named})` : ''}`);
  return { score: r2(0.6 * curveScore + 0.25 * durScore + 0.15 * stScore), rms: rms != null ? r2(rms) : null, measured: { duration: m.duration, ease: m.fit && m.fit.best }, notes };
}

async function verifyScrub(driver, e, packDir) {
  await driver.call('watch', e.anchor);
  const r = await driver.call('rectOf', e.anchor);
  const ping = await driver.call('ping');
  const start = Math.max(0, r.abs.y - ping.vh * 1.2);
  const end = r.abs.y + r.abs.h + ping.vh * 0.5;
  for (let y = start; y <= end; y += 60) {
    await driver.call('scrollToY', Math.round(y), 60);
  }
  await sleep(400);
  const { tracks } = await pickTrack(driver, e);
  const ms = tracks.map((t) => measureTrack(t, { marks: [] })).filter((m) => m && m.driver === 'scroll' && m.curve);
  if (!ms.length) return { score: 0.2, notes: ['no scroll-linked motion measured on the anchor — is it scrubbed with the scroll?'] };
  const m = ms.sort((a, b) => b.curve.length - a.curve.length)[0];
  const ref = readCurve(packDir, e);
  const rms = ref ? curveRms(ref, m.curve) : null;
  const thr = e.threshold || 0.05;
  const notes = [];
  if (rms != null && rms > thr) notes.push(`scroll curve RMS ${r2(rms)} > ${thr}: measured ease ≈ ${m.fit ? m.fit.best : '?'}`);
  let ratioScore = 1;
  if (e.scroll && e.scroll.pxPerScrollPx && m.ratio) {
    const err = Math.abs(m.ratio - e.scroll.pxPerScrollPx) / Math.max(0.01, Math.abs(e.scroll.pxPerScrollPx));
    ratioScore = clamp01(1 - Math.max(0, err - 0.1) / 0.5);
    if (err > 0.1) notes.push(`motion/scroll ratio ${m.ratio}, expected ${e.scroll.pxPerScrollPx}`);
  }
  const curveScore = rms == null ? 0.8 : clamp01(1 - Math.max(0, rms - thr / 2) / (thr * 4));
  return { score: r2(0.75 * curveScore + 0.25 * ratioScore), rms: rms != null ? r2(rms) : null, notes };
}

async function verifyLoop(driver, e) {
  await driver.call('watch', e.anchor);
  await sleep(5000);
  const { tracks } = await pickTrack(driver, e);
  const ms = tracks.map((t) => measureTrack(t, { marks: [] })).filter((m) => m && m.loop);
  if (!ms.length) return { score: 0.2, notes: ['no continuous loop measured on the anchor — is the loop running?'] };
  const m = ms[0];
  if (!e.loop || !e.loop.speedPxPerS) return { score: 1, notes: [], measured: m.loop };
  const err = Math.abs(Math.abs(m.loop.speedPxPerS) - Math.abs(e.loop.speedPxPerS)) / Math.abs(e.loop.speedPxPerS);
  const notes = err > 0.1 ? [`loop speed ${m.loop.speedPxPerS}px/s, expected ${e.loop.speedPxPerS}px/s`] : [];
  if (Math.sign(m.loop.speedPxPerS) !== Math.sign(e.loop.speedPxPerS)) notes.push('loop runs in the opposite direction');
  return { score: r2(clamp01(1 - Math.max(0, err - 0.05) / 0.5) * (notes.some((n) => n.includes('opposite')) ? 0.5 : 1)), measured: m.loop, notes };
}

async function verifyHover(driver, e) {
  const r = await driver.call('rectOf', e.anchor);
  const ping = await driver.call('ping');
  await driver.call('scrollToY', Math.max(0, r.abs.y - ping.vh / 2), 200);
  await driver.mouseMove(4, 4);
  await sleep(300);
  const before = await driver.call('styleSnapshot', e.anchor);
  const rr = await driver.call('rectOf', e.anchor);
  await driver.mouseMove(rr.x + rr.w / 2, rr.y + rr.h / 2);
  await sleep(800);
  const after = await driver.call('styleSnapshot', e.anchor);
  const changed = new Map();
  for (const b of before.styles) {
    const a = after.styles.find((x) => x.sel === b.sel);
    if (!a) continue;
    for (const k of Object.keys(b)) if (k !== 'sel' && k !== 'nid' && a[k] !== b[k]) changed.set(k, a[k]);
  }
  const want = new Map((e.hoverChanges || []).map((c) => [c.prop, c.after]));
  if (!want.size) return { score: 1, notes: [] };
  let hit = 0, exact = 0;
  const notes = [];
  for (const [prop, val] of want) {
    if (changed.has(prop)) {
      hit++;
      if (changed.get(prop) === val) exact++;
      else notes.push(`hover ${prop}: got ${changed.get(prop)}, expected ${val}`);
    } else notes.push(`hover: ${prop} does not change (expected → ${val})`);
  }
  return { score: r2((0.6 * hit + 0.4 * exact) / want.size), notes };
}

async function verifyTokens(driver, cfg) {
  const tk = await driver.call('getTokens');
  const notes = [];
  const palette = (tk.colors && tk.colors.palette) || [];
  let wsum = 0, wok = 0;
  for (const c of cfg.tokens.colors || []) {
    const w = Math.max(0.02, c.share || 0.05);
    wsum += w;
    const best = palette.reduce((m, p) => Math.min(m, deltaE2000(hexToLab(c.hex), hexToLab(p.hex))), Infinity);
    if (best < 3) wok += w;
    else if ((c.share || 0) > 0.02) notes.push(`colour ${c.hex} (${c.role}, ${Math.round((c.share || 0) * 100)}% of surface) missing — closest ΔE ${r2(best)}`);
  }
  const colorScore = wsum ? wok / wsum : 1;
  const typo = tk.typography || [];
  let tsum = 0, tok = 0;
  for (const r of cfg.tokens.typography || []) {
    tsum++;
    const tag = r.role === 'display' ? null : r.role === 'body' ? 'p' : r.role;
    const cands = typo.filter((t) => (tag ? t.tags && t.tags[tag] : true));
    const cand = r.role === 'display' ? typo.slice().sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize))[0] : cands.sort((a, b) => b.chars - a.chars)[0];
    if (!cand) {
      notes.push(`typography role ${r.role}: no matching text found`);
      continue;
    }
    const fam = (s) => String(s || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    const sizeOk = Math.abs(parseFloat(cand.fontSize) - parseFloat(r.fontSize)) <= 2;
    const famOk = fam(cand.fontFamily) === fam(r.fontFamily);
    const lhOk = r.lineHeight === 'normal' || cand.lineHeight === r.lineHeight || Math.abs(parseFloat(cand.lineHeight) - parseFloat(r.lineHeight)) <= 2;
    const wOk = String(cand.fontWeight) === String(r.fontWeight);
    const s = (sizeOk ? 0.4 : 0) + (famOk ? 0.25 : 0) + (lhOk ? 0.2 : 0) + (wOk ? 0.15 : 0);
    tok += s;
    if (!sizeOk) notes.push(`typography ${r.role}: font-size ${cand.fontSize}, expected ${r.fontSize}`);
    if (!famOk) notes.push(`typography ${r.role}: font-family ${fam(cand.fontFamily)}, expected ${fam(r.fontFamily)}`);
    if (!lhOk) notes.push(`typography ${r.role}: line-height ${cand.lineHeight}, expected ${r.lineHeight}`);
    if (!wOk) notes.push(`typography ${r.role}: font-weight ${cand.fontWeight}, expected ${r.fontWeight}`);
  }
  const typoScore = tsum ? tok / tsum : 1;
  const radii = new Set((tk.radii || []).map((x) => x.value));
  const rWant = cfg.tokens.radii || [];
  const radScore = rWant.length ? rWant.filter((r) => radii.has(r)).length / rWant.length : 1;
  if (radScore < 1) notes.push(`border radii missing: ${rWant.filter((r) => !radii.has(r)).join(', ')}`);
  return { score: r2(0.45 * colorScore + 0.45 * typoScore + 0.1 * radScore), colors: r2(colorScore), typography: r2(typoScore), radii: r2(radScore), notes };
}

function report(res, cfg, onlySection) {
  const L = [];
  const s = res.scores;
  const ok = (v, t) => (v == null ? '—' : v >= t ? `${v}` : `${v} ✗`);
  L.push(`DIP VERIFY — global score ${s.global} (target ${cfg.thresholds.global}) — iteration ${res.iteration}${onlySection ? ` — section ${onlySection}` : ''}`);
  L.push(`visual ${ok(s.visual, cfg.thresholds.visual)}  layout ${ok(s.layout, cfg.thresholds.layout)}  motion ${ok(s.motion, cfg.thresholds.motion)}  tokens ${ok(s.tokens, cfg.thresholds.tokens)}`);
  L.push('');
  const avg = (o) => {
    const v = Object.values(o).filter((x) => x != null);
    return v.length ? r2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  for (const [id, r] of Object.entries(res.sections)) {
    const fx = Object.entries(res.effects).filter(([, e]) => e.section === id);
    const mot = fx.length ? r2(fx.reduce((a, [, e]) => a + (e.score || 0), 0) / fx.length) : null;
    L.push(`${id.padEnd(22)} visual ${ok(avg(r.visual), cfg.thresholds.visual)}  layout ${ok(avg(r.layout), cfg.thresholds.layout)}  motion ${ok(mot, cfg.thresholds.motion)}`);
    for (const n of r.notes) L.push(`  ✗ ${n}`);
    for (const [eid, e] of fx) {
      if (e.score >= 0.9 && !e.notes.length) L.push(`  ✓ ${eid} ${e.score}`);
      else {
        L.push(`  ✗ ${eid} : ${e.score}`);
        for (const n of e.notes) L.push(`      ${n}`);
      }
    }
  }
  const globalFx = Object.entries(res.effects).filter(([, e]) => !res.sections[e.section]);
  for (const [eid, e] of globalFx) {
    L.push(`${e.score >= 0.9 ? '✓' : '✗'} ${eid} : ${e.score}`);
    for (const n of e.notes) L.push(`      ${n}`);
  }
  if (res.tokens) {
    L.push('');
    L.push(`tokens ${res.tokens.score} (colours ${res.tokens.colors}, typography ${res.tokens.typography}, radii ${res.tokens.radii})`);
    for (const n of res.tokens.notes.slice(0, 10)) L.push(`  ✗ ${n}`);
  }
  const top = res.issues.filter((i) => i.gain > 0).sort((a, b) => b.gain - a.gain).slice(0, 3);
  if (top.length) {
    L.push('');
    L.push('Suggested priority: ' + top.map((i) => `${i.scope} (${i.msg}, est. +${r2(i.gain)})`).join(', then '));
  }
  L.push('');
  const below = ['visual', 'layout', 'motion', 'tokens'].filter((k) => s[k] != null && s[k] < cfg.thresholds[k]);
  L.push(res.pass ? `✓ PASS${below.length ? ` — but ${below.join(', ')} below target: keep iterating on the items above` : ''}` : `✗ FAIL — fix the items above and run dip-verify again`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e);
  process.exit(2);
});
