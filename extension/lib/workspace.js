// Workspace folder = the DIP library on disk (File System Access API). The directory handle is kept in
// IndexedDB; Chrome asks again for access after a restart, which needs a click (requestPermission).
import { saveScan, loadScan } from './store.js';
import { writeIndex } from './library.js';

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
