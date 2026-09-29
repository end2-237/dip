---
name: motion-premium
description: Implement premium web motion with GSAP, ScrollTrigger, SplitText / split-type and Lenis using the values measured by DIP — text reveals, scroll scrubs, pinned sequences, décor colour changes, zoom-through, media expand, image compositions, hover / press / drag micro-interactions. Use whenever animating a DIP project.
---

# Premium motion

## Source of truth
Use the measured values of the DIP packs: `motion/effects/*.md` (recipes), `EFFECTS.md` at the library root
(the same need across many sites), `motion/scroll-system.json` (Lenis lerp), `motion/scene.json` (décor).
Never invent a duration or an ease when a measured one exists; mark guesses `[estimated]`.

## Foundations
- Lenis: `new Lenis({ lerp: <measured> })`, `lenis.on('scroll', ScrollTrigger.update)`,
  `gsap.ticker.add((t) => lenis.raf(t * 1000))`, `gsap.ticker.lagSmoothing(0)`.
- Tempo: premium sites use 0.8–1.4 s reveals with `expo.out` / `power4.out` or custom beziers, 0.04–0.12 s
  staggers, and 0.25–0.5 s micro-interactions. Keep one tempo family per site.
- Text: split into lines (masked, `overflow: hidden`) → words → chars only when the reference does;
  keep `aria-label` with the full text; re-split on resize.

## Patterns
- Scroll-enter reveal: ScrollTrigger `start: 'top 85%'`, `once: true`.
- Scrub: `scrub: true` (or 0.5–1 for lag), `ease: 'none'` on the tween when the pack gives a linear scroll curve.
- Pinned sequence / horizontal scroll: pin the section, timeline scrubbed over N × viewport height.
- Décor change: colours as CSS variables (`--bg`, `--fg`, `--accent`); tween the variables on scroll
  (scrub) or toggle a theme class with a 0.6–1 s transition, exactly as `motion/scene.json` says.
- Zoom-through: pin, scale the target to cover the viewport (transform-origin on the entry point), swap
  to the next scene inside it at the end.
- Media expand: clip-path `inset()` or width/height + radius → 0 from card to full screen, image counter-scale.
- Image compositions (spiral / circle / fan / stack): place items with a formula (index → angle, radius,
  rotation), animate the group (rotation, radius, stagger) — see the `media-choreography` cards.
- Hover: 0.3–0.6 s, transform and colour only; magnetic elements with pointer offset × strength, lerped.
- Press / click feedback: scale 0.9–0.96 with a springy bezier, colour flash; never block navigation.
- Drag: pointer events + velocity, inertia glide (`InertiaPlugin`, Embla, Swiper freeMode), follow ratio 1.

## Always
`prefers-reduced-motion`: no scrubbed transforms, instant reveals, no loops. Animate transform / opacity /
clip-path / filter only. Verify with `dip-verify` when a reference exists.
