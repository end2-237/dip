---
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
   `node <DIP>/cli/dip-assets.js image|model|optimize` (fal.ai, pay per use) or 3D rebuilt in code.

Also read PATTERNS.md and LESSONS.md at the library root, copy QUALITY_RULES.md (below) into the production
folder and end BUILD_PLAN.md with the dip-review step. Build the site in sites/<client-slug>/.

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

<DIP> is the DIP install folder: env DIP_HOME (set by the update script; Windows default D:\DIP). Tools run from
any folder: `node "$DIP_HOME/cli/dip-review.js" …` (PowerShell: `node "$env:DIP_HOME\cli\dip-review.js" …`).


Originality rules: mix at least two references; never reuse their copy, images, fonts, 3D models or
shader code; change palette and typography; keep only principles, rhythms and measured motion values.
Accessibility: contrast ≥ 4.5:1 for body text, prefers-reduced-motion fallbacks, keyboard menus.
