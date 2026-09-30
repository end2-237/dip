// DIP Studio — full-page dashboard: library folder, scans, measured animations, suggestions, creation commands.
import { getRoot, pickRoot, access, fsAdapter, readBlob, savePack, removePack, writeFile, saveFocus } from './lib/workspace.js';
import { categoryCoverage, listFocus, listPacks, writeIndex, effectsByType, rankReferences, librarySuggestions, libraryStats, words, versionLess, libraryPatterns } from './lib/library.js';
import { ANALYZER_VERSION } from './lib/analyzer.js';
import { SECTORS, STYLES, TECHNIQUES, SOURCES, label as catLabel } from './lib/categories.js';
import { buildPackFiles, packName } from './lib/pack.js';
import { dissectUrl, shareImage, focusUrl } from './lib/runner.js';
import { analyzeFocus, focusFiles } from './lib/focus.js';
import { stepLabel } from './lib/i18n.js';
import { checkUpdate, UPDATE_CMD } from './lib/update.js';
import { readPackZip } from './lib/unzip-web.js';
import { EFFECT_TYPES } from './lib/taxonomy.js';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TITLES = { overview: 'Vue d’ensemble', library: 'Bibliothèque', collect: 'Collecte', sites: 'Sites construits', motion: 'Bibliothèque d’effets', create: 'Créer', settings: 'Réglages' };
const TYPE_FR = {
  'text-reveal-lines': 'Révélation de texte (lignes)', 'text-reveal-words': 'Révélation de texte (mots)', 'text-reveal-chars': 'Révélation de texte (lettres)', 'text-scramble': 'Texte brouillé',
  'fade-up-reveal': 'Apparition en fondu', 'scale-reveal': 'Apparition à l’échelle', marquee: 'Défilement infini', 'image-reveal-clip': 'Révélation d’image (masque)', 'image-parallax': 'Parallaxe d’image',
  'image-distortion-hover': 'Distorsion d’image au survol', 'image-trail': 'Traînée d’images', 'gallery-drag': 'Galerie à glisser', 'horizontal-scroll-section': 'Défilement horizontal', 'pinned-sequence': 'Séquence épinglée',
  'scroll-scrubbed-video': 'Vidéo pilotée au scroll', 'image-sequence-canvas': 'Séquence d’images', counter: 'Compteur', 'magnetic-element': 'Élément magnétique', 'custom-cursor': 'Curseur personnalisé',
  'cursor-follower-media': 'Média qui suit le curseur', 'tilt-3d': 'Inclinaison 3D', 'mouse-parallax': 'Parallaxe à la souris', 'page-transition': 'Transition de page', preloader: 'Écran de chargement',
  'menu-overlay': 'Menu plein écran', 'fluid-background-shader': 'Fond fluide (shader)', 'noise-gradient': 'Dégradé animé', particles: 'Particules', 'gpgpu-simulation': 'Simulation GPU', '3d-scene': 'Scène 3D',
  'camera-scroll-path': 'Caméra 3D au scroll', '3d-object-motion': 'Objet 3D animé', 'press-hold': 'Appui long', tabs: 'Onglets', 'click-feedback': 'Retour au clic', 'scene-color-shift': 'Changement de décor',
  'zoom-through': 'Zoom à travers', 'media-expand': 'Média qui s’agrandit', 'media-choreography': 'Composition d’images', 'model-viewer': 'Visionneuse 3D', 'split-screen': 'Écran partagé',
  'sticky-stack-cards': 'Cartes empilées', accordion: 'Accordéon', 'blend-mode-text': 'Texte en mode de fusion', 'svg-path-draw': 'Tracé SVG', 'morph-svg': 'Morphing SVG', lottie: 'Lottie', 'grain-overlay': 'Grain animé',
  'hover-state': 'État de survol', 'smooth-scroll': 'Scroll fluide', other: 'Autre',
};
const typeFr = (t) => TYPE_FR[t] || t;
const TRIGGERS = { load: 'au chargement', 'scroll-enter': 'à l’entrée au scroll', 'scroll-scrub': 'lié au scroll', hover: 'au survol', press: 'appui long', 'mouse-move': 'à la souris', click: 'au clic', drag: 'glisser', 'time-loop': 'en boucle', 'route-change': 'changement de page' };

const state = { root: null, access: 'none', packs: [], sites: [], focus: [], catSector: '', catStyle: '', catTech: '', colStyles: new Set(), page: 'overview', libFilter: 'all', moTrigger: 'all', moType: 'all', mode: 'create', refs: new Set(), refsTouched: false, windowId: null };
const thumbCache = new Map();

// ------------------------------------------------------------------ helpers
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => (t.hidden = true), 2200);
}
async function copy(text) {
  await navigator.clipboard.writeText(text);
  toast('Copié');
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const slug = (s) => String(s || 'projet').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projet';
const ready = () => state.root && state.access === 'granted';

async function thumbOf(pack, file) {
  const key = pack.path + '|' + (file || '');
  if (thumbCache.has(key)) return thumbCache.get(key);
  const p = (async () => {
    let path = file;
    if (!path) {
      const refs = (await fsAdapter(state.root).list(pack.path + '/reference/1440')).filter((f) => f.kind === 'file' && /\.png$/.test(f.name)).map((f) => f.name).sort();
      const first = refs.find((n) => /^s\d/.test(n)) || refs.find((n) => !/fullpage/.test(n)) || refs[0];
      if (!first) return null;
      path = pack.path + '/reference/1440/' + first;
    }
    const blob = await readBlob(state.root, path);
    return blob ? URL.createObjectURL(blob) : null;
  })().catch(() => null);
  thumbCache.set(key, p);
  return p;
}
function lazyImg(img, promise) {
  promise.then((url) => {
    if (!url) return;
    img.onload = () => img.classList.add('ready');
    img.src = url;
  });
}

// ------------------------------------------------------------------ markdown (packs are plain Markdown)
function inline(s) {
  // code spans are kept verbatim; emphasis / links only outside them
  return String(s)
    .split(/(`[^`]+`)/)
    .map((seg) =>
      seg.startsWith('`') && seg.endsWith('`') && seg.length > 1
        ? `<code>${esc(seg.slice(1, -1))}</code>`
        : esc(seg)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=[\s.,;:)]|$)/g, '$1<em>$2</em>')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="lnk" title="$2">$1</span>')
    )
    .join('');
}
function renderMd(md) {
  const out = [];
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const n = Math.min(3, h[1].length);
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
      out.push('<table>' + body.map((r, k) => '<tr>' + cells(r).map((c) => (k === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('') + '</tr>').join('') + '</table>');
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!l.trim()) {
      i++;
      continue;
    }
    const buf = [l];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------ workspace
async function loadWorkspace(interactive) {
  state.root = await getRoot().catch(() => null);
  state.access = await access(state.root, interactive).catch(() => 'denied');
  const dot = $('#ws-dot');
  dot.className = 'dot ' + (state.access === 'granted' ? 'ok' : state.root ? 'warn' : '');
  $('#ws-name').textContent = state.root ? state.root.name || 'Bibliothèque' : 'Choisir…';
  $('#set-folder').textContent = state.root ? state.root.name + (state.access === 'granted' ? '' : ' — accès à réautoriser') : 'Aucun dossier';
  const banner = $('#banner');
  if (state.root && state.access !== 'granted') {
    banner.hidden = false;
    banner.innerHTML = `<span>Chrome demande à nouveau l’accès au dossier « ${esc(state.root.name)} ».</span><button class="primary" id="btn-regrant">Autoriser</button>`;
    $('#btn-regrant').onclick = async () => {
      await loadWorkspace(true);
      await refresh();
    };
  } else banner.hidden = true;
}

async function refresh() {
  state.packs = ready() ? await listPacks(fsAdapter(state.root)).catch(() => []) : [];
  state.sites = ready() ? await listSites().catch(() => []) : [];
  state.focus = ready() ? await listFocus(fsAdapter(state.root)).catch(() => []) : [];
  $('#nav-sites').textContent = state.sites.length || '';
  $('#nav-count').textContent = state.packs.length || '';
  render();
}

async function choose() {
  try {
    state.root = await pickRoot();
    await loadWorkspace(true);
    if (ready()) await writeIndex(fsAdapter(state.root));
    await refresh();
    toast('Bibliothèque : ' + state.root.name);
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message);
  }
}

// ------------------------------------------------------------------ routing
function go(page) {
  state.page = TITLES[page] ? page : 'overview';
  $$('nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === state.page));
  $('#page-title').textContent = TITLES[state.page];
  $('#search').hidden = !['library', 'motion'].includes(state.page);
  render();
}
window.addEventListener('hashchange', () => go(location.hash.slice(1)));

function render() {
  const needFolder = !state.root && state.page !== 'settings';
  $('#page-empty').hidden = !needFolder;
  for (const p of Object.keys(TITLES)) $('#page-' + p).hidden = needFolder || p !== state.page;
  if (needFolder) return;
  ({ overview: renderOverview, library: renderLibrary, collect: renderCollect, sites: renderSites, motion: renderMotion, create: renderCreate, settings: () => {} })[state.page]();
}

// ------------------------------------------------------------------ cards
function packCard(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `<div class="thumb"><img alt=""><div class="tags"><span class="badge">Tier ${esc(p.tier)}</span>${p.threeD ? '<span class="badge violet">3D</span>' : ''}${p.hasDna ? '<span class="badge ok">ADN</span>' : ''}${isOld(p) ? `<span class="badge warn" title="Analysé avec DIP ${esc(p.analyzerVersion)} — version actuelle ${ANALYZER_VERSION}">ancienne version</span>` : ''}</div></div>
  <div class="card-b"><div class="card-t"><b>${esc(p.domain)}</b><span>${fmtDate(p.date)}</span></div>
  <div class="card-cat">${esc(catLabel('sector', (p.categories || {}).sector))}${(p.categories || {}).styles && p.categories.styles.length ? ' · ' + p.categories.styles.map((x) => esc(catLabel('style', x))).join(', ') : ''}${(p.categories || {}).favorite ? ' · ★' : ''}</div>
  <div class="card-m"><span>${p.effects.length} animations · ${p.sections.length} sections</span><span class="sw">${p.palette.slice(0, 5).map((c) => `<i class="swatch" style="background:${esc(c.hex)}" title="${esc(c.hex)}"></i>`).join('')}</span></div></div>`;
  lazyImg($('img', el), thumbOf(p));
  el.onclick = () => openPack(p);
  return el;
}

// ------------------------------------------------------------------ overview
function renderOverview() {
  const s = libraryStats(state.packs);
  $('#stats').innerHTML = [
    [s.sites, 'sites analysés'],
    [s.effects, 'animations mesurées'],
    [s.threeD, 'sites 3D / WebGL'],
    [`${s.withDna}<small class="muted">/${s.sites}</small>`, 'ADN écrits'],
  ]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`)
    .join('');
  const sugg = librarySuggestions(state.packs, ANALYZER_VERSION);
  if (!state.packs.length) sugg.unshift({ kind: 'scan', text: 'Ta bibliothèque est vide : scanne un premier site (bouton « Scanner un site ») ou importe des packs .zip déjà téléchargés.' });
  $('#suggestions').innerHTML = sugg.map((x, i) => `<div class="sugg"><span class="ic ${x.kind}"></span><div>${esc(x.text)}</div>${x.action === 'redissect' ? `<div class="cmdline"><button class="primary" data-redissect>Tout redisséquer</button></div>` : ''}${x.command ? `<div class="cmdline"><code>${esc(x.command)}</code><button class="icon" data-copy="${i}" title="Copier"><svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8c0-.7.6-1.3 1.3-1.3H10"/></svg></button></div>` : ''}</div>`).join('');
  $$('[data-copy]', $('#suggestions')).forEach((b) => (b.onclick = () => copy(sugg[+b.dataset.copy].command)));
  $$('[data-redissect]', $('#suggestions')).forEach((b) => (b.onclick = () => redissect(state.packs.filter(isOld))));
  $('#tempo').innerHTML = `<dl class="kv">
    <dt>Durée typique</dt><dd>${s.medianDuration != null ? s.medianDuration + ' s' : '—'}</dd>
    <dt>Scroll (lerp moyen)</dt><dd>${s.lerp != null ? s.lerp : '—'}</dd>
    ${(() => {
      const pt = libraryPatterns(state.packs);
      if (!pt.sites) return '';
      return `<dt>Sections par page</dt><dd>${pt.sections.median}</dd><dt>Moments signature</dt><dd>${pt.density ? pt.density.signatureMoments : '—'}</dd><dt>Enchaînement fréquent</dt><dd class="small">${esc(pt.transitions[0] ? pt.transitions[0].pair : '—')}</dd>`;
    })()}
    ${s.topEases.map(([e, n]) => `<dt class="mono">${esc(e === 'none' ? 'linear' : e)}</dt><dd>${n}×</dd>`).join('') || '<dt>Easings</dt><dd>—</dd>'}
  </dl>`;
  const recent = $('#recent');
  recent.innerHTML = '';
  for (const p of state.packs.slice(0, 4)) recent.appendChild(packCard(p));
  if (!state.packs.length) recent.innerHTML = '<div class="empty-note">Aucun scan pour l’instant.</div>';
}

// ------------------------------------------------------------------ library
function matches(p, q) {
  if (!q) return true;
  const hay = [p.domain, p.title, p.url, ...p.fonts, ...p.stack, ...(p.dna ? [...p.dna.keywords, ...p.dna.sectors, p.dna.register] : []), ...p.effects.map((e) => e.type)].join(' ').toLowerCase();
  return words(q).every((w) => hay.includes(w));
}
function renderLibrary() {
  const q = $('#search').value;
  const f = state.libFilter;
  const cat = (p) => p.categories || { styles: [], techniques: [] };
  const list = state.packs.filter((p) => (f === '3d' ? p.threeD : f === 'nodna' ? !p.hasDna : f === 'dna' ? p.hasDna : f === 'old' ? isOld(p) : true) && matches(p, q) && (!state.catSector || cat(p).sector === state.catSector) && (!state.catStyle || cat(p).styles.includes(state.catStyle)) && (!state.catTech || cat(p).techniques.includes(state.catTech)));
  // category chips with counts (only values present in the library)
  const cov = categoryCoverage(state.packs);
  const chips = (el, rows, key) => {
    el.innerHTML = [`<button class="seg ${!state[key] ? 'on' : ''}" data-v="">Tous</button>`, ...rows.filter((r) => r.sites).map((r) => `<button class="seg ${state[key] === r.key ? 'on' : ''}" data-v="${r.key}">${esc(r.label)}<span class="n">${r.sites}</span></button>`)].join('');
    $$('.seg', el).forEach((b) => (b.onclick = () => ((state[key] = b.dataset.v), renderLibrary())));
  };
  chips($('#cat-sector'), cov.sectors, 'catSector');
  chips($('#cat-style'), cov.styles, 'catStyle');
  chips($('#cat-tech'), cov.techniques, 'catTech');
  const old = state.packs.filter(isOld);
  const btn = $('#btn-redissect-all');
  btn.hidden = !old.length;
  $('span', btn).textContent = `Redisséquer les anciennes versions (${old.length})`;
  const grid = $('#lib-grid');
  grid.innerHTML = '';
  for (const p of list) grid.appendChild(packCard(p));
  if (!list.length) grid.innerHTML = `<div class="empty-note">${state.packs.length ? 'Aucun site ne correspond.' : 'Aucun scan : utilise « Scanner un site » ou « Importer ».'}</div>`;
}

// ------------------------------------------------------------------ motion index
async function curveSvg(p, id) {
  const txt = await fsAdapter(state.root).readText(`${p.path}/motion/curves/${id}.json`).catch(() => null);
  if (!txt) return '';
  try {
    const pts = JSON.parse(txt).points || [];
    if (pts.length < 2) return '';
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 44).toFixed(1)},${(26 - y * 26).toFixed(1)}`).join(' ');
    return `<svg class="curve" viewBox="-1 -2 46 30"><path d="${d}"/></svg>`;
  } catch (e) {
    return '';
  }
}
const FRAME_LABEL = { '00': 'zone', '10': 'au repos', '20': 'défilement', '30': 'survol', '40': 'souris', '50': 'appui', '60': 'clic', '70': 'glisser' };
function renderFocusGrid() {
  const grid = $('#focus-grid');
  grid.innerHTML = '';
  if (!state.focus.length) {
    grid.innerHTML = '<div class="empty-note">Aucune analyse ciblée pour l’instant.</div>';
    return;
  }
  for (const f of state.focus) {
    const el = document.createElement('article');
    el.className = 'fx';
    el.innerHTML = `<div class="fx-prev"><img alt=""><span class="badge ${f.completed ? 'ok' : 'warn'}">${f.completed ? 'fiche complète' : 'à compléter'}</span></div>
      <div class="fx-b"><b>${esc(f.commonName ? f.commonName.fr : f.type)}</b><span>${esc(f.host)} · ${esc(TRIGGERS[f.trigger] || f.trigger || '—')}</span><span class="mono">${esc(f.type)}</span></div>`;
    lazyImg($('img', el), (async () => {
      const b = await readBlob(state.root, `${f.path}/${(f.frames || []).find((x) => /20-scroll|30-hover|10-idle-3/.test(x)) || (f.frames || [])[0] || 'frames/00-selected.png'}`);
      return b ? URL.createObjectURL(b) : null;
    })());
    el.onclick = () => openFocus(f);
    grid.appendChild(el);
  }
}
async function openFocus(f) {
  const text = await fsAdapter(state.root).readText(`${f.path}/EFFECT.md`);
  const cmd = `/dip-effect ${f.path}`;
  drawer(
    `${esc(f.commonName ? f.commonName.fr : f.type)} <span class="badge ${f.completed ? 'ok' : 'warn'}" style="margin-left:8px">${f.completed ? 'fiche complète' : 'à compléter'}</span>`,
    `<div class="muted small">${esc(f.host)} · ${fmtDate(f.date)} · ${esc(f.commonName ? f.commonName.en : '')}</div>
    <div class="dr-actions"><button class="primary" id="fx-copy">Copier ${esc(cmd)}</button>${f.demo ? '<button id="fx-demo">Ouvrir la démo</button>' : ''}<button class="ghost" id="fx-site">Ouvrir le site</button><button class="ghost" id="fx-again">Refaire l’analyse</button></div>
    <div class="frames">${(f.frames || []).map((fr) => `<figure><img data-fr="${esc(fr)}" alt=""><figcaption>${esc(FRAME_LABEL[fr.split('/').pop().slice(0, 2)] || '')} · ${esc(fr.split('/').pop().replace('.png', ''))}</figcaption></figure>`).join('')}</div>
    <div class="md">${text ? renderMd(text) : '<p class="muted">EFFECT.md introuvable.</p>'}</div>`
  );
  $$('[data-fr]').forEach((img) => lazyImg(img, (async () => {
    const b = await readBlob(state.root, `${f.path}/${img.dataset.fr}`);
    return b ? URL.createObjectURL(b) : null;
  })()));
  $('#fx-copy').onclick = () => copy(cmd);
  $('#fx-site').onclick = () => chrome.tabs.create({ url: f.url });
  $('#fx-again').onclick = () => {
    closeDrawer();
    runFocusJob(f.url);
  };
  if ($('#fx-demo')) $('#fx-demo').onclick = async () => {
    const b = await readBlob(state.root, `${f.path}/${f.demo}`);
    if (b) chrome.tabs.create({ url: URL.createObjectURL(new Blob([await b.text()], { type: 'text/html' })) });
  };
}
let focusBusy = false;
async function runFocusJob(url) {
  if (focusBusy || reBusy) return toast('Une analyse est déjà en cours');
  if (!ready()) return toast('Autorise d’abord l’accès au dossier');
  focusBusy = true;
  const job = $('#job');
  job.hidden = false;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch (e) {
    /* keep url */
  }
  $('#job-title').textContent = `Analyse ciblée · ${host} — entoure l’animation dans la fenêtre du site`;
  $('#job-pct').textContent = '';
  $('#job-bar').style.width = '0%';
  $('#job-step').textContent = 'En attente de ta sélection…';
  try {
    const fc = await focusUrl(url, (x) => {
      $('#job-pct').textContent = x.pct + '%';
      $('#job-bar').style.width = x.pct + '%';
      $('#job-step').textContent = x.label;
    });
    if (!fc) return toast('Analyse annulée');
    $('#job-step').textContent = 'Enregistrement…';
    const fa = analyzeFocus(fc);
    const { slug, files, json } = focusFiles(fc, fa);
    await saveFocus(state.root, slug, files);
    await refresh();
    location.hash = 'motion';
    toast(`${json.commonName.fr} : fiche créée`);
    const f = state.focus.find((x) => x.slug === slug);
    if (f) openFocus(f);
  } catch (e) {
    console.error(e);
    toast(String(e.message || e));
  } finally {
    focusBusy = false;
    job.hidden = true;
  }
}
$('#btn-focus-new').onclick = () => $('#dlg-focus').showModal();
$('#focus-go').onclick = (e) => {
  e.preventDefault();
  let url = $('#focus-url').value.trim();
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  if (!/^https?:\/\/[^.]+\..+|^https?:\/\/(localhost|127\.0\.0\.1)/.test(url)) return toast('Adresse invalide');
  $('#dlg-focus').close();
  runFocusJob(url);
};

function renderMotion() {
  renderFocusGrid();
  const q = $('#search').value.toLowerCase();
  const groups = effectsByType(state.packs);
  const trig = new Set(state.packs.flatMap((p) => p.effects.map((e) => e.trigger)));
  $('#mo-types').innerHTML = [['all', 'Tous les effets', state.packs.reduce((a, p) => a + p.effects.length, 0)], ...groups.map(([t, l]) => [t, typeFr(t), l.length])]
    .map(([t, label, n]) => `<button class="seg ${state.moType === t ? 'on' : ''}" data-ty="${esc(t)}">${esc(label)} <span class="muted">${n}</span></button>`)
    .join('');
  $$('.seg', $('#mo-types')).forEach((b) => (b.onclick = () => ((state.moType = b.dataset.ty), renderMotion())));
  $('#mo-filters').innerHTML = ['all', ...Object.keys(TRIGGERS).filter((t) => trig.has(t))].map((t) => `<button class="seg ${state.moTrigger === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? 'Tous les déclencheurs' : TRIGGERS[t]}</button>`).join('');
  $$('.seg', $('#mo-filters')).forEach((b) => (b.onclick = () => ((state.moTrigger = b.dataset.t), renderMotion())));
  const rows = groups
    .flatMap(([type, list]) => list.map((e) => ({ ...e, type })))
    .filter((e) => (state.moType === 'all' || e.type === state.moType) && (state.moTrigger === 'all' || e.trigger === state.moTrigger) && (!q || [e.type, typeFr(e.type), e.id, e.pack.domain, e.ease, e.technique].join(' ').toLowerCase().includes(q)))
    .slice(0, 240);
  const grid = $('#mo-list');
  grid.innerHTML = '';
  if (!rows.length) grid.innerHTML = '<div class="empty-note">Aucun effet pour ce filtre.</div>';
  for (const e of rows) {
    const el = document.createElement('article');
    el.className = 'fx';
    el.innerHTML = `<div class="fx-prev"><img alt=""><span class="badge">${esc(TRIGGERS[e.trigger] || e.trigger)}</span></div>
      <div class="fx-b"><b>${esc(typeFr(e.type))}</b><span>${esc(e.pack.domain)} · <span class="mono">${esc(e.id)}</span></span><span class="mono">${e.duration != null ? e.duration + ' s' : ''}${e.ease ? ' · ' + esc(e.ease) : ''}${e.stagger != null ? ' · décalage ' + e.stagger + ' s' : ''}</span></div>`;
    const file = e.preview ? `${e.pack.path}/${e.preview}` : e.section && e.section !== 'global' ? `${e.pack.path}/reference/1440/${e.section}.png` : null;
    lazyImg($('img', el), file ? thumbOf(e.pack, file) : thumbOf(e.pack));
    if (e.curve) curveSvg(e.pack, e.id).then((svg) => svg && $('.fx-prev', el).insertAdjacentHTML('beforeend', svg));
    el.onclick = () => openDoc(e.pack, `motion/effects/${e.id}.md`, typeFr(e.type) + ' — ' + e.id);
    grid.appendChild(el);
  }
}

// ------------------------------------------------------------------ built sites (sites/<slug>/)
async function listSites() {
  const fsa = fsAdapter(state.root);
  const dirs = (await fsa.list('sites')).filter((d) => d.kind === 'directory');
  const out = [];
  for (const d of dirs) {
    const base = 'sites/' + d.name;
    const files = new Set((await fsa.list(base)).map((f) => f.name));
    const rev = await fsa.readText(base + '/review/review.json').catch(() => null);
    let review = null;
    try {
      review = rev ? JSON.parse(rev) : null;
    } catch (e) {
      review = null;
    }
    const prod = (await fsa.list('production/' + d.name)).map((f) => f.name);
    const brief = prod.includes('BRIEF.md') ? await fsa.readText(`production/${d.name}/BRIEF.md`) : null;
    const refs = brief ? [...new Set((brief.match(/[a-z0-9-]+\.(?:[a-z]{2,6})(?=[\s·,|)]|$)/gi) || []).filter((x) => !/\.(md|json|js|css|html)$/i.test(x)))].slice(0, 6) : [];
    let mtime = null;
    try {
      const f = await readBlob(state.root, base + '/package.json');
      mtime = f && f.lastModified;
    } catch (e) {
      /* ignore */
    }
    out.push({ name: d.name, path: base, files, review, production: prod, refs, hasNotes: files.has('NOTES.md'), mtime });
  }
  return out.sort((a, b) => (b.review ? Date.parse(b.review.date) : b.mtime || 0) - (a.review ? Date.parse(a.review.date) : a.mtime || 0));
}
const scoreClass = (s) => (s == null ? 'none' : s >= 85 ? 'good' : s >= 65 ? 'mid' : 'bad');
function renderSites() {
  const grid = $('#sites-grid');
  grid.innerHTML = '';
  if (!state.sites.length) {
    grid.innerHTML = '<div class="empty-note">Aucun site dans <span class="mono">sites/</span> pour l’instant. Crée un projet dans « Créer » : Claude construit le site dans <span class="mono">sites/&lt;projet&gt;</span>.</div>';
    return;
  }
  for (const st of state.sites) {
    const el = document.createElement('article');
    el.className = 'card';
    const sc = st.review ? st.review.score : null;
    const hi = st.review ? st.review.issues.filter((i) => i.sev === 'high').length : 0;
    el.innerHTML = `<div class="thumb"><img alt=""><span class="score ${scoreClass(sc)}">${sc == null ? '—' : sc}</span></div>
      <div class="card-b"><div class="card-t"><b>${esc(st.name)}</b><span>${st.review ? fmtDate(st.review.date) : st.mtime ? fmtDate(st.mtime) : ''}</span></div>
      <div class="card-m"><span>${st.review ? `${st.review.issues.length} point(s) · ${hi} critique(s)` : 'pas encore de revue'}</span><span>${st.refs.length ? st.refs.length + ' réf.' : ''}</span></div></div>`;
    if (st.review) lazyImg($('img', el), (async () => {
      const b = await readBlob(state.root, st.path + '/review/cover.png');
      return b ? URL.createObjectURL(b) : null;
    })());
    el.onclick = () => openSite(st);
    grid.appendChild(el);
  }
}
async function openSiteDoc(st, file, title) {
  const text = await fsAdapter(state.root).readText(file);
  drawer(`<span class="muted">${esc(st.name)} /</span> ${esc(title)}`, `<button class="ghost" id="dr-back" style="align-self:flex-start"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>Retour</button><div class="md">${text == null ? '<p class="muted">Fichier introuvable.</p>' : renderMd(text)}</div>`);
  $('#dr-back').onclick = () => openSite(st);
}
function openSite(st) {
  const r = st.review;
  const docs = [
    ...['CONCEPT.md', 'BRIEF.md', 'QUALITY_RULES.md', 'ASSETS.md', '3D.md', 'BUILD_PLAN.md'].filter((f) => st.production.includes(f)).map((f) => [`production/${st.name}/${f}`, f.replace('.md', '').replace('_', ' ').toLowerCase()]),
    ...(st.hasNotes ? [[st.path + '/NOTES.md', 'notes']] : []),
    ...(st.files.has('CREDITS.md') ? [[st.path + '/CREDITS.md', 'crédits']] : []),
  ];
  const cmdReview = `/dip-review ${st.path}`;
  const cmdDev = `cd ${st.path}; npm install; npm run dev`;
  drawer(
    `${esc(st.name)} <span class="score ${scoreClass(r && r.score)}" style="position:static;margin-left:8px">${r ? r.score + ' / 100' : 'pas de revue'}</span>`,
    `<div class="muted small">${st.refs.length ? 'Références : ' + st.refs.map(esc).join(' · ') : 'Références : voir le brief'}${r ? ' · revue du ' + fmtDate(r.date) : ''}</div>
    <div class="dr-actions">${docs.map(([f, l]) => `<button data-sdoc="${esc(f)}">${esc(l.charAt(0).toUpperCase() + l.slice(1))}</button>`).join('')}</div>
    <div><div class="label" style="margin-bottom:6px">Commandes</div>
      <div class="sugg" style="padding:0;border:0"><span class="ic create"></span><div>Lancer le site en local (PowerShell)</div><div class="cmdline"><code>${esc(cmdDev)}</code><button class="icon" data-c="dev" title="Copier"><svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8c0-.7.6-1.3 1.3-1.3H10"/></svg></button></div></div>
      <div class="sugg" style="padding:10px 0 0;border:0"><span class="ic dna"></span><div>Revue qualité + corrections par Claude Code (dans la bibliothèque)</div><div class="cmdline"><code>${esc(cmdReview)}</code><button class="icon" data-c="rev" title="Copier"><svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8c0-.7.6-1.3 1.3-1.3H10"/></svg></button></div></div>
    </div>
    ${r ? `<div><div class="label" style="margin-bottom:6px">Revue qualité — ${r.issues.length} point(s)</div><div class="issues">${r.issues.map((i) => `<div class="issue"><span>${{ high: '🔴', medium: '🟠', low: '🟡', info: 'ℹ️' }[i.sev] || ''}</span><div>${esc(i.msg)}</div>${i.fix ? `<div class="fix">→ ${esc(i.fix)}</div>` : ''}${i.shot ? `<img data-shot="${esc(i.shot)}" alt="">` : ''}</div>`).join('') || '<div class="muted">Rien à signaler.</div>'}</div></div>` : '<p class="hint">Pas encore de revue : copie la commande <span class="mono">/dip-review</span> ci-dessus dans Claude Code.</p>'}`
  );
  $$('[data-sdoc]').forEach((b) => (b.onclick = () => openSiteDoc(st, b.dataset.sdoc, b.textContent)));
  $('[data-c="dev"]').onclick = () => copy(cmdDev);
  $('[data-c="rev"]').onclick = () => copy(cmdReview);
  $$('[data-shot]').forEach((img) => lazyImg(img, (async () => {
    const b = await readBlob(state.root, `${st.path}/review/${img.dataset.shot}`);
    return b ? URL.createObjectURL(b) : null;
  })()));
}

// ------------------------------------------------------------------ collection (batch scans)
function renderCollect() {
  const sel = $('#col-sector');
  if (sel.options.length < 2) sel.insertAdjacentHTML('beforeend', Object.entries(SECTORS).map(([k, v]) => `<option value="${k}">${esc(v.fr)}</option>`).join(''));
  $('#col-styles').innerHTML = Object.entries(STYLES).map(([k, v]) => `<button type="button" class="seg ${state.colStyles.has(k) ? 'on' : ''}" data-cs="${k}">${esc(v.fr)}</button>`).join('');
  $$('[data-cs]').forEach((b) => (b.onclick = () => {
    state.colStyles.has(b.dataset.cs) ? state.colStyles.delete(b.dataset.cs) : state.colStyles.size < 3 && state.colStyles.add(b.dataset.cs);
    renderCollect();
  }));
  $('#col-sources').innerHTML = SOURCES.map((x) => `<div class="src"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)} ↗</a><span>${esc(x.note)}</span></div>`).join('');
  const cov = categoryCoverage(state.packs);
  const max = Math.max(1, ...cov.sectors.map((x) => x.sites));
  $('#col-coverage').innerHTML = `<dl class="kv">${cov.sectors.filter((x) => x.key !== 'autre').map((x) => `<dt>${esc(x.label)}</dt><dd>${x.sites}<div class="bar-mini"><i style="width:${(x.sites / max) * 100}%"></i></div></dd>`).join('')}</dl><p class="hint">Vise 5 à 10 sites par secteur que tu veux vendre, avec des styles variés.</p>`;
  countUrls();
}
const parseUrls = () => [...new Set($('#col-urls').value.split(/\s+/).map((u) => u.trim()).filter(Boolean).map((u) => (/^https?:\/\//.test(u) ? u : 'https://' + u)).filter((u) => /^https?:\/\/[^/]+\.[^/]+/.test(u)))];
const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return u;
  }
};
function countUrls() {
  const urls = parseUrls();
  const known = new Set(state.packs.map((p) => p.domain));
  const skip = $('#col-skip').checked ? urls.filter((u) => known.has(hostOf(u))).length : 0;
  $('#col-count').textContent = urls.length ? `${urls.length - skip} site(s) à scanner${skip ? `, ${skip} déjà présent(s)` : ''} · ≈ ${Math.round((urls.length - skip) * 4.5)} min` : '';
}
$('#col-urls').addEventListener('input', countUrls);
$('#col-skip').addEventListener('change', countUrls);
$('#col-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (reBusy || focusBusy) return toast('Une autre analyse est en cours');
  if (!ready()) return toast('Choisis d’abord le dossier de la bibliothèque');
  const known = new Set(state.packs.map((p) => p.domain));
  const urls = parseUrls().filter((u) => !($('#col-skip').checked && known.has(hostOf(u))));
  if (!urls.length) return toast('Aucune adresse à scanner');
  const sector = $('#col-sector').value, styles = [...state.colStyles];
  const bps = $('#col-bps').value.split(',').map(Number);
  const st = (await chrome.storage.local.get(['dipSettings'])).dipSettings || {};
  reBusy = true;
  const job = $('#job');
  job.hidden = false;
  let ok = 0;
  const failed = [];
  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      $('#job-title').textContent = `Collecte ${i + 1}/${urls.length} · ${hostOf(url)}`;
      try {
        const { cap, analysis } = await dissectUrl(url, { deep: true, breakpoints: bps, consent: st.consent || 'reject', maxHovers: st.maxHovers || 30, exportMode: 'study' }, (x) => {
          $('#job-pct').textContent = x.pct + '%';
          $('#job-bar').style.width = x.pct + '%';
          $('#job-step').textContent = stepLabel('fr', x.label);
        });
        if (!analysis) throw new Error((cap.log.find((l) => l.level === 'error') || {}).error || 'analyse impossible');
        $('#job-step').textContent = 'Enregistrement…';
        const files = await buildPackFiles(cap, analysis, { mode: 'study' });
        if (sector || styles.length) files.push({ path: 'tags.json', data: JSON.stringify({ sector: sector || undefined, styles, source: 'collecte', updated: new Date().toISOString() }, null, 2) });
        await savePack(state.root, packName(cap), files);
        ok++;
      } catch (err) {
        console.error(err);
        failed.push(hostOf(url) + ' (' + (err.message || err) + ')');
      }
    }
  } finally {
    reBusy = false;
    job.hidden = true;
    await refresh();
  }
  toast(`${ok}/${urls.length} site(s) ajouté(s)${failed.length ? ' — échecs : ' + failed.length : ''}`);
  if (failed.length) $('#col-count').textContent = 'Échecs : ' + failed.join(' · ');
  else $('#col-urls').value = '';
});

// ------------------------------------------------------------------ drawer
function drawer(title, html) {
  $('#dr-title').innerHTML = title;
  $('#dr-body').innerHTML = html;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
}
function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}
$('#dr-close').onclick = closeDrawer;
$('#scrim').onclick = closeDrawer;
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());

async function openDoc(p, file, title) {
  const text = await fsAdapter(state.root).readText(p.path + '/' + file);
  drawer(`<span class="muted">${esc(p.domain)} /</span> ${esc(title || file)}`, `<button class="ghost" id="dr-back" style="align-self:flex-start"><svg viewBox="0 0 16 16"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>Retour</button><div class="md">${text == null ? '<p class="muted">Fichier introuvable.</p>' : renderMd(text)}</div>`);
  $('#dr-back').onclick = () => openPack(p);
}

function openPack(p) {
  const docs = [['SPEC.md', 'Spécification'], ['DESIGN_DNA.md', 'ADN'], ['ASSETS.md', 'Assets'], ['BUILD_PLAN.md', 'Plan'], ['verify-report.md', 'Vérification']].filter(([f]) => f !== 'DESIGN_DNA.md' || p.hasDna).filter(([f]) => f !== 'verify-report.md' || p.verified);
  drawer(
    `${esc(p.domain)} <span class="badge" style="margin-left:6px">Tier ${esc(p.tier)}</span>`,
    `<div class="muted small">${fmtDate(p.date)} · ${esc(p.mode || '')} · ${esc(p.stack.join(', ') || 'stack non détectée')}${p.scroll.lerp ? ' · lerp ' + p.scroll.lerp : ''}</div>
    <div class="dr-actions">
      ${docs.map(([f, l]) => `<button data-doc="${f}">${l}</button>`).join('')}
    </div>
    <div class="dr-actions">
      <button class="primary" id="dr-use">Utiliser comme référence</button>
      ${p.hasDna ? '' : `<button id="dr-dna">Copier /dip-dna</button>`}
      <button id="dr-re">${isOld(p) ? 'Redisséquer (nouvelle version)' : 'Redisséquer'}</button>
      <button id="dr-focus">Analyser une animation</button>
      <button class="ghost" id="dr-open">Ouvrir le site</button>
      <button class="ghost" id="dr-del">Supprimer</button>
    </div>
    <div class="cat-edit"><div class="label">Catégorie d’inspiration <span class="muted" style="text-transform:none;letter-spacing:0">(${p.categories && p.categories.source.sector === 'user' ? 'choisie par toi' : p.categories && p.categories.source.sector === 'dna' ? 'depuis l’ADN' : 'détectée automatiquement'})</span></div>
      <select id="cat-sel">${Object.entries(SECTORS).map(([k, v]) => `<option value="${k}" ${p.categories && p.categories.sector === k ? 'selected' : ''}>${esc(v.fr)}</option>`).join('')}</select>
      <div class="filters" id="cat-styles" style="margin:0">${Object.entries(STYLES).map(([k, v]) => `<button class="seg ${p.categories && p.categories.styles.includes(k) ? 'on' : ''}" data-st="${k}">${esc(v.fr)}</button>`).join('')}</div>
      <div class="muted small">Techniques mesurées : ${(p.categories ? p.categories.techniques : []).map((t) => esc(catLabel('technique', t))).join(', ') || '—'}</div>
      <div class="row gap"><button id="cat-fav">${p.categories && p.categories.favorite ? '★ Favori' : '☆ Ajouter aux favoris'}</button><button class="primary" id="cat-save">Enregistrer la catégorie</button></div>
    </div>
    ${p.palette.length ? `<div><div class="label" style="margin-bottom:8px">Palette</div><div class="dr-actions">${p.palette.map((c) => `<span class="chip"><i class="swatch" style="background:${esc(c.hex)}"></i><span class="mono">${esc(c.hex)}</span>${c.role ? `<span class="muted">${esc(c.role)}</span>` : ''}</span>`).join('')}</div></div>` : ''}
    ${p.fonts.length ? `<div><div class="label" style="margin-bottom:6px">Typographies</div><div>${p.fonts.map(esc).join(' · ')}</div></div>` : ''}
    <div><div class="label" style="margin-bottom:8px">Sections</div><div class="dr-secs">${p.sections.map((s) => `<div><img data-sec="${esc(s.id)}" alt=""><span>${esc(s.id)}</span></div>`).join('')}</div></div>
    <div><div class="label" style="margin-bottom:4px">Animations (${p.effects.length})</div><div class="dr-fx">${p.effects.map((e) => `<div data-fx="${esc(e.id)}" style="cursor:pointer"><span class="mono">${esc(e.id)}</span><span class="muted">${esc(TRIGGERS[e.trigger] || e.trigger)}${e.duration != null ? ' · ' + e.duration + ' s' : ''}</span></div>`).join('')}</div></div>`
  );
  $$('[data-sec]').forEach((img) => lazyImg(img, thumbOf(p, `${p.path}/reference/1440/${img.dataset.sec}.png`)));
  $$('[data-doc]').forEach((b) => (b.onclick = () => openDoc(p, b.dataset.doc, b.textContent)));
  $$('[data-fx]').forEach((d) => (d.onclick = () => openDoc(p, `motion/effects/${d.dataset.fx}.md`, d.dataset.fx)));
  $('#dr-use').onclick = () => {
    state.refs.add(p.path);
    state.refsTouched = true;
    closeDrawer();
    location.hash = 'create';
  };
  if ($('#dr-dna')) $('#dr-dna').onclick = () => copy('/dip-dna ' + p.path);
  $('#dr-open').onclick = () => chrome.tabs.create({ url: p.url });
  const chosen = new Set(p.categories ? p.categories.styles : []);
  let fav = !!(p.categories && p.categories.favorite);
  $$('[data-st]').forEach((b) => (b.onclick = () => {
    chosen.has(b.dataset.st) ? chosen.delete(b.dataset.st) : chosen.size < 3 && chosen.add(b.dataset.st);
    $$('[data-st]').forEach((x) => x.classList.toggle('on', chosen.has(x.dataset.st)));
  }));
  $('#cat-fav').onclick = () => {
    fav = !fav;
    $('#cat-fav').textContent = fav ? '★ Favori' : '☆ Ajouter aux favoris';
  };
  $('#cat-save').onclick = async () => {
    await writeFile(state.root, `${p.path}/tags.json`, JSON.stringify({ sector: $('#cat-sel').value, styles: [...chosen], favorite: fav, updated: new Date().toISOString() }, null, 2));
    await writeIndex(fsAdapter(state.root));
    await refresh();
    toast('Catégorie enregistrée');
    const np = state.packs.find((x) => x.path === p.path);
    if (np) openPack(np);
  };
  $('#dr-focus').onclick = () => {
    closeDrawer();
    runFocusJob(p.url);
  };
  $('#dr-re').onclick = () => {
    closeDrawer();
    redissect([p]);
  };
  $('#dr-del').onclick = async () => {
    if (!confirm(`Supprimer ${p.domain} (${p.name}) de la bibliothèque ?`)) return;
    await removePack(state.root, p.name);
    closeDrawer();
    await refresh();
    toast('Supprimé');
  };
}

// ------------------------------------------------------------------ create
function briefText(fd) {
  return [fd.get('company'), fd.get('sector'), fd.get('audience'), fd.get('goal'), fd.get('tone'), fd.get('notes'), fd.get('want3d') ? '3d immersif' : ''].join(' ');
}
function renderCreate() {
  $$('.seg', $('#cr-modes')).forEach((b) => b.classList.toggle('on', b.dataset.m === state.mode));
  $$('[data-for]').forEach((el) => (el.hidden = !el.dataset.for.split(' ').includes(state.mode)));
  $('#cr-folder').textContent = state.root ? state.root.name || 'de la bibliothèque' : '—';
  const fd = new FormData($('#cr-form'));
  // client pack
  const cl = $('#cr-client');
  const prev = cl.value;
  cl.innerHTML = state.packs.map((p) => `<option value="${esc(p.path)}">${esc(p.domain)} — ${fmtDate(p.date)}</option>`).join('') || '<option value="">Aucun pack</option>';
  if (prev) cl.value = prev;
  // references
  const ranked = rankReferences(state.packs.filter((p) => state.mode !== 'transform' || p.path !== cl.value), briefText(fd));
  if (!state.refsTouched) state.refs = new Set(ranked.slice(0, 3).map((r) => r.pack.path));
  $('#cr-refcount').textContent = `${state.refs.size} sélectionnée(s)`;
  $('#cr-refs').innerHTML = ranked.length
    ? ranked.map((r) => `<div class="ref ${state.refs.has(r.pack.path) ? 'on' : ''}" data-ref="${esc(r.pack.path)}"><input type="checkbox" ${state.refs.has(r.pack.path) ? 'checked' : ''}><i class="mini" data-mini="${esc(r.pack.path)}"></i><div style="min-width:0"><b>${esc(r.pack.domain)}</b><div class="why">${esc(r.why.join(' · ') || 'référence')}</div></div><span class="score">${r.score}</span></div>`).join('')
    : '<div class="empty-note">Scanne quelques sites premium pour obtenir des suggestions.</div>';
  $$('[data-mini]').forEach((el) => thumbOf(state.packs.find((p) => p.path === el.dataset.mini)).then((u) => u && (el.style.backgroundImage = `url(${u})`)));
  $$('.ref', $('#cr-refs')).forEach(
    (el) =>
      (el.onclick = () => {
        state.refsTouched = true;
        state.refs.has(el.dataset.ref) ? state.refs.delete(el.dataset.ref) : state.refs.add(el.dataset.ref);
        renderCreate();
      })
  );
  const nodna = state.packs.filter((p) => !p.hasDna);
  $('#cr-nodna').innerHTML = nodna.length ? nodna.map((p) => `<div class="ref on"><input type="checkbox" checked disabled><i class="mini" data-mini="${esc(p.path)}"></i><div><b>${esc(p.domain)}</b><div class="why">${esc(p.path)}</div></div><span></span></div>`).join('') : '<div class="empty-note">Tous les packs ont leur ADN.</div>';
  $$('[data-mini]', $('#cr-nodna')).forEach((el) => thumbOf(state.packs.find((p) => p.path === el.dataset.mini)).then((u) => u && (el.style.backgroundImage = `url(${u})`)));
}
$$('.seg', $('#cr-modes')).forEach((b) => (b.onclick = () => ((state.mode = b.dataset.m), renderCreate())));
let briefTimer = null;
$('#cr-form').addEventListener('input', (e) => {
  if (e.target.name === 'client') return renderCreate();
  clearTimeout(briefTimer);
  briefTimer = setTimeout(renderCreate, 350); // re-rank the references as the brief is typed
});
$('#cr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData($('#cr-form'));
  const refs = [...state.refs];
  let cmd = '';
  let cost = '';
  try {
    if (state.mode === 'clone') {
      const url = String(fd.get('url') || '').trim();
      if (!/^https?:\/\//.test(url)) return toast('Adresse invalide');
      cmd = `/dip-clone ${url}`;
      cost = 'Compte 1 à 3 h de travail de Claude selon le site. Aucun coût en plus de ton abonnement.';
    } else if (state.mode === 'dna') {
      const nodna = state.packs.filter((p) => !p.hasDna);
      if (!nodna.length) return toast('Tous les packs ont leur ADN');
      cmd = `/dip-dna ${nodna.map((p) => p.path).join(' ')}`;
      cost = 'Quelques minutes par pack, inclus dans ton abonnement.';
    } else {
      if (!fd.get('company') && !fd.get('notes')) return toast('Décris au moins le projet');
      if (!refs.length) return toast('Choisis au moins une référence');
      const name = slug(fd.get('company') || fd.get('sector'));
      const brief = [
        `# Brief — ${fd.get('company') || name}`,
        '',
        `- Entreprise / projet : ${fd.get('company') || '—'}`,
        `- Secteur : ${fd.get('sector') || '—'}`,
        `- Public : ${fd.get('audience') || '—'}`,
        `- Objectif : ${fd.get('goal') || '—'}`,
        `- Ton : ${fd.get('tone') || '—'}`,
        `- Langue : ${fd.get('lang')}`,
        `- 3D / immersif : ${fd.get('want3d') ? 'oui' : 'seulement si le concept le justifie'}`,
        '',
        '## Idée, contenus, contraintes',
        '',
        String(fd.get('notes') || '—'),
        '',
        '## Références choisies dans la bibliothèque',
        '',
        ...refs.map((r) => {
          const p = state.packs.find((x) => x.path === r);
          return `- ${r}${p ? ` (${p.domain})` : ''}`;
        }),
        state.mode === 'transform' ? `\n## Site actuel du client\n\n- ${fd.get('client')}` : '',
        '',
      ].join('\n');
      const file = `briefs/${name}.md`;
      await writeFile(state.root, file, brief);
      cmd = state.mode === 'transform' ? `/dip-transform ${fd.get('client')} ${refs.join(' ')} — brief : ${file}` : `/dip-create ${file} — références : ${refs.join(' ')}`;
      const noDna = refs.filter((r) => !(state.packs.find((p) => p.path === r) || {}).hasDna);
      cost = (noDna.length ? `${noDna.length} référence(s) sans ADN : Claude l’écrira d’abord (quelques minutes). ` : '') + 'Images et objets 3D ensuite à l’unité avec dip-assets (≈ 0,03 $ l’image).';
      toast('Brief enregistré : ' + file);
    }
    $('#cr-cmd').textContent = cmd;
    $('#cr-copy').disabled = false;
    $('#cr-cost').textContent = cost;
  } catch (err) {
    toast(err.message);
  }
});
$('#cr-copy').onclick = () => copy($('#cr-cmd').textContent);

// ------------------------------------------------------------------ re-dissect (new DIP version, same URLs)
const isOld = (p) => versionLess(p.analyzerVersion, ANALYZER_VERSION);
let reBusy = false;
const KEEP = ['DESIGN_DNA.md', 'dna.json', 'NOTES.md']; // written by Claude: kept across re-dissections
async function redissect(list) {
  if (reBusy || !list.length) return;
  if (!ready()) return toast('Autorise d’abord l’accès au dossier');
  if (list.length > 1 && !confirm(`Redisséquer ${list.length} site(s) ? Compte 3 à 6 minutes par site. Garde cette page visible pendant ce temps (une petite fenêtre s’ouvre pour chaque site).`)) return;
  reBusy = true;
  const st = (await chrome.storage.local.get(['dipSettings'])).dipSettings || {};
  const job = $('#job');
  job.hidden = false;
  let ok = 0;
  try {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const head = `Redissection ${i + 1}/${list.length} · ${p.domain}`;
      $('#job-title').textContent = head;
      const onProgress = (x) => {
        $('#job-pct').textContent = x.pct + '%';
        $('#job-bar').style.width = x.pct + '%';
        $('#job-step').textContent = stepLabel('fr', x.label);
      };
      try {
        const mode = p.mode === 'share' ? 'share' : 'study';
        const { cap, analysis } = await dissectUrl(p.url, { deep: true, breakpoints: st.breakpoints || [1440, 1024, 390], consent: st.consent || 'reject', maxHovers: st.maxHovers || 30, exportMode: mode }, onProgress);
        if (!analysis) throw new Error((cap.log.find((l) => l.level === 'error') || {}).error || 'analyse impossible');
        $('#job-step').textContent = 'Enregistrement dans la bibliothèque…';
        const files = await buildPackFiles(cap, analysis, { mode, transformImage: mode === 'share' ? shareImage : null });
        const fsa = fsAdapter(state.root);
        for (const f of KEEP) {
          const text = await fsa.readText(`${p.path}/${f}`);
          if (text != null && !files.some((x) => x.path === f)) files.push({ path: f, data: text });
        }
        const name = packName(cap) + (mode === 'share' ? '_share' : '');
        await savePack(state.root, name, files);
        if (name !== p.name) await removePack(state.root, p.name);
        ok++;
      } catch (e) {
        toast(`${p.domain} : ${e.message || e}`);
        console.error(e);
      }
    }
  } finally {
    reBusy = false;
    job.hidden = true;
    await refresh();
  }
  toast(`${ok}/${list.length} site(s) redisséqué(s)`);
}
$('#btn-redissect-all').onclick = () => redissect(state.packs.filter(isOld));

// ------------------------------------------------------------------ scan & import
$('#btn-scan').onclick = () => $('#dlg-scan').showModal();
$('#scan-go').onclick = (e) => {
  e.preventDefault();
  let url = $('#scan-url').value.trim();
  if (url && !/^https?:\/\//.test(url)) url = 'https://' + url;
  if (!/^https?:\/\/[^.]+\..+/.test(url)) return toast('Adresse invalide');
  // open the panel first, while the click still counts as a user gesture
  if (chrome.sidePanel && state.windowId != null) chrome.sidePanel.open({ windowId: state.windowId }).catch(() => {});
  chrome.tabs.create({ url, active: true });
  $('#dlg-scan').close();
};
$('#btn-import').onclick = async () => {
  if (!ready()) return state.root ? loadWorkspace(true).then(refresh) : choose();
  $('#file-import').click();
};
$('#file-import').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  for (const f of files) {
    try {
      toast('Import de ' + f.name + '…');
      const { name, files: entries } = await readPackZip(f);
      await savePack(state.root, name, entries);
    } catch (err) {
      toast(err.message);
    }
  }
  await refresh();
  toast(`${files.length} pack(s) importé(s)`);
};

// ------------------------------------------------------------------ wiring
$('#ws-btn').onclick = () => (state.root && state.access !== 'granted' ? loadWorkspace(true).then(refresh) : choose());
$('#btn-pick').onclick = choose;
$('#set-pick').onclick = choose;
$('#btn-pick-help').onclick = () => ($('#pick-help').hidden = !$('#pick-help').hidden);
$('#set-upd').onclick = async () => {
  const u = await showUpdate(true);
  toast(!u ? 'Vérification impossible (hors ligne ?)' : u.available ? `${u.tag} disponible` : `DIP est à jour (v${u.current})`);
};
$('#set-reindex').onclick = async () => {
  if (!ready()) return toast('Choisis d’abord un dossier');
  await writeIndex(fsAdapter(state.root));
  await refresh();
  toast('Index reconstruit');
};
$('#search').addEventListener('input', () => render());
$$('.seg', $('#lib-filters')).forEach(
  (b) =>
    (b.onclick = () => {
      state.libFilter = b.dataset.f;
      $$('.seg', $('#lib-filters')).forEach((x) => x.classList.toggle('on', x === b));
      renderLibrary();
    })
);
// scans saved from the side panel appear without reloading
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && ready() && refresh());

async function showUpdate(force) {
  const u = await checkUpdate(force).catch(() => null);
  const el = $('#update');
  if (!u || !u.available) {
    el.hidden = true;
    return u;
  }
  el.hidden = false;
  el.innerHTML = `<span><b>${esc(u.name || u.tag)}</b> est disponible (tu as la v${esc(u.current)}). Colle la commande dans PowerShell, puis recharge DIP.</span><span class="acts"><button id="upd-copy" class="primary">Copier la commande</button><button id="upd-reload">Recharger DIP</button><a class="link" href="${esc(u.url)}" target="_blank" rel="noopener">Nouveautés ↗</a></span>`;
  $('#upd-copy').onclick = () => copy(UPDATE_CMD);
  $('#upd-reload').onclick = () => chrome.runtime.reload();
  return u;
}

(async function init() {
  try {
    const v = 'v' + chrome.runtime.getManifest().version;
    $('#dip-version').textContent = v;
    $('#set-version').textContent = v;
  } catch (e) {
    /* tests outside the extension */
  }
  $('#set-analyzer').textContent = ANALYZER_VERSION;
  showUpdate(false);
  try {
    state.windowId = (await chrome.windows.getCurrent()).id;
  } catch (e) {
    /* not in an extension page (tests) */
  }
  await loadWorkspace(false);
  go(location.hash.slice(1) || 'overview');
  await refresh();
})();
