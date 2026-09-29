---
description: Full clone loop from a URL — capture with DIP, write the DNA, build section by section, verify
argument-hint: <url> [work folder]
---
You are a senior creative developer. URL and options: $ARGUMENTS
Goal: a private study clone of that URL that reaches the fidelity
thresholds measured by DIP, built section by section. Work in the given folder (default: the current one).

0. Locate DIP: the folder that contains cli/dip-capture.js (env DIP_HOME, or ask the user once).
   Check node --version ≥ 20 and that `npm install` was run in the DIP folder.
1. Capture: `node <DIP>/cli/dip-capture.js <url> --out packs --breakpoints 1440,390`
   (headed Chromium; ~2–4 min). If the site blocks automated browsers (captcha, empty page, 403), stop and
   ask the user to scan it with the DIP extension instead and give you the pack folder.
   If a library exists (env DIP_LIBRARY), also run `node <DIP>/cli/dip-library.js add <pack>`.
2. DNA: follow <pack>/.claude/commands/dip-dna.md (DESIGN_DNA.md + dna.json). Keep it short: 1–2 pages.
3. Build: create site/ with the stack of manifest.json, then follow BUILD_PLAN.md step by step.
   Assets: follow ASSETS.md (study clone: the files of assets/files and webgl/geometry may be used locally,
   never published).
4. Verify each section right after building it:
   `node <DIP>/cli/dip-verify.js --pack <pack> --url http://localhost:5173 --section <id> --breakpoints 1440 --headless`
   Fix the notes of the report, at most 3 verify runs per section, then move on (write what is left in
   NOTES.md). 3D: approximate first, refine only if the score is below 0.6.
5. End: `node <DIP>/cli/dip-verify.js --pack <pack> --url http://localhost:5173 --all --headless` and write
   CLONE_REPORT.md: scores per section and metric, what is missing, what DIP did not capture (so DIP can be
   improved), time spent.

Rules: the clone stays private (study). Every value comes from the pack; mark guesses [estimated].
Report progress in one short line per step.
