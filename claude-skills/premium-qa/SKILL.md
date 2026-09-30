---
name: premium-qa
description: Quality gate for sites built with DIP — use before saying a build is finished, after large changes, or when asked whether a site is "award level". Runs dip-review (dead zones, header over text, static hero, sections without motion, mobile), fixes by priority and records lessons.
---

# Premium QA

1. Read QUALITY_RULES.md (production pack or library root) and LESSONS.md (library root).
2. Run `node <DIP>/cli/dip-review.js --url <local url> --out sites/<slug>/review --library <library root>`.
3. LOOK at the screenshots of every item in REVIEW.md; fix 🔴 then 🟠 items; re-run (max 3 rounds).
4. Beyond the tool, check by eye at 1440 and 390: one focal point per screen, consistent tempo, text never
   over busy imagery without contrast, the signature moment readable in under 3 seconds.
5. Add new kinds of mistakes to LESSONS.md as one-line rules; update NOTES.md with the score.
