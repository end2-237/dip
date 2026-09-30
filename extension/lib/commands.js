// Claude Code commands shipped with every pack (and in /claude-commands of the repo).
// They run inside Claude Code, i.e. on the user's Claude subscription — no API key needed.

// Quality rules learned from reviewing real builds (kalibre, first DIP creation). Every creation command
// copies them into the production pack; /dip-review appends new lessons to LESSONS.md in the library.
export const QUALITY_RULES = `# QUALITY RULES — non-negotiable for every page built with DIP

1. The hero stays alive after its intro: the scene / visual keeps a slow motion and reacts to the pointer
   and to the scroll. A title alone on a still background is not a hero.
2. No dead zones: no area larger than 30 % of the viewport stays empty for more than half a screen of
   scroll. Section heights follow their content; sticky / pinned scenes are filled at every step.
3. No half-empty panels: a card or box is never taller than what it shows (demo boxes, script boxes…).
4. The fixed header never sits on top of text: background or blur as soon as the page scrolls, or hide on
   scroll down / show on scroll up. mix-blend-mode alone is not enough. Add scroll-margin-top to anchors.
5. Motion is spread along the page: every section has at least one motion moment, and 2–4 signature
   moments live in the middle of the page (pinned sequence, zoom-through, media expand, décor change,
   moving image composition, 3D following the scroll) — not only in the intro and the footer.
6. Numbers first: sections count, section order, images per section and effects per section start from
   PATTERNS.md (library) and the measured values of EFFECTS.md; deviations are deliberate and explained.
7. Mobile: no horizontal overflow, text ≥ 16 px (labels ≥ 11 px), touch targets ≥ 44 px, 3D degraded
   gracefully.
8. Content honesty: missing client facts stay visible as [à confirmer]; never invent testimonials,
   clients, figures or awards.
9. Minimum richness — every site built with DIP, whatever the brief:
   - at least 10 real sections (or the library median if higher) and 10+ screens of scroll at 1440;
   - the whole story: hook → tension / need → showcase (projects, cases, gallery, the place) → proof (figures,
     testimonials, logos, press — shown as [à confirmer] until the client provides them) → method / how it
     works → offer (services, packages, prices) → FAQ → final call to action;
   - visuals everywhere: at least 1.5 strong visuals per section on average and 12+ in total (photo, video,
     illustration, 3D, animated composition); the showcase has 3+; never two text-only sections in a row;
   - calls to action: the main one 3+ times in the page (after the hero, mid-page, at the end) with varied
     wording, never more than 3–4 screens without one, plus a lighter secondary action;
   - a reason to come back: newsletter with a clear promise, journal / recent cases, free resources or
     social content put on stage;
   - 3+ signature moments spread over the page so the visitor stays dazzled until the end.
10. Done means verified: \`node <DIP>/cli/dip-review.js --url <local url> --out sites/<slug>/review --library <library>\`
   scores ≥ 85, and every 🔴 item of REVIEW.md is fixed.
`;

export const DIP_DNA = `---
description: Write the design DNA (art direction + production rules) of one or more DIP packs
argument-hint: [pack folder ...]
---
You are an art director and senior creative developer. A DIP Reproduction Pack holds MEASUREMENTS of a
premium website captured in a real browser (a folder with SPEC.md and manifest.json).
Packs to process: $ARGUMENTS
If no folder is given, use the pack that contains this command (or the current folder). When several
folders are given, process them one after the other, each with its own DESIGN_DNA.md and dna.json.

Goal: write DESIGN_DNA.md and dna.json at each pack root. They capture the essence of the site so a
studio can produce NEW, ORIGINAL sites of the same standard — not copy this one.

Read, in this order: SPEC.md, design/tokens.json, design/typography.md, design/grid.md,
structure/sections.json, structure/content.md, structure/compositions.json (if present), motion/scroll-system.json,
motion/scene.json (décor rhythm and colour changes), motion/timeline-intro.json,
every motion/effects/*.json, webgl/three-scene.md and webgl/*.md if present, perf.json.
LOOK at the reference images (reference/1440/*.png, reference/390/*.png, press/, toggle/, hover/):
describe what you see — composition, imagery, light, texture.

DESIGN_DNA.md sections:
1. Positioning — sector, audience, promise, emotional register (3 lines).
2. Visual language — 5–8 keywords, and what makes it feel premium.
3. Composition — grid (columns, margins, gutters by breakpoint), whitespace ratio, density, vertical rhythm,
   section archetypes in order (e.g. "full-bleed 3D hero → manifesto → logo rail → feature grid").
4. Typography — families and roles, fluid scale (clamp formulas), weights, tracking, case, mono/label usage.
5. Colour — roles (background, text, accent, surfaces), share of surface, contrast, light/dark rhythm across
   sections and the décor changes along the scroll (motion/scene.json: what changes, where, scrubbed or timed).
6. Imagery, 3D and light — art style, materials, lighting, camera language, fog, post-processing, textures.
7. Motion personality — tempo (typical durations), easing families (exact names/curves), stagger habits,
   scroll feel (smooth-scroll lerp / duration), intro sequence, hover / press / menu behaviours, 3D motion.
8. Interaction patterns — cursor, magnetic elements, menus, tabs, drag, transitions, what reacts to what.
9. Copywriting — tone, sentence length, headline formula, CTA verbs, how each section argues
   (derive from content.md; count words; quote at most a few words).
10. Signature moments — the 3–5 things people remember, with the effect ids that implement them.
11. Do / Don't — rules to stay on-brand.
12. Transposition guide — what is structural (reusable for any brand) vs brand-specific (must change),
    and which sectors this DNA fits.

dna.json: { "keywords": [], "register": "", "sectors": [], "tempo": { "typicalDuration": s, "easings": [] },
"scroll": {}, "palette": [{ "role", "hex", "share" }], "type": [{ "role", "family", "size" }],
"sectionArchetypes": [], "signatureEffects": [{ "id", "type", "why" }], "threeD": { "used": bool, "style": "" },
"copy": { "tone": "", "avgHeadlineWords": n },
"category": { "sector": one of luxe-mode | hotellerie-restauration | tech-saas-ia | studio-agence | portfolio |
architecture-immobilier | ecommerce-produit | culture-evenement | auto-mobilite | sante-bienetre | finance-conseil |
food-boisson | education-ong | media-contenu | autre, "styles": 1–3 of minimal-editorial | luxe-epure | immersif-3d |
experimental | brutaliste | ludique-colore | tech-futuriste | organique-nature | retro-vintage | sombre-cinema } }.

Rules: every number must come from the pack (write [estimated] otherwise). Do not reproduce the site's
texts, images, fonts or shader code: describe them. Write in the language the user writes to you in
(default: French), keep dna.json keys in English.
`;

export const DIP_TRANSFORM = `---
description: Turn an ordinary client site into a premium production brief using DIP reference packs
argument-hint: <client pack folder> <reference pack folder(s)> [brief]
---
You are a creative director running a studio. Arguments: $ARGUMENTS
Inputs (read the brief file when one is given; ask for anything missing):
- the DIP pack of the CLIENT's current site (its content, structure, brand assets, facts);
- 1–3 DIP REFERENCE packs of premium sites (with DESIGN_DNA.md / dna.json — if missing, run the
  instructions of .claude/commands/dip-dna.md on them first);
- optional brief: goals, audience, constraints, budget, deadline.

Produce a folder production/<client-slug>/ containing:
1. BRIEF.md — client, audience, objective, key messages (from the client pack), success criteria.
2. CONCEPT.md — one big idea, the narrative of the page, and why it suits the client; which reference
   DNA traits are borrowed and how they are TRANSFORMED (never copied).
3. design/tokens.json + tokens.css — an ORIGINAL design system: palette derived from the client's brand,
   typography pairing (free fonts: Google Fonts / Fontshare), fluid scale, spacing, radii, shadows.
4. structure/sitemap.md — sections in order using reference section archetypes, mapped to the client's
   real content (keep facts; rewrite copy in the reference tone; mark placeholders).
5. motion/MOTION_SYSTEM.md — scroll system, intro, reveals, hovers, presses, menus, 3D: pick effects from the
   reference packs' motion/effects/*.json, keep their MEASURED values (durations, easings, lerp), and
   adapt targets to the new layout. Explain the choice of each effect for the client's goal.
6. 3D.md when relevant — scene concept, camera path, materials, light, post-processing, perf budget.
7. BUILD_PLAN.md + AGENT_RULES.md — same format as a DIP pack, so Claude Code can build it section by section.
8. verify/targets.json — tokens and motion curves the build must match (for review / dip-verify-style checks).
9. ASSETS.md — every image / video / 3D object with role, size and a generation prompt in the new art
   direction; reuse the client's own photos and logo when they are good enough. Production tools:
   \`node <DIP>/cli/dip-assets.js image|model|optimize\` (fal.ai, pay per use) or 3D rebuilt in code.

Also read PATTERNS.md and LESSONS.md at the library root, copy QUALITY_RULES.md (below) into the production
folder and end BUILD_PLAN.md with the dip-review step. Build the site in sites/<client-slug>/.

${QUALITY_RULES}

Originality rules: mix at least two references; never reuse their copy, images, fonts, 3D models or
shader code; change palette and typography; keep only principles, rhythms and measured motion values.
Accessibility: contrast ≥ 4.5:1 for body text, prefers-reduced-motion fallbacks, keyboard menus.
`;

export const DIP_CREATE = `---
description: Create an original award-level website concept and production pack from a brief, using the DIP library
argument-hint: <brief> [library folder]
---
You are a creative director. Arguments: $ARGUMENTS
(usually a brief file in briefs/ written by the DIP dashboard, plus the chosen reference packs — start with those).
Input: a brief (company, sector, audience, goals, tone, available assets)
and a LIBRARY folder containing DIP packs (each with manifest.json, DESIGN_DNA.md / dna.json and
motion/effects/). If a pack has no DNA yet, apply .claude/commands/dip-dna.md to it first.

Steps:
0. Read PATTERNS.md (numbers: sections, order, images and effects per section role, décor rhythm, motion
   density) and LESSONS.md (mistakes of previous builds that must not come back) at the library root.
1. Search the library: start with LIBRARY.md, EFFECTS.md and index.json at the library root (built by
   \`node <DIP>/cli/dip-library.js index\`), then read the dna.json of candidates; shortlist 3–5 packs whose
   register, sectors and signature effects fit the brief. Explain the shortlist in a table (why each fits,
   what to borrow). If some packs have no DNA yet, run the instructions of .claude/commands/dip-dna.md on them.
2. Write CONCEPT.md: 2–3 alternative big ideas, pick one, justify it. Describe the experience minute by minute
   (intro, scroll narrative, interactions, 3D moments).
3. Design an ORIGINAL design system (tokens.json + tokens.css): palette, type pairing (free fonts), fluid
   scale, grid, spacing — coherent with the concept, different from every reference.
4. Write the section plan with drafted copy (headlines, body, CTAs) in the brief's language and tone.
5. MOTION_SYSTEM.md: choose effects from the library packs' motion/effects/*.json by need
   (e.g. "reveal a manifesto" → text-reveal-lines with measured expo.out 1.2s stagger 0.08); reuse measured
   values; define scroll feel, intro, hovers, presses, menu, and 3D (camera path / objects / post-processing)
   when it serves the idea. Keep a perf budget (LCP, frame time) and reduced-motion fallbacks.
6. ASSETS.md: every image, video and 3D object the concept needs, each with its role, size, framing and a
   generation prompt that follows the design system (light, palette, materials, mood). Say how each is
   produced: 3D rebuilt in code (Three.js primitives + shaders) whenever possible; otherwise
   \`node <DIP>/cli/dip-assets.js model --prompt "…" --out public/models/<name>.glb\`; images with
   \`node <DIP>/cli/dip-assets.js image --prompt "…" --size WxH --out public/img/<name>.webp\` or free stock;
   then \`dip-assets optimize\`. Estimate the cost (≈ $0.03 per image, ≈ $0.05–1.50 per 3D model).
7. Output a production pack in production/<project-slug>/ with BRIEF.md, CONCEPT.md, design/, structure/,
   motion/, 3D.md (if any), ASSETS.md, BUILD_PLAN.md, AGENT_RULES.md and QUALITY_RULES.md (copy the block
   below) in the DIP format, ready for Claude Code. The section plan states, per section, its role, height
   (vh), number and placement of images and its motion moments, citing the PATTERNS.md line it follows.
   BUILD_PLAN.md builds the site in sites/<project-slug>/ and ends with the dip-review step.

${QUALITY_RULES}
Never copy texts, images, fonts, models or shader code from the library: borrow principles and measured
motion values only. Ask the user to confirm the concept before writing the full production pack.
`;

export const DIP_CLONE = `---
description: Full clone loop from a URL — capture with DIP, write the DNA, build section by section, verify
argument-hint: <url> [work folder]
---
You are a senior creative developer. URL and options: $ARGUMENTS
Goal: a private study clone of that URL that reaches the fidelity
thresholds measured by DIP, built section by section. Work in the given folder (default: the current one).

0. Locate DIP: the folder that contains cli/dip-capture.js (env DIP_HOME, or ask the user once).
   Check node --version ≥ 20 and that \`npm install\` was run in the DIP folder.
1. Capture: \`node <DIP>/cli/dip-capture.js <url> --out packs --breakpoints 1440,390\`
   (headed Chromium; ~2–4 min). If the site blocks automated browsers (captcha, empty page, 403), stop and
   ask the user to scan it with the DIP extension instead and give you the pack folder.
   If a library exists (env DIP_LIBRARY), also run \`node <DIP>/cli/dip-library.js add <pack>\`.
2. DNA: follow <pack>/.claude/commands/dip-dna.md (DESIGN_DNA.md + dna.json). Keep it short: 1–2 pages.
3. Build: create site/ with the stack of manifest.json, then follow BUILD_PLAN.md step by step.
   Assets: follow ASSETS.md (study clone: the files of assets/files and webgl/geometry may be used locally,
   never published).
4. Verify each section right after building it:
   \`node <DIP>/cli/dip-verify.js --pack <pack> --url http://localhost:5173 --section <id> --breakpoints 1440 --headless\`
   Fix the notes of the report, at most 3 verify runs per section, then move on (write what is left in
   NOTES.md). 3D: approximate first, refine only if the score is below 0.6.
5. End: \`node <DIP>/cli/dip-verify.js --pack <pack> --url http://localhost:5173 --all --headless\` and write
   CLONE_REPORT.md: scores per section and metric, what is missing, what DIP did not capture (so DIP can be
   improved), time spent.

Rules: the clone stays private (study). Every value comes from the pack; mark guesses [estimated].
Report progress in one short line per step.
`;

export const DIP_REVIEW = `---
description: Review a site built with DIP (dead zones, header over text, static hero, sections without motion, mobile) and fix it until the score is ≥ 85
argument-hint: <site folder in sites/> [local url]
---
Site to review: $ARGUMENTS (default: the only folder in sites/). Work from the library root.

1. Start the site (npm install once, then npm run dev) and note its local URL.
2. Run \`node <DIP>/cli/dip-review.js --url <url> --out sites/<slug>/review --library .\` (DIP folder: env DIP_HOME,
   or ask once). Read sites/<slug>/review/REVIEW.md and LOOK at every screenshot it lists.
3. Fix the items in order (🔴 first), following QUALITY_RULES.md of the production pack and the measured values
   of PATTERNS.md / EFFECTS.md. Keep the concept and the art direction; do not rewrite what works.
4. Re-run dip-review. At most 3 rounds; stop earlier at ≥ 85 with no 🔴 left.
5. Append to LESSONS.md at the library root one line per NEW kind of mistake you fixed, written as a rule for
   future builds (e.g. "Script/demo boxes: height follows the content, never a fixed 60vh"). Keep the file short:
   merge with existing lines instead of repeating them.
6. Update sites/<slug>/NOTES.md: score before → after, what changed, what is still missing (client content).
`;

export const DIP_EFFECT = `---
description: Complete a focus analysis (effects/<slug>) — identify the animation, research it on the web, write the full reproduction card and a working demo
argument-hint: <effects/slug>
---
Effect folder: $ARGUMENTS (a DIP focus analysis: EFFECT.md, effect.json, frames/, curves/, code/).

1. Read EFFECT.md, effect.json, curves/*.json, code/css.txt, code/gsap.json and code/*.glsl. LOOK at every image
   of frames/ in order (00 selected zone · 10 idle · 20 scroll · 30 hover · 40 pointer · 50 press · 60 click ·
   70 drag): describe what changes between frames.
2. Identify the effect: its usual name(s) among designers and developers, its family, and how it is built
   (DOM + CSS, GSAP / ScrollTrigger, SplitText, canvas 2D, WebGL shader, Three.js, Lottie…). Explain the
   mechanism in plain words.
3. Research it on the web (WebSearch / WebFetch): start with the search query of EFFECT.md, then refine.
   Prefer Codrops, the GSAP docs and forum, CodePen, MDN, three.js examples. Keep 3–6 useful sources with
   links. Tutorials may inspire the method; never copy the analysed site's code or assets.
4. Append to EFFECT.md a section "## Fiche complète (Claude)":
   - Nom usuel et autres noms · Ce que voit le visiteur (timeline seconde par seconde ou % de scroll)
   - Comment ça marche (mécanisme) · Recette pas à pas avec les valeurs MESURÉES (durées, easings, décalages,
     plages de scroll, amplitudes, uniforms) — [estimated] pour tout ce qui n'est pas mesuré
   - Code de référence minimal et original (HTML / CSS / JS, GSAP si pertinent)
   - Variantes · Pièges · Performance · Accessibilité (prefers-reduced-motion)
   - Quand l'utiliser (types de sites, rôle de section, ton de marque) · Sources (liens)
5. Build demo/index.html: a standalone reproduction with neutral content (libraries from cdn.jsdelivr.net:
   gsap, lenis, three). If a browser is available (Playwright / Chrome), screenshot the demo at the same
   moments as frames/ and adjust timing, easing and amplitude until they match.
6. Update effect.json: "completed": true, "commonName" (confirm or improve en / fr / aka), "family",
   "technique", "sources": [urls], "demo": "demo/index.html", "useFor": [...].
Write in French (code and identifiers in English).
`;

export const COMMANDS = {
  'dip-effect.md': DIP_EFFECT,
  'dip-review.md': DIP_REVIEW,
  'dip-clone.md': DIP_CLONE,
  'dip-dna.md': DIP_DNA,
  'dip-transform.md': DIP_TRANSFORM,
  'dip-create.md': DIP_CREATE,
};
