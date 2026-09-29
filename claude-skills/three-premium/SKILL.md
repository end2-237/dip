---
name: three-premium
description: Build award-level three.js scenes for websites — renderer and colour settings, lighting, materials, post-processing, scroll-driven cameras, pointer parallax, performance budgets and fallbacks. Use for any WebGL / three.js work in a DIP project (clones, transformations, new creations).
---

# three.js, award level

## Baseline (always)
- `renderer.outputColorSpace = SRGBColorSpace`, tone mapping `ACESFilmicToneMapping` (or `AgXToneMapping`) with
  exposure from the DIP pack when measured; `setPixelRatio(Math.min(devicePixelRatio, 2))`; `antialias` only
  without post-processing (else SMAA / FXAA pass).
- Environment light: `PMREMGenerator` + `RoomEnvironment` (or an HDR) — materials look flat without it.
- Materials: `MeshPhysicalMaterial` for hero objects (clearcoat, sheen, transmission + thickness for glass,
  iridescence sparingly). One hero material, the rest quiet.
- Name every animated object (`object.name`) — dip-verify matches 3D motion by name.
- Resize with the container (ResizeObserver), cap the canvas to the viewport, dispose on route change.

## Motion
- Scroll: GSAP ScrollTrigger (`scrub: true` or a number for lag) tweening camera position / rotation / fov and
  object transforms; keyframes and ranges come from the DIP pack (`motion/effects/*camera*`).
- Pointer: normalised -1..1, smoothed with `lerp` 0.05–0.1 per frame, small amplitudes (≤ 0.3 rad, ≤ 0.5 units).
- Idle life: slow loops (0.1–0.5 rad/s), subtle float (sin, amplitude ≤ 2 % of size). Never frantic.
- Décor changes: drive clear colour, fog and light colours from the same CSS variables as the page.

## Post-processing (pmndrs `postprocessing` preferred)
Bloom (threshold high, intensity ≤ 1), subtle noise / grain (opacity 0.03–0.08), vignette, chromatic
aberration only on transitions. Every pass costs: stop at 3–4.

## Budget
Desktop: ≤ 100 draw calls, ≤ 500k triangles, 60 fps on an integrated GPU. Mobile: half of it, DPR 1.5,
no transmission, fewer passes. Load models with `DRACOLoader` / `KTX2Loader`; show the page before the 3D.
`prefers-reduced-motion`: freeze loops, keep a static composed frame.

## Assets
Objects come from code first (primitives + shaders), then Blender (skill blender-web-3d), then generation
(`dip-assets model`) or CC0 libraries. Never ship the original site's models or shaders.
