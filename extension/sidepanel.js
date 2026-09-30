// DIP side panel: UI + scan orchestration (the panel stays alive while open, unlike the MV3 service worker).
import { bytesToB64 } from './lib/std-driver.js';
import { dissectTab, shareImage, focusTab } from './lib/runner.js';
import { analyzeFocus, focusFiles } from './lib/focus.js';
import { checkUpdate } from './lib/update.js';
import { buildPackZip, buildPackFiles, packName } from './lib/pack.js';
import { getRoot, access, savePack, saveFocus } from './lib/workspace.js';
import { synthesize } from './lib/llm.js';
import { saveScan, loadScan } from './lib/store.js';
import { t as tr, stepLabel } from './lib/i18n.js';
import { analyze } from './lib/analyzer.js';
import { renameFrames } from './lib/scan.js';

const $ = (s) => document.querySelector(s);
const settings = { lang: 'fr', apiKey: '', useLLM: false, onboarded: false, mode: 'deep', exportMode: 'study', consent: 'reject', maxHovers: 20, breakpoints: [1440, 1024, 390] };
let current = null; // { cap, analysis }
let busy = false;
let stopResolver = null;

const t = (k) => tr(settings.lang, k);

// ------------------------------------------------------------------ settings
async function loadSettings() {
  const s = await chrome.storage.local.get(['dipSettings']);
  Object.assign(settings, s.dipSettings || {});
}
async function saveSettings() {
  await chrome.storage.local.set({ dipSettings: settings });
}
function applyI18n() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}
function syncForm() {
  $('#set-lang').value = settings.lang;
  $('#set-key').value = settings.apiKey || '';
  $('#set-llm').checked = !!settings.useLLM;
  $('#opt-mode').value = settings.mode;
  $('#opt-export').value = settings.exportMode;
  $('#opt-consent').value = settings.consent;
  $('#opt-hovers').value = settings.maxHovers;
  document.querySelectorAll('.bps input').forEach((i) => (i.checked = settings.breakpoints.includes(+i.value)));
}
function readForm() {
  settings.mode = $('#opt-mode').value;
  settings.exportMode = $('#opt-export').value;
  settings.consent = $('#opt-consent').value;
  settings.maxHovers = Math.max(0, Math.min(60, +$('#opt-hovers').value || 0));
  settings.breakpoints = [...document.querySelectorAll('.bps input')].filter((i) => i.checked).map((i) => +i.value).sort((a, b) => b - a);
}

// ------------------------------------------------------------------ tab
async function activeTab() {
  const forced = new URLSearchParams(location.search).get('tab'); // e2e tests open the panel as a tab
  if (forced) return chrome.tabs.get(+forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
async function refreshTab() {
  const tab = await activeTab();
  $('#tab-url').textContent = tab && tab.url ? tab.url : '—';
}
chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((id, info) => info.url && refreshTab());

// ------------------------------------------------------------------ UI helpers
function message(text, kind) {
  const m = $('#message');
  m.hidden = !text;
  m.className = 'card ' + (kind || '');
  m.textContent = text || '';
}
function setBusy(b) {
  busy = b;
  $('#btn-dissect').disabled = b;
  $('#btn-record').disabled = b;
  $('#btn-focus').disabled = b;
  $('#progress').hidden = !b;
}
function onProgress(p) {
  $('#progress-pct').textContent = p.pct + '%';
  $('#progress-bar').style.width = p.pct + '%';
  $('#progress-step').textContent = stepLabel(settings.lang, p.label);
}

// ------------------------------------------------------------------ scan

async function start(manual) {
  if (busy) return;
  readForm();
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    message(t('notHttp'), 'error');
    return;
  }
  const origin = new URL(tab.url).origin + '/*';
  const deep = settings.mode === 'deep';
  // Standard mode needs a host permission for this site (asked per domain, spec §5.2).
  if (!deep) {
    const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
    if (!granted) {
      message(t('permissionDenied'), 'error');
      return;
    }
  }
  await saveSettings();
  // ask for the library folder now: the permission prompt needs the click, the save happens at the end
  const root = await getRoot().catch(() => null);
  const rootOk = root ? (await access(root, true).catch(() => 'denied')) === 'granted' : false;
  message('');
  $('#review').hidden = true;
  setBusy(true);
  $('#progress-title').textContent = manual ? t('manualRunning') : t('running');
  $('#btn-stop').hidden = !manual;

  try {
    const manualCtl = manual ? { waitForStop: new Promise((r) => (stopResolver = r)) } : null;
    const { cap, analysis } = await dissectTab(tab, { deep, breakpoints: settings.breakpoints, consent: settings.consent, maxHovers: settings.maxHovers, exportMode: settings.exportMode, manual: manualCtl }, onProgress);
    if (!analysis) throw new Error((cap.log.find((l) => l.level === 'error') || {}).error || 'no analysis');
    if (settings.useLLM && settings.apiKey) {
      $('#progress-step').textContent = t('llmRunning');
      try {
        await synthesize(analysis, settings.apiKey);
      } catch (e) {
        cap.log.push({ step: 'llm', level: 'warn', error: String(e.message || e) });
        message(t('llmFailed') + ' — ' + e.message, 'error');
      }
    }
    current = { cap, analysis };
    await saveScan('last', current).catch((e) => console.warn('save failed', e));
    renderReview();
    if (rootOk) await saveToLibrary(root, true);
    else if (!$('#message').textContent) message(root ? t('workspaceLocked') : t('done') + ' — ' + t('noWorkspace'), root ? 'error' : 'ok');
  } catch (e) {
    console.error(e);
    message(t('failed') + ' : ' + (e.message || e), 'error');
  } finally {
    stopResolver = null;
    setBusy(false);
  }
}

// ------------------------------------------------------------------ review
function renderReview() {
  if (!current || !current.analysis) return;
  const { cap, analysis } = current;
  $('#review').hidden = false;
  $('#rv-tier').textContent = 'Tier ' + analysis.tier.tier;
  $('#rv-tier').className = 'tier ' + analysis.tier.tier;
  $('#rv-tier').title = analysis.tier.why;
  $('#rv-meta').textContent = `${cap.meta.url} · ${new Date(cap.meta.date).toLocaleString()} · ${cap.meta.captureMode} · ${analysis.effects.length} ${t('effects').toLowerCase()} · ${analysis.sections.length} sections`;
  const st = $('#rv-stack');
  st.innerHTML = '';
  for (const s of analysis.stack.filter((x) => x.confidence >= 0.5)) {
    const sp = document.createElement('span');
    sp.textContent = s.name + (s.version ? '@' + s.version : '');
    sp.title = s.evidence.join('\n') + '\nconfidence ' + s.confidence;
    if (s.confidence < 0.7) sp.className = 'low';
    st.appendChild(sp);
  }
  const errs = cap.log.filter((l) => l.level === 'error');
  $('#rv-errors').textContent = errs.length ? `${errs.length} ${t('stepErrors')}: ${errs.map((e) => e.step).join(', ')}` : '';
  const secs = $('#rv-sections');
  secs.innerHTML = '';
  for (const s of analysis.sections) {
    const d = document.createElement('div');
    d.className = 'sec';
    const shot = cap.screenshots[`reference/1440/${s.id}.png`] || Object.entries(cap.screenshots).find(([k]) => k.endsWith('/' + s.id + '.png'))?.[1];
    if (shot) {
      const img = document.createElement('img');
      img.src = 'data:image/png;base64,' + shot;
      img.alt = s.id;
      d.appendChild(img);
    }
    const l = document.createElement('div');
    l.textContent = `${s.id} · ${s.height}px`;
    d.appendChild(l);
    secs.appendChild(d);
  }
  const fx = $('#rv-effects');
  fx.innerHTML = '';
  for (const e of analysis.effects) {
    const row = document.createElement('div');
    row.className = 'fx';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = e._include !== false;
    cb.addEventListener('change', () => (e._include = cb.checked));
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'id';
    name.value = e.id;
    name.title = t('rename');
    name.addEventListener('change', () => renameEffect(e, name));
    const meta = document.createElement('div');
    meta.className = 'meta';
    const src = e.source.startsWith('read') ? 'read' : 'measured';
    meta.innerHTML = `<span class="badge">${esc(e.effect_type)}</span><span class="badge">${esc(e.trigger)}</span><span class="badge ${src}">${esc(e.source)}</span>${e.confidence < 0.6 ? `<span class="badge lowc">${t('confidence')} ${e.confidence}</span>` : `<span class="badge">${e.confidence}</span>`}<br>${esc(summaryOf(e))}`;
    row.append(cb, name, meta);
    fx.appendChild(row);
  }
}
function summaryOf(e) {
  const a = e.animation || {};
  const parts = [];
  if (a.duration != null) parts.push(a.duration + 's');
  if (a.ease) parts.push(a.ease);
  if (a.stagger != null && typeof a.stagger !== 'object') parts.push('stagger ' + a.stagger);
  if (e.scrollTrigger) parts.push(`ST ${e.scrollTrigger.start} → ${e.scrollTrigger.end}${e.scrollTrigger.scrub ? ' scrub' : ''}${e.scrollTrigger.pin ? ' pin' : ''}`);
  parts.push((e.targets || []).slice(0, 2).map((x) => x.selector).join(', '));
  return parts.filter(Boolean).join(' · ');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function renameEffect(e, input) {
  const prefix = e.id.match(/^e\d+/)[0];
  const slug = input.value.replace(/^e\d+-?/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'effect';
  const newId = prefix + '-' + slug;
  if (current.analysis.effects.some((x) => x !== e && x.id === newId)) {
    input.value = e.id;
    return;
  }
  // keep reference frame names in sync
  for (const [k, v] of Object.entries(current.cap.screenshots)) {
    if (k.includes('/' + e.id + '_')) {
      delete current.cap.screenshots[k];
      current.cap.screenshots[k.replace('/' + e.id + '_', '/' + newId + '_')] = v;
    }
  }
  e.id = newId;
  input.value = newId;
  saveScan('last', current).catch(() => {});
}

// ------------------------------------------------------------------ export

async function exportPack(selectedOnly) {
  if (!current) return;
  readForm();
  message(t('exporting'));
  try {
    const selection = selectedOnly ? current.analysis.effects.filter((e) => e._include !== false).map((e) => e.id) : null;
    const { name, bytes } = await buildPackZip(current.cap, current.analysis, { mode: settings.exportMode, selection, transformImage: settings.exportMode === 'share' ? shareImage : null });
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    await chrome.downloads.download({ url, filename: (settings.exportMode === 'share' ? name.replace('.zip', '_share.zip') : name), saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message(`${t('exported')} : ${name} (${Math.round(bytes.length / 1024)} Ko)`, 'ok');
  } catch (e) {
    console.error(e);
    message(String(e.message || e), 'error');
  }
}

async function saveToLibrary(root, auto) {
  if (!current) return;
  readForm();
  try {
    root = root || (await getRoot());
    if (!root) {
      message(t('noWorkspace'), 'error');
      return;
    }
    if ((await access(root, true)) !== 'granted') {
      message(t('workspaceLocked'), 'error');
      return;
    }
    const selection = null;
    const files = await buildPackFiles(current.cap, current.analysis, { mode: settings.exportMode, selection, transformImage: settings.exportMode === 'share' ? shareImage : null });
    const name = packName(current.cap).replace(/\.zip$/, '') + (settings.exportMode === 'share' ? '_share' : '');
    const dir = await savePack(root, name, files, (f) => message(`${t('saveLib')}… ${Math.round(f * 100)}%`));
    message(`${auto ? t('done') + ' · ' : ''}${t('savedLib')} : ${root.name}/${dir}`, 'ok');
  } catch (e) {
    console.error(e);
    message(String(e.message || e), 'error');
  }
}

// ------------------------------------------------------------------ focus analysis (one animation)
async function startFocus() {
  if (busy) return;
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    message(t('notHttp'), 'error');
    return;
  }
  const root = await getRoot().catch(() => null);
  const rootOk = root ? (await access(root, true).catch(() => 'denied')) === 'granted' : false;
  if (!rootOk) {
    message(root ? t('workspaceLocked') : t('noWorkspace'), 'error');
    return;
  }
  setBusy(true);
  $('#progress-title').textContent = t('focus');
  $('#btn-stop').hidden = true;
  message(t('focusWait'), 'ok');
  try {
    const fc = await focusTab(tab, onProgress);
    if (!fc) {
      message(t('focusCancelled'));
      return;
    }
    const fa = analyzeFocus(fc);
    const { slug, files, json } = focusFiles(fc, fa);
    const dir = await saveFocus(root, slug, files);
    message(`${t('focusSaved')} : ${json.commonName.fr} (${fa.effects.length}) → ${root.name}/${dir} — Claude Code : /dip-effect ${dir}`, 'ok');
  } catch (e) {
    console.error(e);
    message(t('failed') + ' : ' + (e.message || e), 'error');
  } finally {
    setBusy(false);
  }
}

// ------------------------------------------------------------------ wiring
$('#btn-save-lib').addEventListener('click', () => saveToLibrary(null, false));
$('#btn-dashboard').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
$('#btn-dissect').addEventListener('click', () => start(false));
$('#btn-record').addEventListener('click', () => start(true));
$('#btn-focus').addEventListener('click', () => startFocus());
$('#btn-stop').addEventListener('click', () => stopResolver && stopResolver());
$('#btn-export').addEventListener('click', () => exportPack(false));
$('#btn-export-sel').addEventListener('click', () => exportPack(true));
$('#btn-settings').addEventListener('click', () => ($('#settings').hidden = !$('#settings').hidden));
$('#btn-settings-save').addEventListener('click', async () => {
  settings.lang = $('#set-lang').value;
  settings.apiKey = $('#set-key').value.trim();
  settings.useLLM = $('#set-llm').checked;
  await saveSettings();
  applyI18n();
  $('#settings').hidden = true;
  if (current) renderReview();
});
$('#btn-onboard-ok').addEventListener('click', async () => {
  settings.onboarded = true;
  await saveSettings();
  $('#onboarding').hidden = true;
});
chrome.debugger.onDetach.addListener((src, reason) => {
  if (busy && reason === 'canceled_by_user') message(t('failed') + ' : debugger detached', 'error');
});

(async function init() {
  await loadSettings();
  applyI18n();
  syncForm();
  $('#onboarding').hidden = !!settings.onboarded;
  await refreshTab();
  checkUpdate(false).then((u) => {
    if (u && u.available && !busy && !$('#message').textContent) message(`${u.name || u.tag} disponible — ouvre le tableau de bord (▦) pour mettre DIP à jour.`, 'ok');
  }).catch(() => {});
  const last = await loadScan('last').catch(() => null);
  if (last && last.cap) {
    current = last;
    if (!current.analysis) {
      current.analysis = analyze(current.cap);
      renameFrames(current.cap, current.analysis);
    }
    renderReview();
  }
})();

export { bytesToB64 };
