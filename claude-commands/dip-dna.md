---
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
