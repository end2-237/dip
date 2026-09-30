#!/usr/bin/env node
// dip-review — quality review of a site built with DIP (no reference needed). Finds what separates a
// good build from an award-level one: dead zones, a fixed header over the content, a hero that goes still
// after its intro, sections without motion, mobile overflow, tiny text, placeholders, console errors.
//
//   node cli/dip-review.js --url http://localhost:5173 [--out sites/<name>/review] [--library D:\DIP-Library] [--headless]
//
// Writes REVIEW.md (fixes to apply, in priority order), review.json and screenshots of each problem.
// Exit code 1 when the score is below 85.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpDriver } from '../extension/lib/cdp-driver.js';
import { analyze } from '../extension/lib/analyzer.js';
import { launchBrowser } from './lib/browser.js';
import { compareInPage } from './lib/verify-core.js';
import { parseArgs } from './lib/args.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROBES = fs.readFileSync(path.join(__dirname, '../extension/probes/probes.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r2 = (x) => Math.round(x * 100) / 100;

// In-page helpers (installed once per document)
const PAGE_HELPERS = `(() => {
  if (window.__dipReview) return true;
  const cs = (el) => getComputedStyle(el);
  const alpha = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const sel = (el) => { if (el.id) return '#' + el.id; const c = [...el.classList].slice(0, 2).join('.'); return el.localName + (c ? '.' + c : ''); };
  function visible(el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const s = cs(e);
      if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false;
    }
    return true;
  }
  // fixed / sticky elements pinned to the top (a header can be split in several fixed blocks)
  function headerEls() {
    const vw = innerWidth, out = [];
    for (const el of document.body.querySelectorAll('*')) {
      const s = cs(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top > 5 || r.height > 180 || r.height < 12 || r.width < 30 || r.width > vw * 1.01 && r.height > 180) continue;
      if (out.some((o) => o.contains(el))) continue;
      out.push(el);
    }
    return out;
  }
  function header() {
    const els = headerEls();
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    return { els, r: { bottom: Math.max(...rs.map((r) => r.bottom)) }, contains: (x) => els.some((e) => e.contains(x)) };
  }
  function contentRects() {
    const out = [];
    const vh = innerHeight, vw = innerWidth;
    const all = document.body.querySelectorAll('*');
    for (const el of all) {
      const tag = el.localName;
      let kind = null;
      if (/^(img|video|picture|svg|iframe|button|input|textarea|select)$/.test(tag)) kind = 'media';
      else if (tag === 'canvas') kind = 'canvas';
      else {
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 1) { kind = 'text'; break; }
        if (!kind) { const s = cs(el); if (s.backgroundImage && s.backgroundImage !== 'none' && /url\\(/.test(s.backgroundImage)) kind = 'media'; }
      }
      if (!kind) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh || r.width < 8 || r.height < 4) continue;
      if (!visible(el)) continue;
      const s = cs(el);
      const fixedBg = kind === 'canvas' && (s.position === 'fixed' || r.width >= vw * 0.9 && r.height >= vh * 0.9);
      out.push({ el, r, kind: fixedBg ? 'bg-canvas' : kind, fixed: s.position === 'fixed' });
    }
    return out;
  }
  window.__dipReview = {
    sample() {
      const vh = innerHeight, B = 18, hdr = header();
      const top = hdr ? Math.min(hdr.r.bottom, 120) : 0;
      const items = contentRects();
      const bands = new Array(B).fill(0);
      let bgCanvas = false;
      for (const it of items) {
        if (it.kind === 'bg-canvas') { bgCanvas = true; continue; }
        if (hdr && hdr.contains(it.el)) continue;
        for (let b = 0; b < B; b++) {
          const y0 = top + ((vh - top) * b) / B, y1 = top + ((vh - top) * (b + 1)) / B;
          if (it.r.bottom > y0 && it.r.top < y1) bands[b] = 1;
        }
      }
      // longest run of empty bands
      let run = 0, best = 0, bestStart = 0, start = 0;
      bands.forEach((v, i) => { if (!v) { if (!run) start = i; run++; if (run > best) { best = run; bestStart = start; } } else run = 0; });
      // header over content: text of the page passing under a transparent fixed header
      const overlaps = [];
      if (hdr) {
        // header marks (links, buttons, labels) not sitting on their own opaque / blurred background
        const protectedBy = (m) => { for (let e = m; e && e !== document.body; e = e.parentElement) { const st = cs(e); if (alpha(st.backgroundColor) >= 0.6 || (st.backdropFilter && st.backdropFilter !== 'none')) return true; if (hdr.els.includes(e)) break; } return false; };
        const marks = hdr.els.flatMap((h) => [...h.querySelectorAll('a, button, span, svg, p')]).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top < 180 && visible(x) && !protectedBy(x); }).map((x) => x.getBoundingClientRect());
        for (const it of items) {
          if (it.kind !== 'text' || it.fixed || hdr.contains(it.el)) continue;
          if (parseFloat(cs(it.el).fontSize) < 18) continue;
          if (marks.some((m) => m.right > it.r.left && m.left < it.r.right && m.bottom > it.r.top + 4 && m.top < it.r.bottom - 4)) overlaps.push(sel(it.el));
        }
      }
      // panels (cards, boxes with their own background) mostly empty inside
      const panels = [];
      const pageBg = cs(document.body).backgroundColor;
      for (const el of document.body.querySelectorAll('div, article, aside, figure, li')) {
        const r = el.getBoundingClientRect();
        if (r.width * r.height < innerWidth * vh * 0.12 || r.bottom < top || r.top > vh || r.width > innerWidth * 0.95) continue;
        const st = cs(el);
        if (alpha(st.backgroundColor) < 0.5 || st.backgroundColor === pageBg || st.position === 'fixed' || !visible(el)) continue;
        const inside = items.filter((it) => it.kind !== 'bg-canvas' && el.contains(it.el));
        if (inside.some((it) => it.kind === 'media' && it.r.width * it.r.height > r.width * r.height * 0.3)) continue;
        const PB = 12, pb = new Array(PB).fill(0);
        for (const it of inside) for (let b = 0; b < PB; b++) { const y0 = r.top + (r.height * b) / PB, y1 = r.top + (r.height * (b + 1)) / PB; if (it.r.bottom > y0 && it.r.top < y1) pb[b] = 1; }
        const filled = pb.reduce((a, x) => a + x, 0) / PB;
        if (filled < 0.45) panels.push({ sel: sel(el), filled: Math.round(filled * 100) / 100, h: Math.round(r.height), top: Math.round(r.top) });
      }
      return { s: scrollY, vh, top, bands, emptyRun: best / B, emptyFrom: top + ((vh - top) * bestStart) / B, emptyTo: top + ((vh - top) * (bestStart + best)) / B, bgCanvas, overlaps: [...new Set(overlaps)].slice(0, 5), panels: panels.slice(0, 4) };
    },
    mobile() {
      const vw = innerWidth;
      const overflow = document.documentElement.scrollWidth > vw + 2;
      const wide = overflow ? [...document.body.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 2 && r.width > 0 && visible(e) && cs(e).position !== 'fixed'; }).slice(0, 5).map(sel) : [];
      let tiny = 0, small = 0;
      const tinyEx = [], smallEx = [];
      for (const el of document.body.querySelectorAll('*')) {
        let has = false;
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim().length > 2) { has = true; break; }
        if (has && visible(el) && parseFloat(cs(el).fontSize) < 11) { tiny++; if (tinyEx.length < 4) tinyEx.push(sel(el)); }
        if (/^(a|button)$/.test(el.localName) && visible(el)) { const r = el.getBoundingClientRect(); if (r.width > 0 && (r.height < 32 || r.width < 32)) { small++; if (smallEx.length < 4) smallEx.push(sel(el)); } }
      }
      return { overflow, wide, tiny, tinyEx, small, smallEx };
    },
    placeholders() {
      const t = document.body.innerText || '';
      const m = t.match(/\\[[^\\]\\n]{2,60}\\]|lorem ipsum/gi) || [];
      return [...new Set(m)].slice(0, 20);
    },
  };
  return true;
})()`;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const url = a.url || 'http://localhost:5173';
  const out = path.resolve(a.out || 'review');
  fs.mkdirSync(out, { recursive: true });
  const { browser, context } = await launchBrowser({ headless: !!a.headless });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await context.newCDPSession(page);
  const driver = new CdpDriver((m, p) => cdp.send(m, p));
  await driver.init(PROBES);
  const helperCtx = await browser.newContext();
  const helper = await helperCtx.newPage();
  await helper.goto('about:blank');
  await page.bringToFront();
  const W = 1440, H = 900;
  await driver.setViewport(W, H);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  } catch (e) {
    console.error(`✗ cannot open ${url}: ${e.message}`);
    await browser.close();
    process.exit(2);
  }
  await driver.call('waitStable', 800, 9000).catch(() => {});
  await driver.call('handleConsent', 'reject').catch(() => {});
  await sleep(3500); // intros that finish on their own (auto calibration, preloaders)
  await driver.evaluate(PAGE_HELPERS);
  const issues = [];
  const add = (sev, area, msg, fix, shot, cost) => issues.push({ sev, area, msg, fix, shot, cost });
  const shot = async (name, clip) => {
    const b64 = await driver.screenshot(clip);
    fs.writeFileSync(path.join(out, name), Buffer.from(b64, 'base64'));
    return name;
  };
  // compared at 96 px wide: film grain and ticking timecodes average out, real motion of the scene remains
  const diff = async (x, y) => (await helper.evaluate(compareInPage, { refB64: x, gotB64: y, masks: [], width: 96 })).mismatch;

  // 1. hero alive after the intro: still frames vs pointer
  await driver.mouseMove(W * 0.2, H * 0.8);
  await sleep(600);
  const h1 = await driver.screenshot();
  await sleep(2000);
  const h2 = await driver.screenshot();
  for (let i = 0; i <= 16; i++) {
    await driver.mouseMove(W * (0.15 + 0.7 * (i / 16)), H * (0.35 + 0.3 * Math.sin(i / 3)));
    await sleep(70);
  }
  await sleep(300);
  const h3 = await driver.screenshot();
  fs.writeFileSync(path.join(out, 'cover.png'), Buffer.from(h2, 'base64'));
  const idle = await diff(h1, h2), pointer = await diff(h2, h3);
  const hero = { idleChange: r2(idle * 100), pointerChange: r2(pointer * 100) };
  if (idle < 0.004 && pointer < 0.01) add('high', 'hero', `Le hero est figé après l'intro (${hero.idleChange} % de pixels changent en 2 s, ${hero.pointerChange} % quand la souris bouge).`, "Garder une vie permanente dans le hero : la scène 3D / l'onde / le visuel continue de bouger lentement (boucle 0,1–0,5 rad/s ou ondulation) et réagit à la souris (parallaxe lissée, lerp 0,05–0,1) et au scroll. Le mot ou le titre ne doit pas rester seul sur un fond immobile.", 'cover.png', 15);
  else if (pointer < 0.01) add('medium', 'hero', `Le hero bouge seul mais ne réagit pas à la souris (${hero.pointerChange} %).`, 'Ajouter une réaction au pointeur dans le hero (parallaxe, inclinaison, déformation de la scène), amplitude faible et lissée.', 'cover.png', 6);

  // 2. scroll pass: dead zones and header overlaps
  await driver.call('mark', 'review').catch(() => {});
  const docH = await driver.call('docHeight');
  const samples = [];
  let pos = await driver.call('scrollPos'), stuck = 0, lastSample = -1e9;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await driver.wheel(6, H / 2, 120);
    await sleep(70);
    const p = await driver.call('scrollPos');
    stuck = p <= pos + 1 ? stuck + 1 : 0;
    pos = p;
    if (pos - lastSample >= H / 4) {
      await sleep(250); // let reveals start
      samples.push(await driver.evaluate('window.__dipReview.sample()'));
      lastSample = pos;
    }
    if (stuck > 15) break;
  }
  // dead zones: ≥ 40 % of the viewport empty, grouped over consecutive samples
  const zones = [];
  for (const s of samples) {
    if (s.emptyRun < 0.4) continue;
    const z = zones[zones.length - 1];
    if (z && s.s - z.to <= H * 0.6) {
      z.to = s.s;
      z.worst = Math.max(z.worst, s.emptyRun);
    } else zones.push({ from: s.s, to: s.s, worst: s.emptyRun, at: s, bgCanvas: s.bgCanvas });
  }
  let zi = 0;
  for (const z of zones.slice(0, 6)) {
    await driver.call('scrollToY', z.from, 400);
    await sleep(900);
    const name = await shot(`dead-zone-${++zi}.png`);
    add(z.bgCanvas ? 'medium' : 'high', 'layout', `Zone vide entre ${Math.round(z.from)} px et ${Math.round(z.to + H)} px de scroll : jusqu'à ${Math.round(z.worst * 100)} % de l'écran sans contenu${z.bgCanvas ? " (seul le canvas de fond l'occupe)" : ''}.`, "Réduire l'espace (paddings, hauteur de section), ou le remplir avec un élément qui porte la section : image, chiffre, citation, détail typographique, ou une animation liée au scroll. Aucune zone de plus de 30 % de l'écran ne doit rester vide plus d'un demi-écran de scroll.", name, z.bgCanvas ? 4 : 8);
  }
  const panelSeen = new Map();
  for (const s of samples) for (const pn of s.panels || []) if (!panelSeen.has(pn.sel)) panelSeen.set(pn.sel, { ...pn, y: s.s });
  let pi = 0;
  for (const pn of [...panelSeen.values()].slice(0, 3)) {
    await driver.call('scrollToY', Math.max(0, pn.y + (pn.top || 0) - 80), 400);
    await sleep(700);
    const name = await shot(`empty-panel-${++pi}.png`);
    add('medium', 'layout', `Bloc « ${pn.sel} » à moitié vide : seulement ${Math.round(pn.filled * 100)} % de sa hauteur (${pn.h} px) porte du contenu (vers ${Math.round(pn.y)} px de scroll).`, "Ajuster la hauteur du bloc à son contenu, ou remplir l'espace avec ce qui raconte la section (visuel, étapes, animation qui se construit au scroll). Un panneau ne doit pas être plus grand que ce qu'il montre.", name, 5);
  }
  const overl = new Map();
  for (const s of samples) for (const o of s.overlaps) if (!overl.has(o)) overl.set(o, s.s);
  let oi = 0;
  for (const [el, y] of [...overl.entries()].slice(0, 3)) {
    await driver.call('scrollToY', y, 400);
    await sleep(700);
    const name = await shot(`header-overlap-${++oi}.png`, { x: 0, y: 0, w: W, h: 260 });
    add('high', 'header', `Le menu fixe passe par-dessus le texte « ${el} » (vers ${Math.round(y)} px de scroll).`, "Le header fixe ne doit jamais chevaucher du texte : fond (ou flou) qui apparaît dès qu'on scrolle, OU header qui se cache au scroll vers le bas et revient au scroll vers le haut. Un mix-blend-mode seul ne suffit pas : les lettres se chevauchent quand même. Ajouter scroll-margin-top aux titres ancrés.", name, 10);
  }

  // 3. motion per section (DIP analysis of what moved during the scroll pass)
  const motion = await driver.call('collectMotion');
  const sections = (await driver.call('getSections')) || [];
  let analysis = null;
  try {
    analysis = analyze({ meta: { url }, breakpoints: { 1440: { viewport: { w: W, h: H }, sections } }, motion, splits: (await driver.call('getSplits').catch(() => [])) || [], three: (await driver.call('threeState').catch(() => ({}))) || {}, stack: [], log: [], screenshots: {} });
  } catch (e) {
    add('low', 'motion', "L'analyse du mouvement a échoué : " + e.message, '', null, 0);
  }
  const perSection = [];
  if (analysis) {
    for (const s of sections) {
      const fx = analysis.effects.filter((e) => e.section === s.id && e.trigger !== 'hover' && e.effect_type !== 'other');
      perSection.push({ id: s.id, height: s.height, effects: fx.map((e) => e.effect_type + '/' + e.trigger) });
    }
    const still = perSection.filter((p, i) => i > 0 && !p.effects.length && p.height > H * 0.5);
    for (const p of still.slice(0, 5)) add('medium', 'motion', `Section ${p.id} : aucune animation mesurée au scroll ou au chargement.`, "Donner à chaque section au moins un moment de mouvement cohérent avec l'ADN : révélation des titres en lignes masquées, image qui entre (clip-path / parallaxe), compteur, élément épinglé… (valeurs mesurées : EFFECTS.md / PATTERNS.md).", null, 4);
    const signature = analysis.effects.filter((e) => /pinned|horizontal|zoom-through|media-expand|camera-scroll|scene-color|media-choreography|3d-|press-hold|gallery-drag/.test(e.effect_type));
    const mid = signature.filter((e) => {
      const i = sections.findIndex((s) => s.id === e.section);
      return i > 0 && i < sections.length - 1;
    });
    if (sections.length > 3 && mid.length < 2) add('medium', 'motion', `Seulement ${mid.length} moment(s) fort(s) dans le milieu de la page (les effets marquants sont concentrés sur l'intro ou le footer).`, "Répartir 2 à 4 moments signature dans les sections du milieu : section épinglée, zoom à travers un objet, média qui s'agrandit, changement de décor, composition d'images en mouvement, 3D qui accompagne le scroll.", null, 6);
  }

  // 4. mobile
  await driver.setViewport(390, 844);
  await page.reload({ waitUntil: 'load' }).catch(() => {});
  await driver.call('waitStable', 600, 8000).catch(() => {});
  await sleep(3500);
  await driver.evaluate(PAGE_HELPERS);
  const mob = await driver.evaluate('window.__dipReview.mobile()');
  fs.writeFileSync(path.join(out, 'cover-mobile.png'), Buffer.from(await driver.screenshot(), 'base64'));
  if (mob.overflow) add('high', 'mobile', `Débordement horizontal sur mobile (390 px) : ${mob.wide.join(', ') || 'élément inconnu'}.`, "Aucun élément ne doit dépasser la largeur de l'écran : max-width: 100 %, clamp() sur les tailles de titre, overflow-x: clip sur les sections décoratives.", 'cover-mobile.png', 10);
  if (mob.tiny > 3) add('low', 'mobile', `${mob.tiny} textes de moins de 11 px sur mobile (${mob.tinyEx.join(', ')}).`, 'Texte courant ≥ 16 px, libellés mono ≥ 11 px sur mobile.', null, 3);
  if (mob.small > 3) add('low', 'mobile', `${mob.small} liens ou boutons de moins de 32 px de haut sur mobile (${mob.smallEx.join(', ')}).`, 'Zones tactiles ≥ 44 × 44 px (padding invisible si besoin).', null, 3);
  const placeholders = await driver.evaluate('window.__dipReview.placeholders()');
  if (placeholders.length) add('info', 'content', `${placeholders.length} contenu(s) encore à confirmer : ${placeholders.slice(0, 8).join(', ')}.`, 'À remplacer par les vraies informations du client avant la mise en ligne.', null, 0);
  const errs = [...new Set(errors)].slice(0, 8);
  for (const e of errs.slice(0, 3)) add('medium', 'errors', `Erreur dans la console : ${e.slice(0, 200)}`, 'Corriger l’erreur (voir la console du navigateur).', null, 5);
  await browser.close();

  // score + report
  const lost = issues.reduce((s, i) => s + (i.cost || 0), 0);
  const score = Math.max(0, 100 - Math.min(lost, 100));
  let patterns = null;
  if (a.library) {
    const pp = path.join(path.resolve(a.library), 'patterns.json');
    if (fs.existsSync(pp)) patterns = JSON.parse(fs.readFileSync(pp, 'utf8'));
  }
  const sevOrder = { high: 0, medium: 1, low: 2, info: 3 };
  issues.sort((x, y) => sevOrder[x.sev] - sevOrder[y.sev] || y.cost - x.cost);
  const L = [`# REVIEW — ${url}`, '', `Score qualité : **${score} / 100** ${score >= 85 ? '✓' : '✗ (objectif ≥ 85)'} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, ''];
  L.push(`Hero : ${hero.idleChange} % de l'image change en 2 s au repos, ${hero.pointerChange} % quand la souris bouge.`);
  if (perSection.length) L.push(`Sections : ${perSection.length} — ${perSection.map((p) => `${p.id} (${p.effects.length})`).join(', ')}`);
  if (patterns && patterns.sections) L.push(`Bibliothèque : médiane ${patterns.sections.median} sections, ${patterns.density ? patterns.density.signatureMoments : '?'} moments signature par site.`);
  L.push('', '## À corriger (par priorité)', '');
  const label = { high: '🔴', medium: '🟠', low: '🟡', info: 'ℹ️' };
  issues.forEach((i, k) => {
    L.push(`${k + 1}. ${label[i.sev]} **${i.area}** — ${i.msg}`);
    if (i.fix) L.push(`   → ${i.fix}`);
    if (i.shot) L.push(`   Capture : \`${i.shot}\``);
  });
  if (!issues.length) L.push('Rien à signaler.');
  L.push('', 'Relancer après corrections : `node <DIP>/cli/dip-review.js --url ' + url + ' --out ' + path.relative(process.cwd(), out) + '`');
  fs.writeFileSync(path.join(out, 'REVIEW.md'), L.join('\n'));
  fs.writeFileSync(path.join(out, 'review.json'), JSON.stringify({ url, date: new Date().toISOString(), score, hero, sections: perSection, mobile: mob, placeholders, issues, errors: errs }, null, 2));
  console.log(L.join('\n'));
  process.exit(score >= 85 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
