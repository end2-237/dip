---
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
