---
description: Complete a focus analysis (effects/<slug>) — identify the animation, research it on the web, write the full reproduction card and a working demo
argument-hint: <effects/slug>
---
Effect folder: $ARGUMENTS (a DIP focus analysis: EFFECT.md, effect.json, frames/, curves/, code/).

1. Read EFFECT.md, effect.json, curves/*.json, code/css.txt, code/gsap.json and code/*.glsl. LOOK at every image
   of frames/ in order (00 selected zone · 10 idle · 20 scroll · 30 hover · 40 pointer · 50 press · 60 click ·
   70 drag): describe what changes between frames.
2. Identify the effect: its usual name(s) among designers and developers, its family, and how it is built
   (DOM + CSS, GSAP / ScrollTrigger, SplitText, canvas 2D, WebGL shader, Three.js, Lottie…). Explain the
   mechanism in plain words.
3. Research it on the web (WebSearch / WebFetch): start with the search query of EFFECT.md, then refine.
   Prefer Codrops, the GSAP docs and forum, CodePen, MDN, three.js examples. Keep 3–6 useful sources with
   links. Tutorials may inspire the method; never copy the analysed site's code or assets.
4. Append to EFFECT.md a section "## Fiche complète (Claude)":
   - Nom usuel et autres noms · Ce que voit le visiteur (timeline seconde par seconde ou % de scroll)
   - Comment ça marche (mécanisme) · Recette pas à pas avec les valeurs MESURÉES (durées, easings, décalages,
     plages de scroll, amplitudes, uniforms) — [estimated] pour tout ce qui n'est pas mesuré
   - Code de référence minimal et original (HTML / CSS / JS, GSAP si pertinent)
   - Variantes · Pièges · Performance · Accessibilité (prefers-reduced-motion)
   - Quand l'utiliser (types de sites, rôle de section, ton de marque) · Sources (liens)
5. Build demo/index.html: a standalone reproduction with neutral content (libraries from cdn.jsdelivr.net:
   gsap, lenis, three). If a browser is available (Playwright / Chrome), screenshot the demo at the same
   moments as frames/ and adjust timing, easing and amplitude until they match.
6. Update effect.json: "completed": true, "commonName" (confirm or improve en / fr / aka), "family",
   "technique", "sources": [urls], "demo": "demo/index.html", "useFor": [...].
Write in French (code and identifiers in English).
