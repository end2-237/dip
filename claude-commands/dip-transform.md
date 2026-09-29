---
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
