---
description: Review a site built with DIP (dead zones, header over text, static hero, sections without motion, mobile) and fix it until the score is ≥ 85
argument-hint: <site folder in sites/> [local url]
---
Site to review: $ARGUMENTS (default: the only folder in sites/). Work from the library root.

1. Start the site (npm install once, then npm run dev) and note its local URL.
2. Run `node <DIP>/cli/dip-review.js --url <url> --out sites/<slug>/review --library .` (DIP folder: env DIP_HOME,
   or ask once). Read sites/<slug>/review/REVIEW.md and LOOK at every screenshot it lists.
3. Fix the items in order (🔴 first), following QUALITY_RULES.md of the production pack and the measured values
   of PATTERNS.md / EFFECTS.md. Keep the concept and the art direction; do not rewrite what works.
4. Re-run dip-review. At most 3 rounds; stop earlier at ≥ 85 with no 🔴 left.
5. Append to LESSONS.md at the library root one line per NEW kind of mistake you fixed, written as a rule for
   future builds (e.g. "Script/demo boxes: height follows the content, never a fixed 60vh"). Keep the file short:
   merge with existing lines instead of repeating them.
6. Update sites/<slug>/NOTES.md: score before → after, what changed, what is still missing (client content).
