// Workspace folder = the DIP library on disk (File System Access API). The directory handle is kept in
// IndexedDB; Chrome asks again for access after a restart, which needs a click (requestPermission).
import { saveScan, loadScan } from './store.js';
import { writeIndex, listPacks } from './library.js';

const KEY = 'workspace';

export async function getRoot() {
  // tests: ?opfs=1 uses the origin-private file system (a real directory handle, no picker)
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('opfs')) return navigator.storage.getDirectory();
  return loadScan(KEY).catch(() => null);
}

export async function pickRoot() {
  const h = await window.showDirectoryPicker({ id: 'dip-library', mode: 'readwrite', startIn: 'documents' });
  await saveScan(KEY, h);
  return h;
}

// 'granted' | 'prompt' | 'denied' | 'none'
export async function access(root, interactive) {
  if (!root) return 'none';
  if (!root.queryPermission) return 'granted';
  let st = await root.queryPermission({ mode: 'readwrite' });
  if (st !== 'granted' && interactive) st = await root.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
  return st;
}

async function dirOf(root, parts, create) {
  let d = root;
  for (const p of parts) if (p) d = await d.getDirectoryHandle(p, { create });
  return d;
}

// Adapter for library.js
export function fsAdapter(root) {
  const split = (p) => p.split('/').filter(Boolean);
  return {
    async list(dir) {
      const d = await dirOf(root, split(dir), false).catch(() => null);
      if (!d) return [];
      const out = [];
      for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
      return out;
    },
    async readText(p) {
      const f = await fileHandle(root, p, false).catch(() => null);
      return f ? (await f.getFile()).text() : null;
    },
    async writeText(p, text) {
      await writeFile(root, p, text);
    },
  };
}

export async function fileHandle(root, p, create) {
  const parts = p.split('/').filter(Boolean);
  const d = await dirOf(root, parts.slice(0, -1), create);
  return d.getFileHandle(parts[parts.length - 1], { create });
}

export async function writeFile(root, p, data) {
  const f = await fileHandle(root, p, true);
  const w = await f.createWritable();
  await w.write(data);
  await w.close();
}

export async function readBlob(root, p) {
  const f = await fileHandle(root, p, false).catch(() => null);
  return f ? f.getFile() : null;
}

// Save a pack (files from buildPackFiles) under packs/<name>/ and refresh the library indexes.
export async function savePack(root, name, files, onProgress) {
  const base = await dirOf(root, ['packs'], true);
  await base.removeEntry(name, { recursive: true }).catch(() => {});
  let n = 0;
  for (const f of files) {
    await writeFile(root, `packs/${name}/${f.path}`, f.data);
    if (onProgress && ++n % 25 === 0) onProgress(n / files.length);
  }
  await writeIndex(fsAdapter(root));
  return `packs/${name}`;
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return '';
  }
};

// Packs already in the library for this site (same domain), newest first. Reads index.json (fast),
// falls back to scanning packs/ when the index is missing.
export async function findPacksFor(root, url) {
  const host = hostOf(url);
  if (!root || !host) return [];
  const fsa = fsAdapter(root);
  let packs = null;
  try {
    packs = (JSON.parse((await fsa.readText('index.json')) || 'null') || {}).packs || null;
  } catch (e) {
    /* rebuild below */
  }
  if (!packs) packs = await listPacks(fsa).catch(() => []);
  return packs.filter((p) => hostOf(p.url) === host || p.domain === host).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Files written by Claude or by the user: carried over when a site is dissected again
export const KEEP_ON_REDISSECT = ['DESIGN_DNA.md', 'dna.json', 'NOTES.md', 'tags.json'];

// Save a new dissection of a site that is already in the library: keeps the DNA, notes and categories
// of the previous pack(s), then removes them.
export async function replacePack(root, name, files, previous, onProgress) {
  const fsa = fsAdapter(root);
  for (const old of previous || []) {
    for (const f of KEEP_ON_REDISSECT) {
      if (files.some((x) => x.path === f)) continue;
      const text = await fsa.readText(`${old.path}/${f}`);
      if (text != null) files.push({ path: f, data: text });
    }
  }
  const dir = await savePack(root, name, files, onProgress);
  for (const old of previous || []) if (old.name !== name) await removePack(root, old.name).catch(() => {});
  return dir;
}

export async function removePack(root, name) {
  const base = await dirOf(root, ['packs'], false);
  await base.removeEntry(name, { recursive: true });
  await writeIndex(fsAdapter(root));
}

// Focus analysis → effects/<slug>/ and refreshed indexes
export async function saveFocus(root, slug, files) {
  for (const f of files) await writeFile(root, `effects/${slug}/${f.path}`, f.data);
  await writeIndex(fsAdapter(root));
  return `effects/${slug}`;
}
