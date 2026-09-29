---
name: asset-pipeline
description: Produce the images, videos, fonts and 3D objects of a DIP project — choose the right source for each asset (code, Blender, AI generation with dip-assets / fal.ai, free libraries), write consistent prompts from the art direction, optimise files and check licences. Use when ASSETS.md lists slots to fill or when placeholders must be replaced.
---

# Asset pipeline

## Decide per slot (cheapest good option first)
1. Code: gradients, noise, shapes, simple 3D (three.js primitives + shaders) — free, light, sharp.
2. Blender (skill blender-web-3d) for stylised custom objects.
3. Free libraries: Unsplash / Pexels (photos), Poly Haven / Kenney / Quaternius (CC0 3D), Google Fonts /
   Fontshare (fonts). Check each licence.
4. Generation, pay per use (`node <DIP>/cli/dip-assets.js`, needs `FAL_KEY` in the environment):
   `image --prompt … --size WxH --out public/img/x.webp` (≈ $0.03), `model --prompt … --out public/models/x.glb`
   (text → image → TRELLIS, ≈ $0.05), `--engine rodin` for higher quality (≈ $1.50).
5. The client's own photos / logo when good enough (retouch: crop, grade to the palette).

## Prompts (images)
`<subject>, <composition and framing>, <light>, <palette from tokens>, <material / texture>, <mood>,
<camera / lens>, no text, no logo` — same light and palette for every image of a site. For image → 3D,
ask for a single isolated object on a plain light-grey background, three-quarter view.

## Budgets
Hero image ≤ 250 KB (webp / avif, 2560 px max), other images ≤ 120 KB, video loops ≤ 3 MB (muted,
H.264 + poster), .glb ≤ 2 MB (Draco + webp textures: `dip-assets optimize`), 2 font families, woff2, subset.

## Never
Ship files from a DIP pack's `assets/files/` or `webgl/geometry/` (study copies of someone else's work),
generate real people's faces or trademarks, or leave an asset without a recorded source (keep
`ASSETS_SOURCES.md`: slot, file, source, licence, prompt, cost).
