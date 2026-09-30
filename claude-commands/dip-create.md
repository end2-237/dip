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
0. Read PATTERNS.md (numbers: sections, order, images and effects per section role, décor rhythm, motion
   density) and LESSONS.md (mistakes of previous builds that must not come back) at the library root.
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
   motion/, 3D.md (if any), ASSETS.md, BUILD_PLAN.md, AGENT_RULES.md and QUALITY_RULES.md (copy the block
   below) in the DIP format, ready for Claude Code. The section plan states, per section, its role, height
   (vh), number and placement of images and its motion moments, citing the PATTERNS.md line it follows.
   BUILD_PLAN.md builds the site in sites/<project-slug>/ and ends with the dip-review step.

# QUALITY RULES — non-negotiable for every page built with DIP

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
10. Done means verified: `node <DIP>/cli/dip-review.js --url <local url> --out sites/<slug>/review --library <library>`
   scores ≥ 85, and every 🔴 item of REVIEW.md is fixed.

Never copy texts, images, fonts, models or shader code from the library: borrow principles and measured
motion values only. Ask the user to confirm the concept before writing the full production pack.
