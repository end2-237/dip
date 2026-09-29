// Claude Code commands shipped with every pack (and in /claude-commands of the repo).
// They run inside Claude Code, i.e. on the user's Claude subscription — no API key needed.

export const DIP_DNA = `---
description: Write the design DNA (art direction + production rules) of this DIP pack
---
You are an art director and senior creative developer. The folder that contains this command's pack
(the directory holding SPEC.md and manifest.json — if you are not inside it, find it) is a DIP
Reproduction Pack: MEASUREMENTS of a premium website captured in a real browser.

Goal: write DESIGN_DNA.md and dna.json at the pack root. They capture the essence of the site so a
studio can produce NEW, ORIGINAL sites of the same standard — not copy this one.

Read, in this order: SPEC.md, design/tokens.json, design/typography.md, design/grid.md,
structure/sections.json, structure/content.md, motion/scroll-system.json, motion/timeline-intro.json,
every motion/effects/*.json, webgl/three-scene.md and webgl/*.md if present, perf.json.
LOOK at the reference images (reference/1440/*.png, reference/390/*.png, press/, toggle/, hover/):
describe what you see — composition, imagery, light, texture.

DESIGN_DNA.md sections:
1. Positioning — sector, audience, promise, emotional register (3 lines).
2. Visual language — 5–8 keywords, and what makes it feel premium.
3. Composition — grid (columns, margins, gutters by breakpoint), whitespace ratio, density, vertical rhythm,
   section archetypes in order (e.g. "full-bleed 3D hero → manifesto → logo rail → feature grid").
4. Typography — families and roles, fluid scale (clamp formulas), weights, tracking, case, mono/label usage.
5. Colour — roles (background, text, accent, surfaces), share of surface, contrast, light/dark rhythm across sections.
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
"copy": { "tone": "", "avgHeadlineWords": n } }.

Rules: every number must come from the pack (write [estimated] otherwise). Do not reproduce the site's
texts, images, fonts or shader code: describe them. Write in the language the user writes to you in
(default: French), keep dna.json keys in English.
`;

export const DIP_TRANSFORM = `---
description: Turn an ordinary client site into a premium production brief using DIP reference packs
argument-hint: <client pack folder> <reference pack folder(s)> [brief]
---
You are a creative director running a studio. Inputs (ask for any that are missing):
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

Originality rules: mix at least two references; never reuse their copy, images, fonts, 3D models or
shader code; change palette and typography; keep only principles, rhythms and measured motion values.
Accessibility: contrast ≥ 4.5:1 for body text, prefers-reduced-motion fallbacks, keyboard menus.
`;

export const DIP_CREATE = `---
description: Create an original award-level website concept and production pack from a brief, using the DIP library
argument-hint: <brief> [library folder]
---
You are a creative director. Input: a brief (company, sector, audience, goals, tone, available assets)
and a LIBRARY folder containing DIP packs (each with manifest.json, DESIGN_DNA.md / dna.json and
motion/effects/). If a pack has no DNA yet, apply .claude/commands/dip-dna.md to it first.

Steps:
1. Search the library: read every dna.json; shortlist 3–5 packs whose register, sectors and signature
   effects fit the brief. Explain the shortlist in a table (why each fits, what to borrow).
2. Write CONCEPT.md: 2–3 alternative big ideas, pick one, justify it. Describe the experience minute by minute
   (intro, scroll narrative, interactions, 3D moments).
3. Design an ORIGINAL design system (tokens.json + tokens.css): palette, type pairing (free fonts), fluid
   scale, grid, spacing — coherent with the concept, different from every reference.
4. Write the section plan with drafted copy (headlines, body, CTAs) in the brief's language and tone.
5. MOTION_SYSTEM.md: choose effects from the library packs' motion/effects/*.json by need
   (e.g. "reveal a manifesto" → text-reveal-lines with measured expo.out 1.2s stagger 0.08); reuse measured
   values; define scroll feel, intro, hovers, presses, menu, and 3D (camera path / objects / post-processing)
   when it serves the idea. Keep a perf budget (LCP, frame time) and reduced-motion fallbacks.
6. Output a production pack in production/<project-slug>/ with BRIEF.md, CONCEPT.md, design/, structure/,
   motion/, 3D.md (if any), BUILD_PLAN.md and AGENT_RULES.md in the DIP format, ready for Claude Code.

Never copy texts, images, fonts, models or shader code from the library: borrow principles and measured
motion values only. Ask the user to confirm the concept before writing the full production pack.
`;

export const COMMANDS = {
  'dip-dna.md': DIP_DNA,
  'dip-transform.md': DIP_TRANSFORM,
  'dip-create.md': DIP_CREATE,
};
