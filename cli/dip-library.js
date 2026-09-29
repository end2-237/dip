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
import { COMMANDS } from '../extension/lib/commands.js';
import { EFFECT_TYPES } from '../extension/lib/taxonomy.js';

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

function summarize(dir) {
  const m = readJson(path.join(dir, 'manifest.json'));
  if (!m) return null;
  const tokens = readJson(path.join(dir, 'design/tokens.json')) || {};
  const dna = readJson(path.join(dir, 'dna.json'));
  const scroll = readJson(path.join(dir, 'motion/scroll-system.json')) || {};
  const palette = Object.values(tokens.color || {})
    .filter((c) => c.$extensions && c.$extensions.dip && c.$extensions.dip.share != null)
    .map((c) => ({ hex: c.$value, share: c.$extensions.dip.share, role: c.$extensions.dip.role || null }))
    .slice(0, 8);
  const fonts = [...new Set(Object.values(tokens.typography || {}).map((t) => t.$value && t.$value.fontFamily && t.$value.fontFamily.split(',')[0].replace(/["']/g, '').trim()).filter(Boolean))];
  const effects = [];
  const fxDir = path.join(dir, 'motion/effects');
  for (const f of fs.existsSync(fxDir) ? fs.readdirSync(fxDir).filter((f) => f.endsWith('.json')).sort() : []) {
    const e = readJson(path.join(fxDir, f));
    if (!e) continue;
    const an = e.animation || {};
    effects.push({ id: e.id, type: e.effect_type, trigger: e.trigger, technique: e.technique, source: e.source, section: e.section, duration: an.duration ?? null, ease: an.ease || null, stagger: an.stagger ?? null, confidence: e.confidence });
  }
  const sections = readJson(path.join(dir, 'structure/sections.json')) || [];
  return {
    name: path.basename(dir),
    path: path.relative(path.dirname(path.dirname(dir)), dir).split(path.sep).join('/'),
    url: m.url,
    domain: domain(m.url),
    title: m.title,
    date: m.date,
    tier: m.tier,
    complexity: m.complexity,
    stack: (m.detectedStack || []).filter((s) => s.confidence >= 0.6).map((s) => s.name),
    threeD: fs.existsSync(path.join(dir, 'webgl/three-scene.md')) || (m.webgl || []).length > 0,
    scroll: { type: scroll.type || null, lerp: scroll.measuredLerp || null },
    palette,
    fonts,
    sections: sections.map((s) => ({ id: s.id, heading: s.heading || null, height: s.height || null })),
    effects,
    dna: dna ? { keywords: dna.keywords || [], register: dna.register || null, sectors: dna.sectors || [], signatureEffects: dna.signatureEffects || [], tempo: dna.tempo || null } : null,
  };
}

function writeIndex(lib) {
  const packsDir = path.join(lib, 'packs');
  const dirs = fs.existsSync(packsDir) ? fs.readdirSync(packsDir).map((d) => path.join(packsDir, d)).filter((d) => fs.existsSync(path.join(d, 'manifest.json'))) : [];
  const packs = dirs.map(summarize).filter(Boolean).sort((a, b) => a.domain.localeCompare(b.domain) || String(b.date).localeCompare(String(a.date)));
  fs.writeFileSync(path.join(lib, 'index.json'), JSON.stringify({ generator: 'dip-library', updated: new Date().toISOString(), packs }, null, 2));

  const o = ['# DIP library', '', `${packs.length} site(s). Open Claude Code in this folder and use \`/dip-create <brief>\`, \`/dip-transform <client pack> <reference packs>\` or \`/dip-dna\` (inside a pack).`, ''];
  const noDna = packs.filter((p) => !p.dna);
  if (noDna.length) o.push(`⚠ ${noDna.length} pack(s) without DESIGN_DNA yet: ${noDna.map((p) => '`' + p.name + '`').join(', ')} — run /dip-dna in each (it needs no API key).`, '');
  o.push('| Site | Tier | 3D | Scroll | Palette | Fonts | Effects | DNA keywords |');
  o.push('|---|---|---|---|---|---|---|---|');
  for (const p of packs)
    o.push(`| [${p.domain}](packs/${p.name}/SPEC.md) | ${p.tier} | ${p.threeD ? '✓' : ''} | ${p.scroll.type || ''}${p.scroll.lerp ? ' ' + p.scroll.lerp : ''} | ${p.palette.slice(0, 5).map((c) => c.hex).join(' ')} | ${p.fonts.slice(0, 3).join(', ')} | ${p.effects.length} | ${p.dna ? p.dna.keywords.slice(0, 6).join(', ') : '—'} |`);
  o.push('');
  fs.writeFileSync(path.join(lib, 'LIBRARY.md'), o.join('\n'));

  // animation guide by need: every measured effect grouped by type, with its measured values
  const byType = new Map();
  for (const p of packs) for (const e of p.effects) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push({ ...e, pack: p });
  }
  const g = ['# Effects index — measured animations by need', '', 'Each line links to a measured effect card. Reuse the measured values (duration, easing, stagger, lerp); never the original code or assets.', ''];
  for (const [type, list] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
    g.push(`## ${type} (${list.length})`);
    g.push('');
    if (EFFECT_TYPES[type]) g.push(`_${EFFECT_TYPES[type]}_`, '');
    for (const e of list.slice(0, 40))
      g.push(`- [${e.pack.domain} · ${e.id}](packs/${e.pack.name}/motion/effects/${e.id}.md) — ${e.trigger}${e.duration != null ? `, ${e.duration}s` : ''}${e.ease ? `, ${e.ease}` : ''}${e.stagger != null ? `, stagger ${e.stagger}` : ''} (${e.technique || '?'}, conf ${e.confidence})`);
    g.push('');
  }
  fs.writeFileSync(path.join(lib, 'EFFECTS.md'), g.join('\n'));

  // Claude Code commands at the library root
  for (const [name, body] of Object.entries(COMMANDS)) {
    const p = path.join(lib, '.claude/commands', name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return packs;
}

function search(lib, a) {
  const idx = readJson(path.join(lib, 'index.json')) || { packs: writeIndex(lib) };
  const words = a._.slice(1).map((w) => w.toLowerCase());
  const rows = [];
  for (const p of idx.packs) {
    const hay = [p.domain, p.title, ...(p.dna ? [...p.dna.keywords, p.dna.register, ...p.dna.sectors] : []), ...p.fonts, ...p.stack].join(' ').toLowerCase();
    const packHit = words.every((w) => hay.includes(w) || p.effects.some((e) => (e.type || '').includes(w)));
    if (!packHit) continue;
    const fx = p.effects.filter((e) => (!a.effect || e.type === a.effect) && (!a.trigger || e.trigger === a.trigger));
    if ((a.effect || a.trigger) && !fx.length) continue;
    rows.push(`${p.domain} (tier ${p.tier}${p.threeD ? ', 3D' : ''}) — packs/${p.name}`);
    for (const e of fx.slice(0, 12)) rows.push(`   ${e.id}: ${e.type} · ${e.trigger}${e.duration != null ? ` · ${e.duration}s` : ''}${e.ease ? ` · ${e.ease}` : ''}`);
  }
  console.log(rows.length ? rows.join('\n') : 'no match');
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const lib = libDir(a);
  const cmd = a._[0];
  if (cmd === 'add') {
    if (a._.length < 2) throw new Error('usage: dip-library add <pack folder|zip> [...]');
    fs.mkdirSync(lib, { recursive: true });
    for (const src of a._.slice(1)) console.error(`✓ ${path.relative(process.cwd(), addPack(lib, src)) || '.'}`);
    const packs = writeIndex(lib);
    console.error(`library: ${packs.length} site(s) → ${path.join(lib, 'LIBRARY.md')}`);
  } else if (cmd === 'index') {
    fs.mkdirSync(lib, { recursive: true });
    const packs = writeIndex(lib);
    console.error(`library: ${packs.length} site(s) → ${path.join(lib, 'LIBRARY.md')}`);
  } else if (cmd === 'search') search(lib, a);
  else {
    console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 2 : 0);
  }
}

try {
  main();
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
