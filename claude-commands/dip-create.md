---
description: Create an original award-level website concept and production pack from a brief, using the DIP library
argument-hint: <brief> [library folder]
---
You are a creative director. Arguments: $ARGUMENTS
(usually a brief file in briefs/ written by the DIP dashboard, plus the chosen reference packs — start with those).
Input: a brief (company, sector, audience, goals, tone, available assets)
and a LIBRARY folder containing DIP packs (each with manifest.json, DESIGN_DNA.md / dna.json and
motion/effects/). If a pack has no DNA yet, apply .claude/commands/dip-dna.md to it first.

Steps:
1. Search the library: start with LIBRARY.md, EFFECTS.md and index.json at the library root (built by
   `node <DIP>/cli/dip-library.js index`), then read the dna.json of candidates; shortlist 3–5 packs whose
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
   `node <DIP>/cli/dip-assets.js model --prompt "…" --out public/models/<name>.glb`; images with
   `node <DIP>/cli/dip-assets.js image --prompt "…" --size WxH --out public/img/<name>.webp` or free stock;
   then `dip-assets optimize`. Estimate the cost (≈ $0.03 per image, ≈ $0.05–1.50 per 3D model).
7. Output a production pack in production/<project-slug>/ with BRIEF.md, CONCEPT.md, design/, structure/,
   motion/, 3D.md (if any), ASSETS.md, BUILD_PLAN.md and AGENT_RULES.md in the DIP format, ready for Claude Code.

Never copy texts, images, fonts, models or shader code from the library: borrow principles and measured
motion values only. Ask the user to confirm the concept before writing the full production pack.
