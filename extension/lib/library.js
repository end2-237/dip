// DIP library: the studio's cumulative memory. A library folder holds packs/<name>/ (one DIP pack per scan)
// plus index.json, LIBRARY.md (all sites), EFFECTS.md (measured animations by need) and the Claude Code
// commands, so Claude Code opened in the folder gets /dip-create, /dip-transform, /dip-clone, /dip-dna.
// Shared by the extension dashboard (File System Access) and cli/dip-library.js (node:fs) through a small
// async adapter: { list(dir) → [{ name, kind: 'file'|'directory' }], readText(path) → string|null, writeText(path, text) }.
import { COMMANDS, QUALITY_RULES } from './commands.js';
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
  const [tokens, dna, scroll, sections, files, assets, comps, scene] = await Promise.all([
    readJson(fsa, dir + '/design/tokens.json'),
    readJson(fsa, dir + '/dna.json'),
    readJson(fsa, dir + '/motion/scroll-system.json'),
    readJson(fsa, dir + '/structure/sections.json'),
    fsa.list(dir).catch(() => []),
    readJson(fsa, dir + '/assets/manifest.json'),
    readJson(fsa, dir + '/structure/compositions.json'),
    readJson(fsa, dir + '/motion/scene.json'),
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
    sections: sectionProfiles(sections || [], (assets && assets.images) || [], ((comps && comps.compositions) || []), effects, (scene && scene.rhythm) || []),
    scene: scene ? { shifts: (scene.shifts || []).length, rhythm: (scene.rhythm || []).map((r) => (r.lum != null ? (r.lum < 0.35 ? 'dark' : 'light') : null)).filter(Boolean) } : null,
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
  const pt = libraryPatterns(packs);
  await fsa.writeText('patterns.json', JSON.stringify(pt, null, 2));
  await fsa.writeText('PATTERNS.md', patternsMd(pt));
  for (const [name, body] of Object.entries(COMMANDS)) await fsa.writeText('.claude/commands/' + name, body);
  await fsa.writeText('QUALITY_RULES.md', QUALITY_RULES);
  // lessons grow with every /dip-review: create once, never overwrite
  if ((await fsa.readText('LESSONS.md').catch(() => null)) == null) await fsa.writeText('LESSONS.md', LESSONS_SEED);
  for (const [name, body] of Object.entries(SKILLS)) await fsa.writeText('.claude/skills/' + name, body);
  return packs;
}

const LESSONS_SEED = `# LESSONS — mistakes already made, never again

Written by /dip-review after each build (one rule per line). Read by /dip-create and /dip-transform.

- kalibre (2026-09): the hero lost its 3D after the intro → the scene must stay alive behind the wordmark and react to pointer + scroll.
- kalibre: a transparent fixed header ran over big titles on light sections → header background/blur on scroll or hide-on-scroll-down.
- kalibre: the scripting demo box was 60 % empty → boxes size to their content; long demos build up with the scroll.
- kalibre: the studio section had a facts row floating in a half-empty screen → merge small facts into a denser block.
- kalibre: signature moments were all in the intro and footer → place 2–4 in the middle sections (pinned, zoom, expand, décor change).
- kalibre: many mobile links under 32 px high → touch targets ≥ 44 px.
`;

// ------------------------------------------------------------------ section roles (for patterns)
const ROLE_RULES = [
  ['footer', /footer|colophon/],
  ['contact', /contact|emettre|reach|get-in-touch|write/],
  ['offers', /offer|pricing|price|plan|formule|seance|package|tarif|service/],
  ['process', /process|method|how|step|approach|scripting|workflow|methode/],
  ['work', /work|project|case|portfolio|realisation|showcase|selected/],
  ['gallery', /gallery|galerie|photos|images|visual|lookbook/],
  ['testimonials', /testimonial|review|avis|quote|signaux|temoign/],
  ['logos', /logo|client|partner|trusted|brands/],
  ['stats', /stat|number|figure|chiffre|result|impact/],
  ['team', /team|equipe|people|founder/],
  ['faq', /faq|question/],
  ['features', /feature|benefit|why|capabilit|product/],
  ['manifesto', /manifest|about|mission|statement|philosoph|vision|intro|story/],
  ['cta', /cta|book|reserv|start|join|signup/],
];
export function sectionRole(sec, i, n, imgs, fx) {
  const name = ((sec.id || '').replace(/^s\d+-/, '') + ' ' + (sec.selector || '')).toLowerCase();
  if (i === 0) return 'hero';
  for (const [role, re] of ROLE_RULES) if (re.test(name)) return role;
  if (i === n - 1) return 'footer';
  if (imgs >= 5) return 'gallery';
  if (fx.some((e) => /pinned|horizontal|zoom-through|media-expand|camera-scroll/.test(e.type))) return 'story';
  if (imgs >= 2) return 'media';
  return 'content';
}
function sectionProfiles(sections, images, comps, effects, rhythm) {
  const n = sections.length;
  return sections.map((sec, i) => {
    const top = sec.top || 0, bottom = top + (sec.height || 0);
    const imgs = images.filter((im) => im.y >= top && im.y < bottom);
    const fx = effects.filter((e) => e.section === sec.id);
    const comp = comps.filter((c) => c.section === sec.id && c.layout !== 'grid').map((c) => c.layout);
    const r = rhythm.find((x) => x.section === sec.id);
    const sizes = imgs.map((im) => Math.max((im.displayed || [])[0] || 0, 0)).filter((w) => w > 0);
    return {
      id: sec.id,
      heading: sec.heading || null,
      height: sec.height || null,
      role: sectionRole(sec, i, n, imgs.length, fx),
      images: imgs.length,
      imageWidth: sizes.length ? sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] : null,
      compositions: comp,
      tone: r && r.lum != null ? (r.lum < 0.35 ? 'dark' : 'light') : null,
    };
  });
}

// ------------------------------------------------------------------ patterns across the library
const med = (a) => {
  const s = a.filter((x) => typeof x === 'number' && isFinite(x)).sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
export function libraryPatterns(packs) {
  const P = packs.filter((p) => p.sections && p.sections.length);
  const out = { sites: P.length, sections: null, roles: [], sequences: [], transitions: [], decor: null, density: null };
  if (!P.length) return out;
  const counts = P.map((p) => p.sections.length);
  out.sections = { median: med(counts), min: Math.min(...counts), max: Math.max(...counts) };
  // roles: presence, position, images, compositions, effects
  const roles = new Map();
  for (const p of P) {
    const seen = new Set();
    p.sections.forEach((s, i) => {
      const r = roles.get(s.role) || { role: s.role, sites: new Set(), pos: [], images: [], widths: [], comps: {}, heights: [], fx: new Map(), tones: {} };
      roles.set(s.role, r);
      if (!seen.has(s.role)) r.sites.add(p.name);
      seen.add(s.role);
      r.pos.push(p.sections.length > 1 ? i / (p.sections.length - 1) : 0);
      r.images.push(s.images);
      if (s.imageWidth) r.widths.push(s.imageWidth);
      if (s.height) r.heights.push(s.height);
      for (const c of s.compositions || []) r.comps[c] = (r.comps[c] || 0) + 1;
      if (s.tone) r.tones[s.tone] = (r.tones[s.tone] || 0) + 1;
      for (const e of p.effects.filter((e) => e.section === s.id && e.type !== 'other')) {
        const k = e.type + '|' + e.trigger;
        const f = r.fx.get(k) || { type: e.type, trigger: e.trigger, sites: new Set(), durations: [], eases: {} };
        r.fx.set(k, f);
        f.sites.add(p.name);
        if (typeof e.duration === 'number') f.durations.push(e.duration);
        if (e.ease) f.eases[e.ease] = (f.eases[e.ease] || 0) + 1;
      }
    });
  }
  const top = (o, k) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, k).map(([x]) => x);
  out.roles = [...roles.values()]
    .map((r) => ({
      role: r.role,
      share: Math.round((r.sites.size / P.length) * 100) / 100,
      position: Math.round(med(r.pos) * 100) / 100,
      images: med(r.images),
      imageWidth: med(r.widths),
      heightVh: r.heights.length ? Math.round((med(r.heights) / 900) * 10) / 10 : null,
      compositions: top(r.comps, 3),
      tone: top(r.tones, 1)[0] || null,
      effects: [...r.fx.values()]
        .map((f) => ({ type: f.type, trigger: f.trigger, share: Math.round((f.sites.size / r.sites.size) * 100) / 100, duration: med(f.durations), ease: top(f.eases, 1)[0] || null }))
        .sort((a, b) => b.share - a.share)
        .slice(0, 6),
    }))
    .sort((a, b) => a.position - b.position);
  // sequences of roles (consecutive pairs and whole pages)
  const pairs = {}, seqs = {};
  for (const p of P) {
    const rs = p.sections.map((s) => s.role).filter((r, i, a) => r !== a[i - 1]);
    for (let i = 1; i < rs.length; i++) pairs[rs[i - 1] + ' → ' + rs[i]] = (pairs[rs[i - 1] + ' → ' + rs[i]] || 0) + 1;
    const key = rs.join(' → ');
    seqs[key] = (seqs[key] || 0) + 1;
  }
  out.transitions = Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => ({ pair: k, sites: n }));
  out.sequences = Object.entries(seqs).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ sequence: k, sites: n }));
  // décor rhythm and motion density
  const withScene = P.filter((p) => p.scene);
  if (withScene.length) {
    const rh = {};
    for (const p of withScene) {
      const r = (p.scene.rhythm || []).filter((x, i, a) => x !== a[i - 1]).join(' → ');
      if (r) rh[r] = (rh[r] || 0) + 1;
    }
    out.decor = { shiftsPerSite: med(withScene.map((p) => p.scene.shifts)), sitesWithShift: Math.round((withScene.filter((p) => p.scene.shifts > 0).length / withScene.length) * 100) / 100, rhythms: Object.entries(rh).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ rhythm: k, sites: n })) };
  }
  out.density = {
    effectsPerSection: med(P.map((p) => p.effects.filter((e) => e.type !== 'other').length / p.sections.length).map((x) => Math.round(x * 10) / 10)),
    sectionsWithScrollMotion: med(P.map((p) => Math.round((p.sections.filter((s) => p.effects.some((e) => e.section === s.id && /scroll/.test(e.trigger))).length / p.sections.length) * 100) / 100)),
    signatureMoments: med(P.map((p) => p.effects.filter((e) => /pinned|horizontal|zoom-through|media-expand|camera-scroll|scene-color|media-choreography|3d-|press-hold|gallery-drag/.test(e.type)).length)),
  };
  return out;
}

export function patternsMd(pt) {
  const o = ['# Library patterns — what the premium sites of this library do', ''];
  if (!pt.sites) return o.concat(['No site with a section structure yet.']).join('\n');
  const pct = (x) => Math.round(x * 100) + ' %';
  o.push(`Computed on **${pt.sites} site(s)**. Use these numbers as defaults when planning a page (/dip-create), then deviate on purpose.`, '');
  o.push('## Page', '');
  o.push(`- Sections per page: median **${pt.sections.median}** (min ${pt.sections.min}, max ${pt.sections.max}).`);
  if (pt.density) o.push(`- Motion density: median **${pt.density.effectsPerSection}** measured effects per section; **${pct(pt.density.sectionsWithScrollMotion)}** of sections move with the scroll; **${pt.density.signatureMoments}** signature moments per site (pinned / zoom / décor change / 3D / press / drag…).`);
  if (pt.decor) o.push(`- Décor: ${pct(pt.decor.sitesWithShift)} of sites change their background along the page (median ${pt.decor.shiftsPerSite} change(s)). Common rhythms: ${pt.decor.rhythms.map((r) => '`' + r.rhythm + '` (' + r.sites + ')').join(', ') || '—'}.`);
  o.push('', '## Section sequences', '');
  for (const s of pt.sequences) o.push(`- ${s.sequence} — ${s.sites} site(s)`);
  if (pt.transitions.length) o.push('', 'Most frequent transitions: ' + pt.transitions.map((t) => `${t.pair} (${t.sites})`).join(' · '));
  o.push('', '## Section roles', '', '| Role | Sites | Position | Height | Images | Image width | Compositions | Tone | Effects (share of sites · duration · ease) |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of pt.roles)
    o.push(`| ${r.role} | ${pct(r.share)} | ${r.position} | ${r.heightVh != null ? r.heightVh + ' vh' : '—'} | ${r.images ?? '—'} | ${r.imageWidth ? r.imageWidth + ' px' : '—'} | ${r.compositions.join(', ') || '—'} | ${r.tone || '—'} | ${r.effects.map((e) => `${e.type}/${e.trigger} ${pct(e.share)}${e.duration != null ? ' · ' + e.duration + 's' : ''}${e.ease ? ' · ' + e.ease : ''}`).join('<br>') || '—'} |`);
  o.push('', 'Position: 0 = top of the page, 1 = bottom. Height in viewport heights at 1440×900.');
  return o.join('\n');
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
