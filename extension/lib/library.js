// DIP library: the studio's cumulative memory. A library folder holds packs/<name>/ (one DIP pack per scan)
// plus index.json, LIBRARY.md (all sites), EFFECTS.md (measured animations by need) and the Claude Code
// commands, so Claude Code opened in the folder gets /dip-create, /dip-transform, /dip-clone, /dip-dna.
// Shared by the extension dashboard (File System Access) and cli/dip-library.js (node:fs) through a small
// async adapter: { list(dir) → [{ name, kind: 'file'|'directory' }], readText(path) → string|null, writeText(path, text) }.
import { COMMANDS } from './commands.js';
import { SKILLS } from './skills.js';
import { EFFECT_TYPES } from './taxonomy.js';

const domainOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return u || '?';
  }
};

async function readJson(fsa, p) {
  const t = await fsa.readText(p).catch(() => null);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}

export async function summarizePack(fsa, dir) {
  const m = await readJson(fsa, dir + '/manifest.json');
  if (!m) return null;
  const [tokens, dna, scroll, sections, files] = await Promise.all([
    readJson(fsa, dir + '/design/tokens.json'),
    readJson(fsa, dir + '/dna.json'),
    readJson(fsa, dir + '/motion/scroll-system.json'),
    readJson(fsa, dir + '/structure/sections.json'),
    fsa.list(dir).catch(() => []),
  ]);
  const t = tokens || {};
  const palette = Object.values(t.color || {})
    .filter((c) => c && c.$extensions && c.$extensions.dip && c.$extensions.dip.share != null)
    .map((c) => ({ hex: c.$value, share: c.$extensions.dip.share, role: c.$extensions.dip.role || null }))
    .slice(0, 8);
  const fonts = [...new Set(Object.values(t.typography || {}).map((x) => x && x.$value && x.$value.fontFamily && String(x.$value.fontFamily).split(',')[0].replace(/["']/g, '').trim()).filter(Boolean))];
  const effects = [];
  const fxFiles = (await fsa.list(dir + '/motion/effects').catch(() => [])).filter((f) => f.kind === 'file' && f.name.endsWith('.json')).map((f) => f.name).sort();
  const cards = await Promise.all(fxFiles.map((f) => readJson(fsa, dir + '/motion/effects/' + f)));
  for (const e of cards) {
    if (!e) continue;
    const an = e.animation || {};
    effects.push({ id: e.id, type: e.effect_type, trigger: e.trigger, technique: e.technique, source: e.source, section: e.section, duration: an.duration ?? null, ease: an.ease || null, stagger: typeof an.stagger === 'number' ? an.stagger : null, confidence: e.confidence, preview: e.preview || ((e.reference && e.reference.frames) || [])[0] || null, curve: !!(e.reference && e.reference.curve) });
  }
  const names = new Set(files.map((f) => f.name));
  const name = dir.split('/').pop();
  return {
    name,
    path: dir,
    url: m.url,
    domain: domainOf(m.url),
    title: m.title,
    date: m.date,
    mode: m.mode,
    tier: m.tier,
    complexity: m.complexity,
    analyzerVersion: m.analyzerVersion || '0.0.0',
    stack: (m.detectedStack || []).filter((s) => s.confidence >= 0.6).map((s) => s.name),
    threeD: (m.webgl || []).length > 0 || (m.detectedStack || []).some((s) => s.name === 'three' && s.confidence >= 0.6),
    scroll: { type: (scroll && scroll.type) || null, lerp: (scroll && scroll.measuredLerp) || null },
    palette,
    fonts,
    sections: (sections || []).map((s) => ({ id: s.id, heading: s.heading || null, height: s.height || null })),
    effects,
    hasDna: names.has('DESIGN_DNA.md') || !!dna,
    dna: dna ? { keywords: dna.keywords || [], register: dna.register || null, sectors: dna.sectors || [], signatureEffects: dna.signatureEffects || [], tempo: dna.tempo || null } : null,
    verified: names.has('verify-report.md'),
  };
}

export async function listPacks(fsa) {
  const dirs = (await fsa.list('packs').catch(() => [])).filter((d) => d.kind === 'directory');
  const packs = (await Promise.all(dirs.map((d) => summarizePack(fsa, 'packs/' + d.name).catch(() => null)))).filter(Boolean);
  return packs.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function libraryMd(packs) {
  const o = ['# DIP library', '', `${packs.length} site(s). Open Claude Code in this folder and use \`/dip-create <brief>\`, \`/dip-transform <client pack> <reference packs>\`, \`/dip-clone <url>\` or \`/dip-dna <pack folders>\`.`, ''];
  const noDna = packs.filter((p) => !p.hasDna);
  if (noDna.length) o.push(`⚠ ${noDna.length} pack(s) without DESIGN_DNA yet: run \`/dip-dna ${noDna.map((p) => p.path).join(' ')}\` (no API key needed).`, '');
  o.push('| Site | Date | Tier | 3D | Scroll | Palette | Fonts | Effects | DNA keywords |');
  o.push('|---|---|---|---|---|---|---|---|---|');
  for (const p of packs)
    o.push(`| [${p.domain}](${p.path}/SPEC.md) | ${String(p.date || '').slice(0, 10)} | ${p.tier} | ${p.threeD ? '✓' : ''} | ${p.scroll.type || ''}${p.scroll.lerp ? ' ' + p.scroll.lerp : ''} | ${p.palette.slice(0, 5).map((c) => c.hex).join(' ')} | ${p.fonts.slice(0, 3).join(', ')} | ${p.effects.length} | ${p.dna ? p.dna.keywords.slice(0, 6).join(', ') : p.hasDna ? '✓' : '—'} |`);
  o.push('');
  return o.join('\n');
}

export function effectsByType(packs) {
  const byType = new Map();
  for (const p of packs) for (const e of p.effects) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push({ ...e, pack: p });
  }
  return [...byType.entries()].sort((a, b) => b[1].length - a[1].length);
}

export function effectsMd(packs) {
  const g = ['# Effects index — measured animations by need', '', 'Each line links to a measured effect card. Reuse the measured values (duration, easing, stagger, lerp); never the original code or assets.', ''];
  for (const [type, list] of effectsByType(packs)) {
    g.push(`## ${type} (${list.length})`, '');
    if (EFFECT_TYPES[type]) g.push(`_${EFFECT_TYPES[type]}_`, '');
    for (const e of list.slice(0, 40))
      g.push(`- [${e.pack.domain} · ${e.id}](${e.pack.path}/motion/effects/${e.id}.md) — ${e.trigger}${e.duration != null ? `, ${e.duration}s` : ''}${e.ease ? `, ${e.ease}` : ''}${e.stagger != null ? `, stagger ${e.stagger}` : ''} (${e.technique || '?'}, conf ${e.confidence})`);
    g.push('');
  }
  return g.join('\n');
}

// Rebuild the indexes and (re)write the Claude Code commands at the library root.
export async function writeIndex(fsa) {
  const packs = await listPacks(fsa);
  const slim = packs.map(({ effects, ...p }) => ({ ...p, effects: effects.map(({ preview, curve, ...e }) => e) }));
  await fsa.writeText('index.json', JSON.stringify({ generator: 'DIP library', updated: new Date().toISOString(), packs: slim }, null, 2));
  await fsa.writeText('LIBRARY.md', libraryMd(packs));
  await fsa.writeText('EFFECTS.md', effectsMd(packs));
  for (const [name, body] of Object.entries(COMMANDS)) await fsa.writeText('.claude/commands/' + name, body);
  for (const [name, body] of Object.entries(SKILLS)) await fsa.writeText('.claude/skills/' + name, body);
  return packs;
}

// ------------------------------------------------------------------ suggestions
const STOP = new Set('the and for with from that this une des les pour avec dans sur est qui que par aux son ses leur plus site web page nous vous'.split(' '));
export const words = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));

// Rank reference packs for a brief: DNA keywords / sectors / register overlap, 3D wish, richness of measured motion.
export function rankReferences(packs, brief) {
  const bw = new Set(words(brief));
  const wants3D = [...bw].some((w) => /^(3d|immersi|webgl|three|spatial|volum)/.test(w));
  return packs
    .map((p) => {
      const why = [];
      let score = 0;
      const dnaWords = new Set(words([...(p.dna ? [...p.dna.keywords, ...p.dna.sectors, p.dna.register] : []), p.title, p.domain].join(' ')));
      const hits = [...bw].filter((w) => [...dnaWords].some((d) => d.startsWith(w.slice(0, 5)) || w.startsWith(d.slice(0, 5))));
      if (hits.length) {
        score += hits.length * 3;
        why.push('mots communs : ' + hits.slice(0, 5).join(', '));
      }
      if (wants3D && p.threeD) {
        score += 4;
        why.push('3D');
      }
      const types = new Set(p.effects.map((e) => e.type));
      score += Math.min(4, types.size / 3);
      if (types.size) why.push(`${types.size} types d'animations`);
      if (p.tier === 'A' || p.tier === 'B') score += 1;
      if (!p.hasDna) {
        score -= 1;
        why.push('ADN à écrire');
      }
      return { pack: p, score: Math.round(score * 10) / 10, why };
    })
    .sort((a, b) => b.score - a.score);
}

// Library-level suggestions: what to do next to be able to create.
export const versionLess = (a, b) => {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};
export function librarySuggestions(packs, currentVersion) {
  const out = [];
  const old = currentVersion ? packs.filter((p) => versionLess(p.analyzerVersion, currentVersion)) : [];
  if (old.length) out.push({ kind: 'scan', action: 'redissect', text: `${old.length} site(s) analysé(s) avec une ancienne version de DIP : redissèque-les pour obtenir les nouvelles mesures (survols CSS, clics, glisser, décors, compositions d’images…). L’ADN déjà écrit est conservé.` });
  if (packs.length < 3) out.push({ kind: 'scan', text: `Scanne au moins ${3 - packs.length} site(s) premium de plus : il faut 3 références pour mélanger sans copier.` });
  const noDna = packs.filter((p) => !p.hasDna);
  if (noDna.length) out.push({ kind: 'dna', text: `${noDna.length} pack(s) sans ADN : écris-les avant de créer.`, command: '/dip-dna ' + noDna.map((p) => p.path).join(' ') });
  const types = new Set(packs.flatMap((p) => p.effects.map((e) => e.type)));
  const wanted = [
    ['text-reveal-lines', 'révélations de titres ligne par ligne'],
    ['image-parallax', 'parallaxe d’images au scroll'],
    ['pinned-sequence', 'section épinglée animée au scroll'],
    ['horizontal-scroll-section', 'défilement horizontal'],
    ['menu-overlay', 'menu plein écran animé'],
    ['3d-scene', 'scène 3D'],
    ['custom-cursor', 'curseur personnalisé'],
    ['page-transition', 'transitions de page'],
  ].filter(([t]) => !types.has(t) && !(t === '3d-scene' && packs.some((p) => p.threeD)));
  if (packs.length && wanted.length) out.push({ kind: 'coverage', text: 'Ta bibliothèque n’a encore aucun exemple de : ' + wanted.map((w) => w[1]).join(', ') + '. Scanne des sites qui en ont (Awwwards, FWA, Godly).' });
  const unverified = packs.filter((p) => !p.verified).length;
  if (packs.length >= 3 && !noDna.length) out.push({ kind: 'create', text: 'Ta bibliothèque est prête : lance une création dans l’onglet « Créer ».' });
  if (unverified && packs.length) out.push({ kind: 'clone', text: 'Astuce : cloner un site de référence (/dip-clone) est le meilleur moyen de valider qu’une animation est bien comprise avant de la réutiliser.' });
  return out;
}

// Tempo / easing habits across the library (what "premium" feels like in numbers)
export function libraryStats(packs) {
  const fx = packs.flatMap((p) => p.effects);
  const durs = fx.map((e) => e.duration).filter((d) => typeof d === 'number' && d > 0.05 && d < 5).sort((a, b) => a - b);
  const eases = new Map();
  for (const e of fx) if (e.ease && typeof e.ease === 'string') eases.set(e.ease, (eases.get(e.ease) || 0) + 1);
  const lerps = packs.map((p) => p.scroll.lerp).filter(Boolean);
  return {
    sites: packs.length,
    effects: fx.length,
    threeD: packs.filter((p) => p.threeD).length,
    withDna: packs.filter((p) => p.hasDna).length,
    medianDuration: durs.length ? durs[Math.floor(durs.length / 2)] : null,
    topEases: [...eases.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
    lerp: lerps.length ? Math.round((lerps.reduce((a, b) => a + b, 0) / lerps.length) * 1000) / 1000 : null,
  };
}
