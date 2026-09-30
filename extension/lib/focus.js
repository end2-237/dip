// Focus analysis: the user circles one zone of a page, DIP replays every way the zone can be animated
// (scroll through, idle, hover, pointer, press, click, drag), records it densely, and keeps only what
// happens inside the zone. Works with the CDP driver (Deep mode) from the side panel, the dashboard or tests.
import { analyze } from './analyzer.js';
import { EFFECT_TYPES, COMMON_NAMES } from './taxonomy.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

// In-page overlay (shadow DOM, ignored by the recorder zone picking): scroll to the animation, draw around it.
export const OVERLAY = `(() => {
  if (window.__dipFocus) { window.__dipFocus.show(); return true; }
  const host = document.createElement('div');
  host.setAttribute('data-dip-overlay', '');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = \`<style>
    :host{all:initial}
    .bar{position:fixed;left:50%;top:16px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;padding:8px 8px 8px 14px;border-radius:999px;background:rgba(12,12,13,.92);color:#ecebe7;font:500 12px/1.2 -apple-system,"Segoe UI",system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);pointer-events:auto;backdrop-filter:blur(8px)}
    .bar b{font-weight:600;letter-spacing:.02em}
    button{font:inherit;height:28px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:transparent;color:inherit;cursor:pointer}
    button.p{background:#ecebe7;color:#0b0b0c;border-color:#ecebe7}
    canvas{position:fixed;inset:0;width:100vw;height:100vh;cursor:crosshair;pointer-events:none}
    canvas.on{pointer-events:auto}
    .dim{position:fixed;inset:0;background:rgba(0,0,0,.08);pointer-events:none;display:none}
  </style><div class="dim"></div><canvas></canvas><div class="bar"><b>DIP</b><span class="msg">Fais défiler jusqu’à l’animation, puis entoure-la.</span><button class="draw p">Entourer</button><button class="cancel">Annuler</button></div>\`;
  document.documentElement.appendChild(host);
  const cv = root.querySelector('canvas'), msg = root.querySelector('.msg'), bDraw = root.querySelector('.draw'), bCancel = root.querySelector('.cancel'), dim = root.querySelector('.dim');
  const ctx = cv.getContext('2d');
  let pts = [], drawing = false, box = null;
  const fit = () => { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); };
  fit(); addEventListener('resize', fit);
  const paint = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (pts.length > 1) { ctx.strokeStyle = '#ff6a3d'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
    if (box) { ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1; ctx.strokeRect(box.x, box.y, box.w, box.h); ctx.setLineDash([]); }
  };
  const api = {
    region: null, cancelled: false,
    show() { host.style.display = ''; },
    hide() { host.style.display = 'none'; },
    status(t) { msg.textContent = t; bDraw.style.display = 'none'; bCancel.style.display = 'none'; cv.classList.remove('on'); dim.style.display = 'none'; ctx.clearRect(0, 0, innerWidth, innerHeight); },
    remove() { host.remove(); delete window.__dipFocus; },
  };
  bDraw.onclick = () => {
    if (box) { // confirm
      api.region = { x: Math.round(box.x + scrollX), y: Math.round(box.y + scrollY), w: Math.round(box.w), h: Math.round(box.h), scroll: Math.round(scrollY), vw: innerWidth, vh: innerHeight };
      api.status('Analyse en cours… ne touche pas à la page.');
      return;
    }
    cv.classList.add('on'); dim.style.display = 'block';
    msg.textContent = 'Dessine un cercle autour de l’animation.';
    bDraw.textContent = 'Entourer'; bDraw.disabled = true;
  };
  bCancel.onclick = () => { if (box) { box = null; pts = []; paint(); bDraw.textContent = 'Entourer'; msg.textContent = 'Fais défiler jusqu’à l’animation, puis entoure-la.'; cv.classList.remove('on'); dim.style.display = 'none'; bDraw.disabled = false; bCancel.textContent = 'Annuler'; return; } api.cancelled = true; api.remove(); };
  cv.addEventListener('pointerdown', (e) => { drawing = true; pts = [[e.clientX, e.clientY]]; box = null; paint(); cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => { if (!drawing) return; pts.push([e.clientX, e.clientY]); paint(); });
  cv.addEventListener('pointerup', () => {
    drawing = false;
    if (pts.length < 3) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.max(0, Math.min(...xs)), y = Math.max(0, Math.min(...ys));
    box = { x, y, w: Math.min(innerWidth, Math.max(...xs)) - x, h: Math.min(innerHeight, Math.max(...ys)) - y };
    if (box.w < 12 || box.h < 12) { box = null; pts = []; paint(); return; }
    paint(); cv.classList.remove('on');
    msg.textContent = 'Zone choisie (' + Math.round(box.w) + ' × ' + Math.round(box.h) + ' px).';
    bDraw.textContent = 'Analyser cette zone'; bDraw.disabled = false; bCancel.textContent = 'Recommencer';
  });
  window.__dipFocus = api;
  return true;
})()`;

/** Wait for the user's zone (or cancellation). Programmatic region (tests): pass opts.region. */
export async function waitForRegion(driver, opts) {
  if (opts && opts.region) return opts.region;
  await driver.evaluate(OVERLAY);
  const until = Date.now() + (opts && opts.timeoutMs ? opts.timeoutMs : 15 * 60e3);
  while (Date.now() < until) {
    const st = await driver.evaluate('window.__dipFocus ? { region: window.__dipFocus.region, cancelled: window.__dipFocus.cancelled } : { cancelled: true }').catch(() => null);
    if (st && st.region) return st.region;
    if (st && st.cancelled) return null;
    await sleep(350);
  }
  return null;
}

async function status(driver, text) {
  await driver.evaluate(`window.__dipFocus && window.__dipFocus.status(${JSON.stringify(text)})`).catch(() => {});
}

/**
 * Replay the zone under every driver and collect a capture limited to it.
 * @returns {Promise<object>} focus capture
 */
export async function runFocus(driver, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress || (() => {});
  const region = await waitForRegion(driver, opts);
  if (!region) return null;
  const log = [];
  const frames = {};
  const ping = await driver.call('ping');
  const vw = ping.vw, vh = ping.vh;
  const call = (fn, ...a) => driver.call(fn, ...a);
  const step = async (name, pct, fn) => {
    onProgress({ pct, label: name });
    await status(driver, `Analyse en cours… ${name}`);
    try {
      return await fn();
    } catch (e) {
      log.push({ step: name, level: 'warn', error: String(e.message || e) });
      return null;
    }
  };
  // the zone in the viewport at a given scroll
  const clipAt = (scroll) => ({ x: Math.max(0, region.x), y: Math.max(0, region.y - scroll), w: Math.min(region.w, vw - region.x), h: Math.min(region.h, vh - Math.max(0, region.y - scroll)) });
  const shoot = async (name, scroll) => {
    const c = clipAt(scroll);
    if (c.h < 4 || c.w < 4 || c.y > vh) return;
    try {
      await driver.evaluate('window.__dipFocus && window.__dipFocus.hide()');
      frames[name] = await driver.screenshot(c);
    } finally {
      await driver.evaluate('window.__dipFocus && window.__dipFocus.show()').catch(() => {});
    }
  };
  const centre = () => ({ x: region.x + region.w / 2, y: region.y - region.scroll + region.h / 2 });

  // 0. zone at the top of the page: reload so the intro plays again under observation
  if (region.scroll < 40 && driver.reload && opts.replayLoad !== false) {
    await step('rechargement', 2, async () => {
      await driver.reload();
      await sleep(120);
      // elements appear progressively (preloaders): pick the zone several times while the intro runs
      for (let i = 0; i < 8; i++) {
        await call('mark', 'intro-reload').catch(() => {});
        await call('focusPick', region, 180).catch(() => null);
        await sleep(250);
      }
      await call('waitStable', 800, 9000).catch(() => {});
      await driver.evaluate(OVERLAY);
    });
  }
  // 1. elements of the zone, tracked densely from now on
  const picked = (await step('zone', 3, () => call('focusPick', region, 180))) || { elements: [] };
  const nids = new Set(picked.elements.map((e) => e.nid));
  if (picked.root) nids.add(picked.root.nid);
  await call('scrollToY', region.scroll, 300);
  await sleep(500);
  await shoot('00-selected', region.scroll);

  // 1. idle: loops and time-based motion
  await step('au repos', 10, async () => {
    await call('mark', 'intro-idle');
    await driver.mouseMove(4, 4);
    for (let i = 0; i < 6; i++) {
      await sleep(i ? 180 : 400);
      await shoot(`10-idle-${i}`, region.scroll);
    }
    await sleep(1500);
  });

  // 2. scroll through the zone (fine steps, down then back up)
  const docH = await call('docHeight');
  await step('défilement', 25, async () => {
    const from = Math.max(0, region.y - vh * 1.2), to = Math.min(docH - vh, region.y + region.h + vh * 0.2);
    await call('scrollToY', from, 400);
    await sleep(600);
    await call('mark', 'scroll-focus');
    const n = Math.max(12, Math.round((to - from) / 50));
    const shots = new Set([0, 0.25, 0.5, 0.75, 1].map((p) => Math.round(p * n)));
    for (let i = 0; i <= n; i++) {
      await driver.wheel(Math.min(vw - 10, region.x + 10), vh / 2, (to - from) / n);
      await sleep(70);
      if (shots.has(i)) {
        await sleep(150);
        const s = await call('scrollPos');
        await shoot(`20-scroll-${String(i).padStart(3, '0')}`, s);
      }
    }
    await sleep(800);
    for (let i = 0; i < n; i += 2) {
      await driver.wheel(Math.min(vw - 10, region.x + 10), vh / 2, (-(to - from) / n) * 2);
      await sleep(60);
    }
    await call('scrollToY', region.scroll, 400);
    await sleep(900);
  });

  // 3. hover: approach, stay, traverse, leave
  await step('survol', 45, async () => {
    const c = centre();
    const before = picked.root ? await call('styleSnapshot', picked.root.nid).catch(() => null) : null;
    await call('mark', 'hover-focus');
    for (let k = 0; k <= 8; k++) {
      await driver.mouseMove(c.x - region.w * 0.7 + (region.w * 0.7 * k) / 8, c.y);
      await sleep(35);
    }
    await sleep(700);
    await shoot('30-hover', region.scroll);
    frames.__hoverStyles = before ? { before, after: await call('styleSnapshot', picked.root.nid).catch(() => null) } : null;
    for (let k = 0; k <= 16; k++) {
      await driver.mouseMove(region.x + 6 + ((region.w - 12) * k) / 16, c.y + Math.sin(k / 2) * region.h * 0.25);
      await sleep(60);
    }
    await driver.mouseMove(region.x + region.w + 40, c.y);
    await sleep(700);
  });

  // 4. pointer: slow grid inside the zone (parallax, magnetic, tilt, shader reactions)
  await step('souris', 55, async () => {
    await call('mark', 'mouse-focus');
    for (let row = 0; row < 3; row++)
      for (let col = 0; col <= 6; col++) {
        const x = region.x + (region.w * (row % 2 ? 6 - col : col)) / 6, y = region.y - region.scroll + (region.h * (row + 0.5)) / 3;
        await driver.mouseMove(x, y);
        await sleep(90);
      }
    await shoot('40-pointer', region.scroll);
  });

  // 5. press & hold (released outside the zone so no click fires)
  await step('appui long', 65, async () => {
    if (!driver.mouseDown) return;
    const c = centre();
    await driver.mouseMove(c.x, c.y);
    await sleep(300);
    await call('mark', 'press-focus');
    await driver.mouseDown(c.x, c.y);
    await sleep(700);
    await shoot('50-press', region.scroll);
    await sleep(800);
    await driver.mouseMove(4, 4);
    await driver.mouseUp(4, 4);
    await sleep(800);
  });

  // 6. click (navigation blocked)
  await step('clic', 75, async () => {
    const c = centre();
    await call('guardNav', true);
    await call('mark', 'click-focus');
    await driver.mouseClick(c.x, c.y);
    await sleep(180);
    await shoot('60-click', region.scroll);
    await sleep(1200);
    const st = await call('toggleState', 'body').catch(() => null);
    if (st && st.overlays && st.overlays.length && driver.key) await driver.key('Escape');
    await call('guardNav', false);
    await driver.mouseMove(4, 4);
    await sleep(500);
  });

  // 7. drag across the zone
  await step('glisser', 85, async () => {
    if (!driver.mouseDrag || region.w < 120) return;
    const c = centre();
    const x0 = region.x + region.w * 0.75, dx = -Math.min(360, region.w * 0.5);
    await call('guardNav', true);
    await call('mark', 'drag-focus');
    await driver.mouseMove(x0, c.y);
    await driver.mouseDown(x0, c.y);
    for (let k = 1; k <= 10; k++) {
      await driver.mouseDrag(x0 + (dx * k) / 10, c.y);
      await sleep(22);
    }
    await driver.mouseUp(x0 + dx, c.y);
    await driver.evaluate('window.getSelection && window.getSelection().removeAllRanges()').catch(() => {});
    await sleep(1200);
    await shoot('70-drag', region.scroll);
    await driver.mouseDown(x0 + dx, c.y);
    for (let k = 1; k <= 10; k++) {
      await driver.mouseDrag(x0 + dx - (dx * k) / 10, c.y);
      await sleep(22);
    }
    await driver.mouseUp(x0, c.y);
    await driver.evaluate('window.getSelection && window.getSelection().removeAllRanges()').catch(() => {});
    await call('guardNav', false);
    await sleep(700);
  });

  // 8. collect: motion, code context, WebGL / Three.js when the zone holds a canvas
  onProgress({ pct: 92, label: 'collecte' });
  await status(driver, 'Analyse en cours… collecte');
  const motion = await call('collectMotion');
  const sections = (await call('getSections').catch(() => [])) || [];
  await call('scrollToY', region.scroll, 300).catch(() => {});
  await sleep(500);
  const mediaGroups = (await call('mediaGroups', 20).catch(() => [])) || [];
  const css = (await call('focusCss', [...nids], 60).catch(() => null)) || { rules: [], keyframes: [] };
  const splits = (await call('getSplits').catch(() => [])) || [];
  const three = picked.hasCanvas ? (await call('threeState').catch(() => ({}))) || {} : {};
  const webgl = picked.hasCanvas ? (await call('glState').catch(() => null)) : null;
  const stack = (await call('detectStack').catch(() => [])) || [];
  await driver.evaluate('window.__dipFocus && window.__dipFocus.remove()').catch(() => {});
  const hoverStyles = frames.__hoverStyles;
  delete frames.__hoverStyles;
  return { url: ping.url, title: ping.title, date: new Date().toISOString(), region, viewport: { w: vw, h: vh }, picked, motion, sections, mediaGroups, css, splits, three, webgl, stack, hoverStyles, frames, log };
}

// ------------------------------------------------------------------ analysis limited to the zone
const DRIVER_OF_PHASE = { 'intro-reload': 'chargement', 'intro-idle': 'au repos', 'scroll-focus': 'défilement', 'hover-focus': 'survol', 'mouse-focus': 'souris', 'press-focus': 'appui long', 'click-focus': 'clic', 'drag-focus': 'glisser' };

export function analyzeFocus(fc) {
  const cap = {
    meta: { url: fc.url, title: fc.title, date: fc.date },
    breakpoints: { [fc.viewport.w]: { viewport: fc.viewport, sections: fc.sections, mediaGroups: fc.mediaGroups || [] } },
    motion: fc.motion,
    splits: fc.splits,
    three: fc.three || {},
    webgl: fc.webgl || {},
    stack: fc.stack || [],
    log: fc.log || [],
    screenshots: {},
  };
  let analysis = null;
  try {
    analysis = analyze(cap);
  } catch (e) {
    return { error: e.message, effects: [] };
  }
  const nids = new Set([...(fc.picked.elements || []).map((e) => e.nid), fc.picked.root && fc.picked.root.nid].filter(Boolean));
  const tracks = new Map((((fc.motion && fc.motion.recorder) || {}).tracks || []).map((t) => [t.nid, t]));
  const inZone = (e) => {
    if (e.kind === 'three' || e.source === 'read:three') return fc.picked.hasCanvas;
    return (e.targets || []).some((t) => nids.has(t.nid) || (tracks.get(t.nid) && nids.has(tracks.get(t.nid).parentNid)));
  };
  const marks = (fc.motion && fc.motion.marks) || [];
  const phaseOf = (t) => {
    let p = null;
    for (const m of marks) if (m.t <= t && DRIVER_OF_PHASE[m.name]) p = m.name;
    return p ? DRIVER_OF_PHASE[p] : 'chargement';
  };
  const BY_TRIGGER = { 'scroll-scrub': 'défilement', 'scroll-enter': 'défilement', hover: 'survol', 'mouse-move': 'souris', press: 'appui long', click: 'clic', drag: 'glisser', 'time-loop': 'au repos' };
  const effects = analysis.effects.filter(inZone).map((e) => ({ ...e, observedDuring: BY_TRIGGER[e.trigger] || phaseOf(e.t || 0) }));
  // the main effect: the most specific type, preferring measured motion over plain hover states
  const rank = (e) => (e.effect_type === 'other' ? 0 : e.effect_type === 'hover-state' ? 1 : e.source && e.source.startsWith('read') ? 3 : 2) + Math.min(1, (e.targets || []).length / 10);
  const main = effects.slice().sort((a, b) => rank(b) - rank(a))[0] || null;
  const cards = ((analysis.webgl && analysis.webgl.cards) || []).filter(() => fc.picked.hasCanvas);
  const drivers = {};
  for (const e of effects) drivers[e.observedDuring] = (drivers[e.observedDuring] || 0) + 1;
  const tracked = [...tracks.values()].filter((t) => nids.has(t.nid) && t.t.length > 2);
  return { effects, main, webgl: cards, three: fc.picked.hasCanvas ? analysis.webgl && analysis.webgl.sceneSummary : null, drivers, trackedMoving: tracked.length, scroll: analysis.scroll, stack: (fc.stack || []).filter((s) => s.confidence >= 0.6).map((s) => s.name) };
}

export function commonNameOf(type, a) {
  const c = COMMON_NAMES[type] || null;
  if (type === 'media-choreography' && a && a.layout) {
    const L = { spiral: 'Spiral gallery', circle: 'Circular / orbit gallery', fan: 'Fanned cards', stack: 'Stacked cards deck', collage: 'Image collage' }[a.layout];
    if (L) return { en: L, fr: { spiral: 'Galerie en spirale', circle: 'Galerie en cercle', fan: 'Cartes en éventail', stack: 'Pile de cartes', collage: 'Collage d’images' }[a.layout], aka: c ? c.aka : [], search: L + ' animation gsap' };
  }
  return c || { en: type, fr: type, aka: [], search: type.replace(/-/g, ' ') + ' web animation' };
}

// ------------------------------------------------------------------ focus pack (library: effects/<slug>/)
const slugify = (s) => String(s || 'effet').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const fmt = (v) => (v == null ? '—' : typeof v === 'object' ? '`' + JSON.stringify(v).slice(0, 400) + '`' : String(v));

export function focusFiles(fc, fa) {
  const files = [];
  const add = (path, data) => files.push({ path, data });
  const host = (() => {
    try {
      return new URL(fc.url).hostname.replace(/^www\./, '');
    } catch (e) {
      return 'site';
    }
  })();
  const main = fa.main;
  const type = main ? main.effect_type : 'other';
  const name = commonNameOf(type, main && main.animation);
  const slug = `${slugify(host)}_${slugify(name.en)}_${fc.date.slice(0, 16).replace(/[-:T]/g, '')}`;
  const frameNames = Object.keys(fc.frames || {}).sort();
  for (const f of frameNames) add(`frames/${f}.png`, b64(fc.frames[f]));
  for (const e of fa.effects) if (e.curve) add(`curves/${e.id}.json`, JSON.stringify({ id: e.id, points: e.curve }, null, 1));
  const code = {
    css: fc.css.rules,
    keyframes: fc.css.keyframes,
    gsap: (() => {
      const g = (fc.motion && fc.motion.gsap) || {};
      const ids = new Set((fc.picked.elements || []).map((el) => el.nid));
      const hit = (x) => (x.targets || []).some((t) => ids.has(t.nid) || (fc.picked.root && t.nid === fc.picked.root.nid));
      return { calls: (g.calls || []).filter(hit).slice(0, 30), tweens: (g.tweens || []).filter(hit).slice(0, 30), scrollTriggers: (g.scrollTriggers || []).slice(0, 20) };
    })(),
  };
  add('code/css.txt', [...code.css, ...code.keyframes].join('\n\n') || '/* no CSS rule animating these elements */');
  add('code/gsap.json', JSON.stringify(code.gsap, null, 1));
  for (const w of fa.webgl || []) add(`code/${w.id}.glsl`, `// ${w.id} — study only, do not ship\n// ===== vertex =====\n${w.userVertex || w.vertex || ''}\n\n// ===== fragment =====\n${w.userFragment || w.fragment || ''}\n`);
  const json = {
    kind: 'dip-focus',
    version: 1,
    url: fc.url,
    host,
    title: fc.title,
    date: fc.date,
    region: fc.region,
    commonName: name,
    type,
    trigger: main ? main.trigger : null,
    drivers: fa.drivers,
    stack: fa.stack,
    root: fc.picked.root,
    elements: fc.picked.elements.slice(0, 60),
    effects: fa.effects.map(({ curve, shots, ...e }) => e),
    webgl: (fa.webgl || []).map(({ vertex, fragment, userVertex, userFragment, uniformSamples, ...w }) => w),
    three: fa.three || null,
    hoverStyles: fc.hoverStyles || null,
    frames: frameNames.map((f) => `frames/${f}.png`),
    completed: false,
  };
  add('effect.json', JSON.stringify(json, null, 2));
  add('EFFECT.md', focusMd(fc, fa, name, frameNames));
  return { slug, files, json };
}

function focusMd(fc, fa, name, frameNames) {
  const o = [];
  const m = fa.main;
  o.push(`# ${name.fr} — ${name.en}`, '');
  o.push(`- **Site :** ${fc.url} · analysé le ${fc.date.slice(0, 10)} (zone ${fc.region.w}×${fc.region.h} px à ${fc.region.scroll} px de scroll, fenêtre ${fc.viewport.w}×${fc.viewport.h})`);
  o.push(`- **Aussi appelé :** ${(name.aka || []).join(', ') || '—'} · recherche : \`${name.search}\``);
  o.push(`- **Déclenché par :** ${m ? m.trigger : '—'} · observé pendant : ${Object.entries(fa.drivers).map(([k, v]) => `${k} (${v})`).join(', ') || 'rien de mesuré'}`);
  o.push(`- **Stack du site :** ${fa.stack.join(', ') || '—'} · éléments suivis : ${fc.picked.elements.length} (dont ${fa.trackedMoving} en mouvement)`);
  if (m && EFFECT_TYPES[m.effect_type]) o.push(`- **Type DIP :** \`${m.effect_type}\` — ${EFFECT_TYPES[m.effect_type]}`);
  o.push('', '> Fiche générée par DIP (mesures). La commande Claude Code `/dip-effect` la complète : nom exact, fonctionnement, recette pas à pas, démo, sources.', '');
  o.push('## Images de la zone', '');
  for (const f of frameNames) o.push(`- \`frames/${f}.png\``);
  o.push('', '## Mouvements mesurés', '');
  if (!fa.effects.length) o.push('Aucun mouvement mesuré dans la zone : l’animation est peut-être dessinée dans un canvas (voir WebGL), déclenchée ailleurs, ou déjà jouée avant l’analyse (recharger la page et relancer).');
  for (const e of fa.effects.slice(0, 20)) {
    const a = e.animation || {};
    o.push(`### ${e.id} — ${e.effect_type} (${e.trigger}, observé : ${e.observedDuring})`, '');
    o.push(`- Cibles : ${(e.targets || []).slice(0, 5).map((t) => '`' + t.selector + '`').join(', ')}${(e.targets || []).length > 5 ? ` … (${e.targets.length})` : ''}`);
    o.push(`- Source : ${e.source} · technique : ${e.technique || '—'} · confiance ${e.confidence}`);
    if (a.duration != null) o.push(`- Durée **${a.duration}s**${a.delay ? `, délai ${a.delay}s` : ''}${a.stagger != null ? `, décalage **${a.stagger}s**` : ''}, easing \`${a.ease || '—'}\`${a.ease_bezier ? ` (${a.ease_bezier.join(', ')})` : ''}`);
    if (a.values) o.push(`- Valeurs : ${fmt(a.values)}`);
    if (a.to || a.from) o.push(`- De ${fmt(a.from)} à ${fmt(a.to)}`);
    if (a.scroll) o.push(`- Lié au scroll entre ${a.scroll.startPx} et ${a.scroll.endPx} px${a.scroll.pxPerScrollPx ? ` (${a.scroll.pxPerScrollPx} px par px de scroll)` : ''}`);
    if (a.loop) o.push(`- Boucle : ${fmt(a.loop)}`);
    if (a.mouse) o.push(`- Souris : ${fmt(a.mouse)}`);
    if (a.changes) o.push(`- Changements de style : ${a.changes.slice(0, 8).map((c) => `${c.prop} ${c.before} → ${c.after}`).join(' ; ')}`);
    if (a.layout) o.push(`- Composition : **${a.layout}**, ${a.count} éléments${a.radius ? `, rayon ${Array.isArray(a.radius) ? a.radius.join(' → ') : a.radius} px` : ''}${a.angleStep ? `, ${a.angleStep}° entre éléments` : ''}${a.turns ? `, ${a.turns} tour` : ''}${a.direction ? ` (${a.direction})` : ''}${a.rotationStep ? `, rotation ${a.rotationStep}° par élément` : ''}, taille ≈ ${a.itemSize}px`);
    for (const mm of (a.motion || []).slice(0, 6)) o.push(`- Mouvement du groupe : ${mm.id} ${mm.trigger}${mm.duration != null ? ' ' + mm.duration + 's' : ''}${mm.ease ? ' ' + mm.ease : ''}${mm.scroll ? ` scroll ${mm.scroll.startPx}→${mm.scroll.endPx}px` : ''} ${mm.values ? fmt(mm.values) : ''} (${(mm.targets || []).join(', ')})`);
    if (e.scrollTrigger) o.push(`- ScrollTrigger : ${fmt(e.scrollTrigger)}`);
    if (e.split) o.push(`- Texte découpé en ${e.split.type} (${e.split.count})${e.split.mask ? ', masques overflow' : ''}`);
    if (e.curve) o.push(`- Courbe : \`curves/${e.id}.json\``);
    o.push('');
  }
  if (fa.webgl && fa.webgl.length) {
    o.push('## WebGL dans la zone', '');
    for (const w of fa.webgl) o.push(`- \`${w.id}\` ${w.type}${w.material ? ' (' + w.material + ')' : ''} — uniforms : ${(w.uniforms || []).map((u) => `${u.name}${u.drivenBy ? ' ← ' + u.drivenBy : ''}`).join(', ')} · code : \`code/${w.id}.glsl\` (étude)`);
    if (fa.three) o.push(`- Three.js : ${fa.three.meshes} meshes, post-traitement ${(fa.three.postprocessing || []).join(', ') || '—'}`);
    o.push('');
  }
  o.push('## Code observé', '');
  o.push(`- Règles CSS qui animent ces éléments : \`code/css.txt\` (${fc.css.rules.length} règles, ${fc.css.keyframes.length} @keyframes)`);
  o.push('- Appels GSAP sur ces éléments : `code/gsap.json`');
  if (fc.hoverStyles && fc.hoverStyles.before && fc.hoverStyles.after) o.push('- Styles avant / après survol de l’élément principal : `effect.json` → hoverStyles');
  o.push('', '## Éléments de la zone', '');
  for (const e of fc.picked.elements.slice(0, 25)) o.push(`- \`${e.selector}\` (${e.tag}${e.media ? ', média' : ''}${e.text ? ', « ' + e.text.slice(0, 40) + ' »' : ''}) ${Math.round(e.rect.w)}×${Math.round(e.rect.h)}`);
  return o.join('\n');
}

function b64(s) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { r2 };
