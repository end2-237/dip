#!/usr/bin/env node
// dip-library — the studio's cumulative memory: every scanned site becomes searchable material for
// /dip-create and /dip-transform (art direction, palettes, type, sections, measured animations by need).
//
//   node cli/dip-library.js add <pack folder|pack.zip> [...] [--lib D:\DIP-Library]
//   node cli/dip-library.js index [--lib dir]          rebuild LIBRARY.md, EFFECTS.md, index.json
//   node cli/dip-library.js search <words> [--effect type] [--trigger scroll-scrub] [--lib dir]
//
// The library folder (default: $DIP_LIBRARY or ./dip-library) holds packs/<name>/ plus the indexes and the
// Claude Code commands, so opening Claude Code in it gives /dip-create, /dip-transform, /dip-dna directly.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from './lib/args.js';
import { unzip } from './lib/unzip.js';
import { writeIndex } from '../extension/lib/library.js';

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
};
const domain = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return u || '?';
  }
};

function libDir(a) {
  return path.resolve(a.lib || process.env.DIP_LIBRARY || 'dip-library');
}

function safeJoin(root, rel) {
  const p = path.resolve(root, rel);
  if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('unsafe path in zip: ' + rel);
  return p;
}

function addPack(lib, src) {
  src = path.resolve(src);
  if (!fs.existsSync(src)) throw new Error('not found: ' + src);
  const packs = path.join(lib, 'packs');
  fs.mkdirSync(packs, { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error(src + ' is not a DIP pack (no manifest.json)');
    const dest = path.join(packs, path.basename(src));
    if (path.resolve(dest) !== src) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    }
    return dest;
  }
  // zip: the extension writes <pack-name>/<files>; tolerate a zip without the top folder
  const files = unzip(fs.readFileSync(src));
  const manifest = files.find((f) => /(^|\/)manifest\.json$/.test(f.path) && f.path.split('/').length <= 2);
  if (!manifest) throw new Error(src + ' is not a DIP pack zip (no manifest.json)');
  const prefix = manifest.path.slice(0, -'manifest.json'.length);
  const name = prefix ? prefix.replace(/\/$/, '') : path.basename(src, '.zip');
  const dest = path.join(packs, name);
  fs.rmSync(dest, { recursive: true, force: true });
  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const p = safeJoin(dest, f.path.slice(prefix.length));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
  return dest;
}

// node:fs adapter for the shared library code
function nodeFs(lib) {
  const abs = (p) => path.join(lib, ...p.split('/'));
  return {
    list: async (dir) => (fs.existsSync(abs(dir)) ? fs.readdirSync(abs(dir), { withFileTypes: true }).map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' })) : []),
    readText: async (p) => (fs.existsSync(abs(p)) ? fs.readFileSync(abs(p), 'utf8') : null),
    writeText: async (p, text) => {
      fs.mkdirSync(path.dirname(abs(p)), { recursive: true });
      fs.writeFileSync(abs(p), text);
    },
  };
}

async function search(lib, a) {
  const idx = readJson(path.join(lib, 'index.json')) || { packs: await writeIndex(nodeFs(lib)) };
  const words = a._.slice(1).map((w) => w.toLowerCase());
  const rows = [];
  for (const p of idx.packs) {
    const hay = [p.domain, p.title, ...(p.dna ? [...p.dna.keywords, p.dna.register, ...p.dna.sectors] : []), ...p.fonts, ...p.stack].join(' ').toLowerCase();
    const packHit = words.every((w) => hay.includes(w) || p.effects.some((e) => (e.type || '').includes(w)));
    if (!packHit) continue;
    const fx = p.effects.filter((e) => (!a.effect || e.type === a.effect) && (!a.trigger || e.trigger === a.trigger));
    if ((a.effect || a.trigger) && !fx.length) continue;
    rows.push(`${p.domain} (tier ${p.tier}${p.threeD ? ', 3D' : ''}) — ${p.path}`);
    for (const e of fx.slice(0, 12)) rows.push(`   ${e.id}: ${e.type} · ${e.trigger}${e.duration != null ? ` · ${e.duration}s` : ''}${e.ease ? ` · ${e.ease}` : ''}`);
  }
  console.log(rows.length ? rows.join('\n') : 'no match');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const lib = libDir(a);
  const cmd = a._[0];
  if (cmd === 'add') {
    if (a._.length < 2) throw new Error('usage: dip-library add <pack folder|zip> [...]');
    fs.mkdirSync(lib, { recursive: true });
    for (const src of a._.slice(1)) console.error(`✓ ${path.relative(process.cwd(), addPack(lib, src)) || '.'}`);
    const packs = await writeIndex(nodeFs(lib));
    console.error(`library: ${packs.length} site(s) → ${path.join(lib, 'LIBRARY.md')}`);
  } else if (cmd === 'index') {
    fs.mkdirSync(lib, { recursive: true });
    const packs = await writeIndex(nodeFs(lib));
    console.error(`library: ${packs.length} site(s) → ${path.join(lib, 'LIBRARY.md')}`);
  } else if (cmd === 'search') await search(lib, a);
  else {
    console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
}

main().catch((e) => {
  console.error('✗ ' + e.message);
  process.exit(1);
});
