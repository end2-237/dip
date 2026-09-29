// Closed, versioned effect ontology (spec ch. 9). Extend by bumping TAXONOMY_VERSION.
export const TAXONOMY_VERSION = '1.0.0';

export const EFFECT_TYPES = {
  'text-reveal-lines': 'Text revealed line by line, usually each line translated from below inside an overflow:hidden mask.',
  'text-reveal-words': 'Text revealed word by word (split into words, staggered).',
  'text-reveal-chars': 'Text revealed character by character (split into chars, staggered).',
  'text-scramble': 'Characters cycle through random glyphs before settling.',
  'fade-up-reveal': 'Element fades in while translating up when it enters the viewport.',
  'scale-reveal': 'Element scales from a smaller/larger size to its natural size when revealed.',
  marquee: 'Content scrolls horizontally in an infinite linear loop.',
  'image-reveal-clip': 'Media revealed by animating clip-path / an overflow mask.',
  'image-parallax': 'Media translated at a different speed than the scroll (scrubbed).',
  'image-distortion-hover': 'WebGL shader distorts an image on hover / mouse move.',
  'image-trail': 'Images spawn and follow the mouse trail.',
  'gallery-drag': 'Draggable gallery / slider with inertia.',
  'horizontal-scroll-section': 'Vertical scroll drives a horizontal translation of a pinned track.',
  'pinned-sequence': 'Section pinned while scroll scrubs an animation sequence.',
  'scroll-scrubbed-video': 'Video currentTime driven by scroll.',
  'image-sequence-canvas': 'Frame sequence drawn to a canvas, driven by scroll.',
  counter: 'Numbers count up.',
  'magnetic-element': 'Element is attracted toward the pointer when hovered.',
  'custom-cursor': 'Custom DOM cursor following the pointer with lag.',
  'cursor-follower-media': 'Media preview follows the cursor over list items.',
  'tilt-3d': '3D tilt following the pointer.',
  'mouse-parallax': 'Layers translate proportionally to pointer position.',
  'page-transition': 'Animated transition between routes.',
  preloader: 'Loading screen / intro sequence before content is shown.',
  'menu-overlay': 'Full-screen menu overlay animation.',
  'fluid-background-shader': 'Full-bleed WebGL background driven by time/pointer.',
  'noise-gradient': 'Animated noise / gradient shader.',
  particles: 'Particle system (WebGL points or canvas2d).',
  'gpgpu-simulation': 'GPU simulation (ping-pong render targets, e.g. GPUComputationRenderer) feeding a visual effect.',
  '3d-scene': 'Three.js / WebGL 3D scene with meshes, lights, camera.',
  'camera-scroll-path': '3D camera travelling along a path driven by the scroll (position / rotation / fov keyframes).',
  '3d-object-motion': '3D object moved, rotated or scaled over time, on load, on scroll or in a loop.',
  'press-hold': 'Effect triggered by pressing and holding (pointer down), released on pointer up.',
  'tabs': 'Tabs / segmented control switching panels with a transition.',
  'model-viewer': '3D model presented in a viewer.',
  'split-screen': 'Split layout where halves move independently.',
  'sticky-stack-cards': 'Cards stack on top of each other using sticky positioning / pinning.',
  accordion: 'Expand / collapse panels.',
  'blend-mode-text': 'Text using mix-blend-mode (difference, exclusion...).',
  'svg-path-draw': 'SVG stroke drawn progressively (stroke-dashoffset / DrawSVG).',
  'morph-svg': 'SVG path morphing.',
  lottie: 'Lottie animation.',
  'grain-overlay': 'Animated film grain overlay.',
  'hover-state': 'Styled hover state (color / scale / underline / background transition).',
  'smooth-scroll': 'Global smooth scrolling system.',
  other: 'Motion that does not match a known type.',
};

export const TRIGGERS = ['load', 'scroll-enter', 'scroll-scrub', 'hover', 'press', 'mouse-move', 'click', 'drag', 'time-loop', 'route-change'];
export const TECHNIQUES = ['css-transition', 'css-keyframes', 'css-scroll-timeline', 'waapi', 'gsap-tween', 'gsap-timeline', 'gsap-scrolltrigger', 'framer-motion', 'webgl-shader', 'three-scene', 'canvas2d', 'svg', 'lottie', 'video', 'js-inline-style'];

export function isKnownType(t) {
  return Object.prototype.hasOwnProperty.call(EFFECT_TYPES, t);
}
