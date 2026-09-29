// DIP Studio — full-page dashboard: library folder, scans, measured animations, suggestions, creation commands.
import { getRoot, pickRoot, access, fsAdapter, readBlob, savePack, removePack, writeFile } from './lib/workspace.js';
import { listPacks, writeIndex, effectsByType, rankReferences, librarySuggestions, libraryStats, words } from './lib/library.js';
import { readPackZip } from './lib/unzip-web.js';
import { EFFECT_TYPES } from './lib/taxonomy.js';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TITLES = { overview: 'Vue d’ensemble', library: 'Bibliothèque', motion: 'Animations', create: 'Créer', settings: 'Réglages' };
const TRIGGERS = { load: 'au chargement', 'scroll-enter': 'à l’entrée au scroll', 'scroll-scrub': 'lié au scroll', hover: 'au survol', press: 'appui long', 'mouse-move': 'à la souris', click: 'au clic', drag: 'glisser', 'time-loop': 'en boucle', 'route-change': 'changement de page' };

const state = { root: null, access: 'none', packs: [], page: 'overview', libFilter: 'all', moTrigger: 'all', mode: 'create', refs: new Set(), refsTouched: false, windowId: null };
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
  ({ overview: renderOverview, library: renderLibrary, motion: renderMotion, create: renderCreate, settings: () => {} })[state.page]();
}

// ------------------------------------------------------------------ cards
function packCard(p) {
  const el = document.createElement('article');
  el.className = 'card';
  el.innerHTML = `<div class="thumb"><img alt=""><div class="tags"><span class="badge">Tier ${esc(p.tier)}</span>${p.threeD ? '<span class="badge violet">3D</span>' : ''}${p.hasDna ? '<span class="badge ok">ADN</span>' : ''}</div></div>
  <div class="card-b"><div class="card-t"><b>${esc(p.domain)}</b><span>${fmtDate(p.date)}</span></div>
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
  const sugg = librarySuggestions(state.packs);
  if (!state.packs.length) sugg.unshift({ kind: 'scan', text: 'Ta bibliothèque est vide : scanne un premier site (bouton « Scanner un site ») ou importe des packs .zip déjà téléchargés.' });
  $('#suggestions').innerHTML = sugg.map((x, i) => `<div class="sugg"><span class="ic ${x.kind}"></span><div>${esc(x.text)}</div>${x.command ? `<div class="cmdline"><code>${esc(x.command)}</code><button class="icon" data-copy="${i}" title="Copier"><svg viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8c0-.7.6-1.3 1.3-1.3H10"/></svg></button></div>` : ''}</div>`).join('');
  $$('[data-copy]', $('#suggestions')).forEach((b) => (b.onclick = () => copy(sugg[+b.dataset.copy].command)));
  $('#tempo').innerHTML = `<dl class="kv">
    <dt>Durée typique</dt><dd>${s.medianDuration != null ? s.medianDuration + ' s' : '—'}</dd>
    <dt>Scroll (lerp moyen)</dt><dd>${s.lerp != null ? s.lerp : '—'}</dd>
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
  const list = state.packs.filter((p) => (f === '3d' ? p.threeD : f === 'nodna' ? !p.hasDna : f === 'dna' ? p.hasDna : true) && matches(p, q));
  const grid = $('#lib-grid');
  grid.innerHTML = '';
  for (const p of list) grid.appendChild(packCard(p));
  if (!list.length) grid.innerHTML = `<div class="empty-note">${state.packs.length ? 'Aucun site ne correspond.' : 'Aucun scan : utilise « Scanner un site » ou « Importer ».'}</div>`;
}

// ------------------------------------------------------------------ motion index
function renderMotion() {
  const q = $('#search').value.toLowerCase();
  const groups = effectsByType(state.packs);
  const trig = new Set(state.packs.flatMap((p) => p.effects.map((e) => e.trigger)));
  $('#mo-filters').innerHTML = ['all', ...Object.keys(TRIGGERS).filter((t) => trig.has(t))].map((t) => `<button class="seg ${state.moTrigger === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? 'Tous' : TRIGGERS[t]}</button>`).join('');
  $$('.seg', $('#mo-filters')).forEach((b) => (b.onclick = () => ((state.moTrigger = b.dataset.t), renderMotion())));
  const out = [];
  for (const [type, list] of groups) {
    const rows = list.filter((e) => (state.moTrigger === 'all' || e.trigger === state.moTrigger) && (!q || [type, e.id, e.pack.domain, e.ease, e.technique].join(' ').toLowerCase().includes(q)));
    if (!rows.length) continue;
    out.push(`<div class="mo-group"><h3>${esc(type)} <em>${rows.length}</em></h3>${EFFECT_TYPES[type] ? `<p class="mo-desc">${esc(EFFECT_TYPES[type])}</p>` : ''}
      ${rows
        .slice(0, 60)
        .map((e) => `<div class="mo-row" data-pack="${esc(e.pack.path)}" data-id="${esc(e.id)}"><span>${esc(e.pack.domain)}</span><span class="mono">${esc(e.id)}</span><span class="muted">${esc(TRIGGERS[e.trigger] || e.trigger)}</span><span class="mono">${e.duration != null ? e.duration + ' s' : '—'}</span><span class="mono">${esc(e.ease || e.technique || '')}</span></div>`)
        .join('')}</div>`);
  }
  $('#mo-list').innerHTML = out.join('') || '<div class="empty-note">Aucune animation mesurée pour l’instant.</div>';
  $$('.mo-row').forEach((r) => (r.onclick = () => openDoc(state.packs.find((p) => p.path === r.dataset.pack), `motion/effects/${r.dataset.id}.md`, r.dataset.id)));
}

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
      <button class="ghost" id="dr-open">Ouvrir le site</button>
      <button class="ghost" id="dr-del">Supprimer</button>
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

(async function init() {
  try {
    state.windowId = (await chrome.windows.getCurrent()).id;
  } catch (e) {
    /* not in an extension page (tests) */
  }
  await loadWorkspace(false);
  go(location.hash.slice(1) || 'overview');
  await refresh();
})();
