// Reproduction Pack writer (spec ch. 10). Produces a list of {path, data} files, then a zip.
import { zip, base64ToBytes } from './zip.js';
import { EFFECT_TYPES } from './taxonomy.js';
import { COMMANDS } from './commands.js';
import { SKILLS } from './skills.js';
import { geometryToGlb } from './glb.js';
import { sectionFor } from './analyzer.js';

export const SCHEMA_VERSION = 1;
export const DIP_VERSION = '0.3.0';

const J = (o) => JSON.stringify(o, null, 2);
const r2 = (x) => Math.round(x * 100) / 100;

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return 'site';
  }
}
export function packName(cap) {
  const d = new Date((cap.meta && cap.meta.date) || Date.now());
  const ds = d.toISOString().slice(0, 10);
  return `dip-pack_${domainOf(cap.meta && cap.meta.url)}_${ds}`;
}

function lorem(len) {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat'.split(' ');
  let s = '';
  let i = 0;
  while (s.length < len) s += (s ? ' ' : '') + words[i++ % words.length];
  return s.slice(0, len);
}

function recommendStack(analysis) {
  const has = (n, min) => analysis.stack.find((s) => s.name === n && s.confidence >= (min || 0.7));
  const ver = (n) => {
    const s = has(n, 0.5);
    return s && s.version ? s.version : null;
  };
  const stack = { framework: has('nextjs') ? 'next' : has('nuxt') ? 'nuxt' : has('astro') ? 'astro' : 'vite (vanilla JS)', libraries: [] };
  const lib = (name, pkg, v) => stack.libraries.push({ name, package: pkg, version: v || 'latest' });
  if (has('gsap') || has('scrolltrigger')) lib('gsap', 'gsap', ver('gsap') || '^3.12');
  if (has('scrolltrigger')) lib('ScrollTrigger', 'gsap/ScrollTrigger', ver('gsap') || '^3.12');
  if (has('splittext')) lib('SplitText', 'gsap/SplitText', ver('gsap') || '^3.13');
  else if (analysis.splits.length) lib('split-type', 'split-type', '^0.3');
  if (has('customease')) lib('CustomEase', 'gsap/CustomEase', ver('gsap') || '^3.12');
  if (has('lenis') || analysis.scroll.type === 'lenis' || analysis.scroll.type === 'locomotive') lib('lenis', 'lenis', ver('lenis') || '^1.1');
  if (analysis.scroll.type === 'gsap-scrollsmoother') lib('ScrollSmoother', 'gsap/ScrollSmoother', ver('gsap') || '^3.12');
  if (has('three') || analysis.webgl.three) lib('three', 'three', ver('three') ? '0.' + ver('three') : 'latest');
  else if (has('ogl') || analysis.webgl.cards.length) lib('ogl', 'ogl', '^1.0');
  if (has('framer-motion')) lib('motion', 'motion', 'latest');
  if (has('barba')) lib('barba', '@barba/core', '^2.9');
  if (has('swup')) lib('swup', 'swup', '^4');
  if (has('lottie')) lib('lottie', 'lottie-web', '^5');
  if (has('swiper')) lib('swiper', 'swiper', '^11');
  return stack;
}

// ------------------------------------------------------------------ AGENT_RULES.md (spec 10.3 + DIP contract)
function agentRules() {
  return `# AGENT_RULES — read before doing anything

These rules are part of the DIP Reproduction Pack contract. Follow them strictly.

1. Read \`SPEC.md\`, then \`BUILD_PLAN.md\`. Follow the steps in order.
2. Stack: use the one in \`manifest.json\` → \`stack\` (versions included) unless stated otherwise.
3. The values in \`design/\` and \`motion/\` are MEASUREMENTS: use them as-is.
   Never invent a duration, an easing or a colour that is absent from the pack.
   Where a value is missing, write the simplest thing and mark it \`/* [estimated] */\`.
4. Mark up the clone so it can be verified:
   - every section root gets \`data-dip-section="<section id>"\` (ids in \`structure/sections.json\`);
   - the main target of every effect gets \`data-dip-effect="<effect id>"\` (ids in \`motion/effects/\`);
     when one element carries several effects, list them separated by spaces: \`data-dip-effect="e02 e09"\`;
   - key anchors (main title, main media, CTA) of each section get \`data-dip-anchor="<name>"\` when listed in \`verify/dip.verify.json\`.
5. Build section by section. After each section run:
       npx dip-verify --pack . --section <id>
   and fix until the threshold in \`verify/dip.verify.json\` is reached.
6. When an effect is marked \`source: "vision"\` or \`confidence < 0.6\`, implement the simplest
   solution that passes the threshold, and record it in \`NOTES.md\`.
7. Write original code. Never embed files from \`webgl/*.glsl\`, \`webgl/geometry/*.glb\` nor study-mode assets
   (\`assets/files/\`) in a deliverable meant to be published: re-implement from the cards and follow
   \`ASSETS.md\` to produce original images, fonts and 3D objects.
8. Always handle \`prefers-reduced-motion: reduce\` (disable or shorten non-essential motion).
9. End of mission: \`npx dip-verify --pack . --all\` ; global score ≥ 0.90 ; attach the report.
`;
}

// ------------------------------------------------------------------ effect cards
function fmt(v) {
  if (v == null) return '[unknown]';
  if (typeof v === 'object') return '`' + JSON.stringify(v) + '`';
  return '`' + String(v) + '`';
}

function gsapVarsLiteral(obj) {
  if (!obj || typeof obj !== 'object') return '{}';
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && v.selector) parts.push(`${k}: '${v.selector}'`);
    else parts.push(`${k}: ${typeof v === 'string' ? `'${v}'` : JSON.stringify(v)}`);
  }
  return '{ ' + parts.join(', ') + ' }';
}

function recipe(e, analysis) {
  const a = e.animation || {};
  const sel = (e.targets || []).map((t) => t.selector).filter(Boolean);
  const target = e.split ? e.split.container : sel[0] || '[target]';
  const lines = [];
  let stepN = 0;
  const n = () => ++stepN;
  const stInfo = e.scrollTrigger;
  const stLiteral = stInfo
    ? `scrollTrigger: { trigger: '${stInfo.trigger || target}', start: '${stInfo.start}', end: '${stInfo.end}'${stInfo.scrub ? `, scrub: ${JSON.stringify(stInfo.scrub)}` : ''}${stInfo.pin ? `, pin: ${stInfo.pin === stInfo.trigger ? 'true' : `'${stInfo.pin}'`}` : ''}${stInfo.toggleActions ? `, toggleActions: '${stInfo.toggleActions}'` : ''} }`
    : null;
  if (e.split) {
    lines.push(`${n()}. Split \`${e.split.container}\` into **${e.split.type}**${e.split.nested ? ` (then ${e.split.nested})` : ''} — ${e.split.count} units${e.split.mask ? ', each wrapped in an `overflow: hidden` mask element' : ''}. Keep the full text in \`aria-label\` on the container and \`aria-hidden="true"\` on the pieces.`);
  }
  if (e.source === 'read:gsap') {
    if (a.steps) {
      lines.push(`${n()}. Build a GSAP timeline${a.timeline && a.timeline.repeat ? ` (repeat: ${a.timeline.repeat}${a.timeline.yoyo ? ', yoyo' : ''})` : ''}${stLiteral ? ' driven by ScrollTrigger' : ''} with these steps (exact values):`);
      lines.push('');
      lines.push('```js');
      lines.push(`const tl = gsap.timeline(${stLiteral ? `{ ${stLiteral} }` : a.timeline && (a.timeline.repeat || a.timeline.delay) ? gsapVarsLiteral({ repeat: a.timeline.repeat || undefined, yoyo: a.timeline.yoyo || undefined, delay: a.timeline.delay || undefined }) : ''});`);
      for (const s of a.steps) {
        const t = s.targets && s.targets.length ? `'${s.targets.join(', ')}'` : "'[target]'";
        const vars = { ...(typeof s.to === 'object' ? s.to : {}), duration: s.duration, ease: s.ease };
        if (s.delay) vars.delay = s.delay;
        if (s.stagger != null) vars.stagger = s.stagger;
        const pos = s.position != null ? `, ${JSON.stringify(s.position)}` : '';
        if (s.method === 'fromTo') lines.push(`tl.fromTo(${t}, ${gsapVarsLiteral(s.from)}, ${gsapVarsLiteral(vars)}${pos});`);
        else if (s.method === 'from') lines.push(`tl.from(${t}, ${gsapVarsLiteral({ ...(typeof s.from === 'object' ? s.from : {}), duration: s.duration, ease: s.ease, ...(s.stagger != null ? { stagger: s.stagger } : {}), ...(s.delay ? { delay: s.delay } : {}) })}${pos});`);
        else lines.push(`tl.to(${t}, ${gsapVarsLiteral(vars)}${pos});`);
      }
      lines.push('```');
    } else {
      const t = e.split ? `split.${e.split.type}` : `'${sel.slice(0, 3).join(', ') || target}'`;
      const vars = { ...(typeof a.to === 'object' ? a.to : {}), duration: a.duration, ease: a.ease };
      if (a.delay) vars.delay = a.delay;
      if (a.stagger != null) vars.stagger = a.stagger;
      else if (a.observedStagger) vars.stagger = a.observedStagger;
      if (a.repeat) vars.repeat = a.repeat;
      if (a.yoyo) vars.yoyo = true;
      let call;
      if (a.method === 'fromTo') call = `gsap.fromTo(${t}, ${gsapVarsLiteral(a.from)}, ${gsapVarsLiteral(vars).replace(/ }$/, stLiteral ? `, ${stLiteral} }` : ' }')});`;
      else if (a.method === 'from') call = `gsap.from(${t}, ${gsapVarsLiteral({ ...(typeof a.from === 'object' ? a.from : {}), duration: a.duration, ease: a.ease, ...(vars.delay ? { delay: vars.delay } : {}), ...(vars.stagger != null ? { stagger: vars.stagger } : {}) }).replace(/ }$/, stLiteral ? `, ${stLiteral} }` : ' }')});`;
      else call = `gsap.to(${t}, ${gsapVarsLiteral(vars).replace(/ }$/, stLiteral ? `, ${stLiteral} }` : ' }')});`;
      lines.push(`${n()}. Animate with GSAP (values read from the site's GSAP calls${a.instances > 1 ? `; the site calls this ${a.instances}× — once per element` : ''}):`);
      lines.push('');
      lines.push('```js');
      if (e.split) lines.push(`const split = new SplitText('${e.split.container}', { type: '${e.split.type}'${e.split.mask ? `, mask: '${e.split.type}'` : ''} }); // or split-type`);
      lines.push(call);
      lines.push('```');
    }
  } else if (e.source === 'read:waapi') {
    if (e.technique === 'css-keyframes' || e.technique === 'css-scroll-timeline') {
      lines.push(`${n()}. CSS keyframes \`${a.name || 'anim'}\` (exact):`);
      lines.push('');
      lines.push('```css');
      lines.push(`@keyframes ${a.name || 'anim'} {`);
      for (const k of a.keyframes || []) {
        const off = k.offset != null ? Math.round(k.offset * 100) + '%' : '';
        const decl = Object.entries(k).filter(([p]) => !['offset', 'easing'].includes(p)).map(([p, v]) => `${p.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}: ${v};`).join(' ');
        lines.push(`  ${off} { ${decl} }`);
      }
      lines.push('}');
      lines.push(`${target} { animation: ${a.name || 'anim'} ${a.duration}s ${a.ease} ${a.delay || 0}s ${a.iterations === 'Infinity' || a.iterations === Infinity ? 'infinite' : a.iterations || 1} ${a.direction || 'normal'} ${a.fill || 'none'}; }`);
      if (e.technique === 'css-scroll-timeline') lines.push(`/* timeline: ${a.timeline} ${a.rangeStart ? 'range ' + JSON.stringify(a.rangeStart) + ' → ' + JSON.stringify(a.rangeEnd) : ''} */`);
      lines.push('```');
    } else if (e.technique === 'css-transition') {
      lines.push(`${n()}. CSS transition on \`${a.name}\`: \`transition: ${a.name} ${a.duration}s ${a.ease} ${a.delay || 0}s\`. Keyframes observed: ${fmt(a.keyframes)}.`);
    } else {
      lines.push(`${n()}. \`element.animate(keyframes, { duration: ${typeof a.duration === 'number' ? Math.round(a.duration * 1000) : a.duration}, easing: '${a.ease}', delay: ${Math.round((a.delay || 0) * 1000)}, iterations: ${a.iterations}, fill: '${a.fill}' })\` with keyframes ${fmt(a.keyframes)}${a.stagger ? `, staggered by ${a.stagger}s` : ''}.`);
    }
  } else if (e.source === 'measured:recorder') {
    const v = a.values || {};
    if (e.trigger === 'scroll-scrub') {
      lines.push(`${n()}. Scrub the animation with the scroll between **${a.scroll && a.scroll.startPx}px** and **${a.scroll && a.scroll.endPx}px** of page scroll (at 1440px). Measured: ${fmt(v)}; ${a.scroll && a.scroll.pxPerScrollPx} px of motion per px of scroll; progress curve ≈ \`${a.ease}\` (RMS ${a.fit_rms}).`);
      lines.push('');
      lines.push('```js');
      lines.push(`gsap.fromTo('${target}', { ${Object.entries(v).filter(([, x]) => x.atStart != null).map(([k, x]) => `${k}: ${x.atStart}`).join(', ')} }, { ${Object.entries(v).filter(([, x]) => x.atEnd != null).map(([k, x]) => `${k}: ${x.atEnd}`).join(', ')}, ease: '${a.ease}',`);
      lines.push(`  scrollTrigger: { trigger: '${target}', start: ${a.scroll && a.scroll.startPx}, end: ${a.scroll && a.scroll.endPx}, scrub: true } }); // absolute px: convert to trigger-relative positions`);
      lines.push('```');
    } else if (e.trigger === 'time-loop' && a.loop) {
      lines.push(`${n()}. Infinite linear loop on \`${a.loop.channel}\` at **${a.loop.speedPxPerS} px/s** (range ${a.loop.min} → ${a.loop.max}). Duplicate the content so the loop is seamless.`);
    } else if (e.trigger === 'mouse-move' && a.mouse) {
      lines.push(`${n()}. Follow the pointer on the ${a.mouse.axis} axis: \`${a.mouse.channel} = gain × pointer${a.mouse.axis.toUpperCase()}\` with gain ≈ **${a.mouse.gain}**${a.mouse.lerp ? `, smoothed with lerp ≈ **${a.mouse.lerp}** per frame` : ''}. Measured ranges: ${fmt(v)}.`);
    } else {
      const from = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.from]));
      const to = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.to]));
      lines.push(`${n()}. Animate (measured, trigger \`${e.trigger}\`): duration **${a.duration}s**, ease \`${a.ease}\`${a.ease_named_nearest && a.ease !== a.ease_named_nearest ? ` (nearest named: \`${a.ease_named_nearest}\`)` : ''}${a.stagger ? `, stagger **${a.stagger}s**` : ''}. Fit RMS ${a.fit_rms}.`);
      lines.push('');
      lines.push('```js');
      lines.push(`gsap.fromTo('${sel.slice(0, 3).join(', ') || target}', ${gsapVarsLiteral(from)}, ${gsapVarsLiteral({ ...to, duration: a.duration, ease: a.ease && a.ease.startsWith('cubic') ? `CustomEase:${a.ease_bezier && a.ease_bezier.join(',')}` : a.ease, ...(a.stagger ? { stagger: a.stagger } : {}) })}); // x/y are px (computed transform)`);
      lines.push('```');
      if (e.trigger === 'scroll-enter') lines.push(`Trigger it when the element enters the viewport (IntersectionObserver or ScrollTrigger \`start: 'top 85%'\` [estimated]).`);
    }
  } else if (e.source === 'read:three') {
    const t3 = e.three || {};
    const who = t3.object === 'camera' ? 'the camera' : `the object named \`${t3.object}\` (set \`object.name = '${t3.object}'\` so dip-verify can match it)`;
    if (e.trigger === 'scroll-scrub') {
      lines.push(`${n()}. Drive ${who} with the scroll between **${a.scroll.startPx}px** and **${a.scroll.endPx}px** (page scroll at 1440): channels ${a.channels.map((c) => '`' + c + '`').join(', ')}, progress ease ≈ \`${a.ease}\`. Keyframes (scene units / radians):`);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(a.keyframes, null, 0).replace(/},{/g, '},\n{'));
      lines.push('```');
      lines.push('');
      lines.push(`   Implementation: a GSAP timeline with ScrollTrigger (\`scrub: true\`) tweening ${t3.object === 'camera' ? '`camera.position` / `camera.rotation` (and `camera.fov` + `updateProjectionMatrix()`)' : 'the object transform'}, or interpolate the keyframes yourself from the scroll progress.`);
    } else if (e.trigger === 'mouse-move') {
      lines.push(`${n()}. Make ${who} follow the pointer (pointer normalised to -1..1 across the viewport). Gains per channel: ${fmt(a.mouse && a.mouse.gains)}. Smooth it (lerp ≈ 0.05–0.1 per frame [estimated]). Ranges: ${fmt(a.range)}.`);
    } else if (e.trigger === 'time-loop') {
      lines.push(`${n()}. Animate ${who} continuously: speed per second ${fmt(a.loop && a.loop.perSecond)} (${a.loop && a.loop.note}). Ranges: ${fmt(a.range)}.`);
    } else {
      lines.push(`${n()}. Animate ${who} on \`${e.trigger}\`: from ${fmt(a.from)} to ${fmt(a.to)} in **${a.duration}s**, ease \`${a.ease}\`.`);
    }
  } else if (e.source === 'measured:press') {
    lines.push(`${n()}. While the pointer is pressed (held ${a.holdMs}ms), apply (before → pressed):`);
    lines.push('');
    for (const c of (a.changes || []).slice(0, 12)) lines.push(`   - \`${c.sel}\` **${c.prop}**: \`${c.before}\` → \`${c.after}\``);
    for (const m of (a.motion || []).slice(0, 6)) lines.push(`   Motion: ${(m.targets || []).map((t) => '\`' + t + '\`').join(', ')} ${m.duration != null ? m.duration + 's' : ''} ${m.ease || ''} ${m.values ? fmt(m.values) : ''}`);
    lines.push(`   Use \`:active\` or pointerdown / pointerup listeners; release restores the rest state.`);
  } else if (e.source === 'measured:toggle') {
    lines.push(`${n()}. Clicking \`${(e.targets[0] || {}).selector}\` (${a.kind}${a.label ? ` "${a.label}"` : ''}) opens / switches content${a.controls ? ` \`${a.controls.selector}\`` : ''}; it settles in ≈ ${a.settleMs}ms. Compare the closed / open references: ${(e.shots || []).map((s) => '`' + s + '`').join(', ')}.`);
    if (a.opened && a.opened.newOverlays && a.opened.newOverlays.length) lines.push(`   A full-viewport layer appears: ${a.opened.newOverlays.map((o) => '`' + o + '`').join(', ')}${a.opened.bodyOverflow ? ` and the page scroll is locked (body overflow: ${a.opened.bodyOverflow})` : ''}.`);
    if (a.styleChanges && a.styleChanges.length) for (const c of a.styleChanges.slice(0, 10)) lines.push(`   - \`${c.sel}\` **${c.prop}**: \`${c.before}\` → \`${c.after}\``);
    for (const m of (a.motion || []).slice(0, 8)) lines.push(`   Motion while opening: ${(m.targets || []).map((t) => '\`' + t + '\`').join(', ')} — ${Array.isArray(m.properties) ? m.properties.join(', ') : m.properties || ''} ${m.duration != null ? m.duration + 's' : ''} ${m.ease ? '\`' + m.ease + '\`' : ''}${m.delay ? ' delay ' + m.delay + 's' : ''}`);
    lines.push(`   Keep \`aria-expanded\` / \`aria-selected\` in sync, close on Escape, trap focus in overlays.`);
  } else if (e.source === 'measured:click') {
    lines.push(`${n()}. Clicking \`${(e.targets[0] || {}).selector}\` gives visual feedback (no navigation). Just after the click (≈150 ms):`);
    for (const c of (a.during || []).slice(0, 10)) lines.push(`   - \`${c.sel}\` **${c.prop}**: \`${c.before}\` → \`${c.after}\``);
    if ((a.persistent || []).length) {
      lines.push(`   State kept after the click (≈1 s):`);
      for (const c of a.persistent.slice(0, 8)) lines.push(`   - \`${c.sel}\` **${c.prop}**: \`${c.before}\` → \`${c.after}\``);
    }
    for (const m of (a.motion || []).slice(0, 6)) lines.push(`   Motion: ${(m.targets || []).map((t) => '\`' + t + '\`').join(', ')} ${m.duration != null ? m.duration + 's' : ''} ${m.ease ? '\`' + m.ease + '\`' : ''} ${m.values ? fmt(m.values) : ''}`);
  } else if (e.source === 'measured:drag') {
    lines.push(`${n()}. \`${(e.targets[0] || {}).selector}\` can be dragged with the pointer${a.grabCursor ? ' (cursor: grab / grabbing)' : ''}. Measured with a ${Math.abs(a.dragPx)}px flick in ~200 ms: the content followed **${a.followPx}px** during the drag (ratio ${a.followRatio}), and travelled **${a.travelPx}px** in total after release${a.inertia ? ` (inertia ×${a.inertia})` : ''}; it settled in ≈ ${a.settleMs}ms.`);
    lines.push(`   Implementation: pointer events + velocity tracking and an eased glide (GSAP Draggable + InertiaPlugin, Embla or Swiper with \`freeMode: { momentum: true }\`); snap to slides only if the reference does. Before / after: ${(e.shots || []).map((x) => '\`' + x + '\`').join(', ')}.`);
    for (const m of (a.motion || []).slice(0, 6)) lines.push(`   Motion during the drag: ${(m.targets || []).map((t) => '\`' + t + '\`').join(', ')} ${Array.isArray(m.properties) ? m.properties.join(', ') : m.properties || ''} ${m.duration != null ? m.duration + 's' : ''}`);
  } else if (e.source === 'measured:scene') {
    lines.push(`${n()}. Décor change: between **${a.startScroll}px** and **${a.endScroll}px** of scroll the page background goes from \`${a.from}\` (luminance ${a.lumFrom}) to \`${a.to}\` (luminance ${a.lumTo}) — ${a.mode === 'scrub' ? 'progressively, tied to the scroll' : 'as a timed transition once the point is passed'}; measured on the ${a.via}${a.theme ? ` (theme \`${a.theme.from || 'none'}\` → \`${a.theme.to || 'none'}\`)` : ''}.`);
    lines.push('');
    lines.push('```js');
    if (a.mode === 'scrub') lines.push(`gsap.to('body', { backgroundColor: '${a.to}', ease: 'none', scrollTrigger: { start: ${a.startScroll}, end: ${a.endScroll}, scrub: true } }); // also swap text colours (CSS variables) at the same time`);
    else lines.push(`ScrollTrigger.create({ start: ${a.startScroll}, onEnter: () => document.body.classList.add('is-scene-${String(a.to).slice(1)}'), onLeaveBack: () => document.body.classList.remove('is-scene-${String(a.to).slice(1)}') }); // CSS: body { transition: background-color .8s, color .8s } [duration estimated]`);
    lines.push('```');
    lines.push(`   Drive every colour from CSS variables (--bg, --fg, --accent) so text, borders and the 3D scene switch together. See \`motion/scene.json\` for the whole décor timeline.`);
  } else if (e.source === 'measured:composition' || e.source === 'measured:layout') {
    const L = a;
    const shape = L.layout === 'spiral' ? `a **spiral** of ${L.count} items: radius ${L.radius[0]} → ${L.radius[1]}px, ≈ ${L.angleStep}° between items (${L.turns} turn, ${L.direction})` : L.layout === 'circle' ? `a **circle / orbit** of ${L.count} items, radius ${L.radius}px, ≈ ${L.angleStep}° apart` : L.layout === 'fan' ? `a **fan** of ${L.count} items rotated by ≈ ${L.rotationStep}° each around a shared pivot` : L.layout === 'stack' ? `a **stack / deck** of ${L.count} items almost on top of each other (offsets ${fmt(L.offsets)})` : `a **${L.layout}** of ${L.count} items`;
    lines.push(`${n()}. Composition: \`${(e.targets[0] || {}).selector}\` holds ${shape}; item size ≈ ${L.itemSize}px${L.rotations ? `; item rotations ${fmt(L.rotations)}°` : ''}. Build it from a formula (index → angle / radius / rotation), not from hard-coded positions, so it stays responsive.`);
    lines.push('');
    lines.push('```js');
    if (L.layout === 'spiral') lines.push(`items.forEach((el, i) => { const a = i * ${L.angleStep} * Math.PI / 180, r = ${L.radius[0]} + i * ${Math.round((L.radius[1] - L.radius[0]) / Math.max(1, L.count - 1))}; gsap.set(el, { x: Math.cos(a) * r, y: Math.sin(a) * r, rotation: i * ${L.angleStep} }); });`);
    else if (L.layout === 'circle') lines.push(`items.forEach((el, i) => { const a = i * ${L.angleStep} * Math.PI / 180; gsap.set(el, { x: Math.cos(a) * ${L.radius}, y: Math.sin(a) * ${L.radius} }); });`);
    else if (L.layout === 'fan') lines.push(`items.forEach((el, i) => gsap.set(el, { rotation: (i - (items.length - 1) / 2) * ${L.rotationStep}, transformOrigin: '50% 120%' }));`);
    else lines.push(`// ${L.layout}: place the items as in reference/1440 (see motion/effects card), then animate the group`);
    lines.push('```');
    if ((a.motion || []).length) {
      lines.push(`   Motion of the composition (${e.trigger}):`);
      for (const m of a.motion.slice(0, 8)) lines.push(`   - ${(m.targets || []).map((t) => '\`' + t + '\`').join(', ')}: ${m.id}, ${m.trigger}${m.duration != null ? ', ' + m.duration + 's' : ''}${m.ease ? ', \`' + m.ease + '\`' : ''}${m.scroll ? `, scroll ${m.scroll.startPx}→${m.scroll.endPx}px` : ''} ${m.values ? fmt(m.values) : ''}`);
      if (a.stagger) lines.push(`   Items start ≈ ${a.stagger}s apart.`);
    } else lines.push('   Static composition (no motion measured): the layout itself is the effect.');
  } else if (e.source === 'measured:hover') {
    lines.push(`${n()}. On hover, apply these computed-style changes (before → after):`);
    lines.push('');
    for (const c of (a.changes || []).slice(0, 12)) lines.push(`   - \`${c.sel}\` **${c.prop}**: \`${c.before}\` → \`${c.after}\``);
    if (a.transition) lines.push(`   Transition declared on the element: \`${a.transition}\`.`);
    if (a.sweep) lines.push(`   The pointer was also dragged slowly across it (left → right): motion recorded during that pass is listed in the related hover effects (letter-by-letter / scramble / skew reactions).`);
    if (a.cssRule) lines.push(`   Declared in a CSS \`:hover\` rule (not a link): keep it pure CSS.`);
    if (a.magnetic) lines.push(`   Magnetic: the element moves toward the pointer by ≈ ${a.magnetic.maxShiftPx}px when the pointer is ${a.magnetic.offsetPx}px from its centre (strength ≈ ${a.magnetic.strength}).`);
  }
  if (e.effect_type === 'zoom-through') lines.push(`${n()}. Zoom-through: pin the section, scale the target until it covers the viewport (transform-origin on the point you "enter"), then reveal the next scene inside it (opacity / clip-path swap at the end of the scrub). Keep text crisp: scale a wrapper, not rasterised text.`);
  if (e.effect_type === 'media-expand') lines.push(`${n()}. Media expand: pin the section and animate the frame from its card size to full viewport (clip-path inset or width/height + border-radius → 0) while the image inside counter-scales slightly.`);
  if (e.effect_type === 'image-parallax') lines.push(`${n()}. Keep the media inside an \`overflow: hidden\` frame, oversized enough to never reveal an edge.`);
  if (e.effect_type === 'marquee') lines.push(`${n()}. Duplicate the track content and wrap with a modulo so it never jumps.`);
  lines.push(`${n()}. Respect \`prefers-reduced-motion: reduce\`: ${analysisReduced(analysis)}`);
  return lines.join('\n');
}
function analysisReduced(analysis) {
  return analysis.reducedMotion ? 'the site handles it — mirror its behaviour (show final state).' : 'not handled by the site — add a fallback that shows the final state without motion.';
}

function effectMd(e, analysis) {
  const a = e.animation || {};
  const out = [];
  out.push(`# ${e.id}`);
  out.push('');
  out.push(`**Type:** \`${e.effect_type}\` — ${EFFECT_TYPES[e.effect_type] || ''}  `);
  out.push(`**Section:** \`${e.section}\` · **Trigger:** \`${e.trigger}\` · **Technique:** \`${e.technique}\` · **Source:** \`${e.source}\` · **Confidence:** ${e.confidence}  `);
  out.push(`**Targets:** ${(e.targets || []).slice(0, 8).map((t) => '`' + t.selector + '`').join(', ')}${(e.targets || []).length > 8 ? ` … (+${e.targets.length - 8})` : ''}`);
  out.push('');
  if (e.llm && e.llm.summary) {
    out.push('## What it is');
    out.push('');
    out.push(e.llm.summary);
    out.push('');
  }
  out.push('## Exact values');
  out.push('');
  if (a.duration != null) out.push(`- duration: **${a.duration}s**`);
  if (a.delay) out.push(`- delay: **${a.delay}s**`);
  if (a.ease) out.push(`- ease: \`${a.ease}\`${a.ease_bezier ? ` ≈ \`cubic-bezier(${a.ease_bezier.join(', ')})\`` : ''}`);
  if (a.stagger != null) out.push(`- stagger: ${fmt(a.stagger)}`);
  if (a.from && typeof a.from === 'object') out.push(`- from: ${fmt(a.from)}`);
  if (a.to && typeof a.to === 'object') out.push(`- to: ${fmt(a.to)}`);
  if (e.scrollTrigger) out.push(`- scrollTrigger: ${fmt(e.scrollTrigger)}`);
  if (e.split) out.push(`- split: ${fmt(e.split)}`);
  if (e.measuredCheck) out.push(`- cross-check by the recorder: ${fmt(e.measuredCheck)}`);
  out.push('');
  out.push('## Recipe');
  out.push('');
  out.push(e.llm && e.llm.recipe ? e.llm.recipe : recipe(e, analysis));
  out.push('');
  out.push('## Verification');
  out.push('');
  out.push(`Put \`data-dip-effect="${e.id}"\` on the main target. \`dip-verify\` compares the motion curve with \`motion/curves/${e.id}.json\`${e.reference && e.reference.frames && e.reference.frames.length ? ` and the frames ${e.reference.frames.map((f) => '`' + f + '`').join(', ')}` : ''}.`);
  return out.join('\n');
}

function shaderMd(c, mode) {
  const out = [];
  out.push(`# ${c.id} — ${c.type}`);
  out.push('');
  if (c.material) out.push(`**Three.js material:** \`${c.material}\`${c.shaderName ? ` (\`${c.shaderName}\`)` : ''}${c.instances > 1 ? ` · used by ${c.instances} identical programs` : ''}  `);
  out.push(`**Section:** \`${c.section}\` · **Canvas:** \`${(c.canvas && c.canvas.selector) || 'offscreen'}\` ${c.canvas && c.canvas.rect ? `(${Math.round(c.canvas.rect.w)}×${Math.round(c.canvas.rect.h)} css px, full-bleed: ${c.traits.fullBleed})` : ''}`);
  out.push('');
  if (c.llm && c.llm.summary) {
    out.push('## Principle');
    out.push('');
    out.push(c.llm.summary);
    out.push('');
  }
  out.push('## Inputs');
  out.push('');
  out.push(`- pointer: ${c.inputs.mouse}, time: ${c.inputs.time}, scroll: ${c.inputs.scroll}, textures: ${c.inputs.textures}`);
  out.push(`- traits: ${Object.entries(c.traits).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}`);
  out.push('');
  out.push('## Uniforms (sampled)');
  out.push('');
  out.push('| name | type | driven by | first | last | range |');
  out.push('|---|---|---|---|---|---|');
  for (const u of c.uniforms) out.push(`| ${u.name} | ${u.kind.replace('uniform', '')} | ${u.drivenBy} | ${JSON.stringify(u.first)} | ${JSON.stringify(u.last)} | ${JSON.stringify(u.range)} |`);
  out.push('');
  if (c.textures.length) {
    out.push('## Textures');
    out.push('');
    for (const t of c.textures) out.push(`- ${t.kind} ${t.w}×${t.h}${t.url ? ' — ' + (mode === 'share' ? '(placeholder of same size)' : t.url) : ''}`);
    out.push('');
  }
  out.push('## Shader structure');
  out.push('');
  out.push(shaderOutline(c));
  out.push('');
  out.push(mode === 'study' ? `Full source: \`webgl/${c.id}.glsl\` (study only — re-implement, do not copy into a published deliverable).` : 'Source excluded in share mode: re-implement from this card.');
  return out.join('\n');
}
function shaderOutline(c) {
  const src = (c.userFragment || c.fragment || '') + '\n' + (c.userVertex || c.vertex || '');
  const feats = [];
  const has = (re, label) => re.test(src) && feats.push(label);
  has(/texture2D|texture\(/, 'samples texture(s)');
  has(/snoise|noise|fbm|perlin|simplex/i, 'procedural noise');
  has(/smoothstep/, 'smoothstep thresholds (soft masks / reveals)');
  has(/mix\(/, 'mix() blending between colours/textures');
  has(/distance\(|length\(/, 'radial distance (e.g. circle around the pointer)');
  has(/sin\(|cos\(/, 'trigonometric waves');
  has(/gl_PointSize/, 'point sprites (particles)');
  has(/rgbShift|chromatic|offset\.r|\.r\s*=.*\+/i, 'RGB shift / chromatic aberration');
  has(/uv\s*[+-]=|uv\s*\+=|distort/i, 'UV displacement / distortion');
  has(/position\.z|pos\.z|newPosition/, 'vertex displacement (subdivided plane)');
  has(/fract\(.*sin\(/, 'hash / random');
  const lines = src.split('\n').length;
  return `- ${lines} lines of GLSL\n` + (feats.length ? feats.map((f) => '- ' + f).join('\n') : '- (no known pattern detected)');
}

function sceneMd(s, cards, effects) {
  const o = ['# Three.js scene', ''];
  o.push(`- Three.js r${s.revision || '?'} · ${s.scenes} scene(s) · ${s.objects} objects · **${s.meshes} meshes** (max ${s.maxVertices} vertices)`);
  const r = (s.renderers || [])[0];
  if (r) o.push(`- Renderer: toneMapping ${r.toneMapping}, exposure ${r.toneMappingExposure}, colour space ${r.outputColorSpace}, pixel ratio ${r.pixelRatio}, shadows ${r.shadowMap}`);
  if (s.camera) o.push(`- Camera: ${s.camera.type} fov ${s.camera.fov}, near ${s.camera.near}, far ${s.camera.far}, position ${JSON.stringify(s.camera.position)}`);
  if (s.fog) o.push(`- Fog: ${JSON.stringify(s.fog)}`);
  if (s.background) o.push(`- Background: ${s.background}`);
  o.push(`- Materials: ${Object.entries(s.materials).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  o.push(`- Geometries: ${Object.entries(s.geometries).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
  o.push('');
  o.push('## Lights');
  o.push('');
  for (const l of s.lights) o.push(`- ${l.type} ${l.color || ''} intensity ${l.intensity} at ${JSON.stringify(l.position)}`);
  if (!s.lights.length) o.push('- none');
  o.push('');
  o.push('## Motion (measured over time)');
  o.push('');
  const fx3 = (effects || []).filter((e) => e.source === 'read:three');
  for (const e of fx3) o.push(`- [\`${e.id}\`](../motion/effects/${e.id}.md) — ${e.three.object}: ${e.effect_type}, ${e.trigger} (${e.three.channels.join(', ')})`);
  if (!fx3.length) o.push('- no camera / object motion recorded');
  if ((s.animationClips || []).length) {
    o.push('');
    o.push('## Animation clips (glTF / AnimationMixer)');
    o.push('');
    for (const a of s.animationClips) o.push(`- ${a.object}: ${a.clips.map((c) => `${c.name || 'clip'} ${c.duration}s (${c.tracks} tracks: ${(c.targets || []).join(', ')})`).join('; ')}`);
  }
  if ((s.morphTargets || []).length || s.skinnedMeshes) {
    o.push('');
    o.push(`- Skinned meshes: ${s.skinnedMeshes || 0}; morph targets: ${(s.morphTargets || []).map((m) => `${m.object} (${m.count}${m.names ? ': ' + m.names.join(', ') : ''})`).join('; ') || 'none'}`);
  }
  o.push('');
  o.push('## Post-processing');
  o.push('');
  o.push((s.postprocessing || []).length ? s.postprocessing.map((p) => '- ' + p).join('\n') : '- none detected');
  o.push('');
  o.push('## Custom shaders');
  o.push('');
  for (const c of cards.filter((x) => x.material)) o.push(`- [\`${c.id}\`](${c.id}.md) — ${c.material}${c.shaderName ? ' ' + c.shaderName : ''}: ${c.type}`);
  if (s.models.length) {
    o.push('');
    o.push('## Named meshes (models)');
    o.push('');
    for (const m of s.models) o.push(`- ${m.name}: ${m.geometry} (${m.vertices} vertices), ${m.material}`);
  }
  o.push('');
  o.push('Models and textures are proprietary: rebuild with equivalent primitives or free assets of similar complexity. Full graph: `three-scene.json`.');
  return o.join('\n');
}

// ------------------------------------------------------------------ SPEC.md
function specMd(cap, analysis, effects, stack, mode, refs) {
  const o = [];
  const sec = analysis.sections;
  o.push(`# SPEC — ${cap.meta.title || domainOf(cap.meta.url)}`);
  o.push('');
  o.push(`- **URL:** ${cap.meta.url}`);
  o.push(`- **Captured:** ${cap.meta.date} with DIP ${DIP_VERSION} (${cap.meta.captureMode} mode, ${mode} export)`);
  o.push(`- **Estimated tier:** **${analysis.tier.tier}** — ${analysis.tier.why}`);
  o.push(`- **Complexity:** ${analysis.complexity}/5 · **Effects:** ${effects.length} · **Sections:** ${sec.length}`);
  o.push(`- **Detected stack:** ${analysis.stack.filter((s) => s.confidence >= 0.6).map((s) => `${s.name}${s.version ? '@' + s.version : ''} (${s.confidence})`).join(', ') || 'none'}`);
  o.push(`- **Recommended stack:** ${stack.framework} + ${stack.libraries.map((l) => l.package + '@' + l.version).join(', ') || 'no library'}`);
  o.push('');
  if (analysis.llm && analysis.llm.overview) {
    o.push('## Overview');
    o.push('');
    o.push(analysis.llm.overview);
    o.push('');
  }
  o.push('## Visual overview');
  o.push('');
  if (refs.fullpage) o.push(`![full page](${refs.fullpage})`);
  o.push('');
  o.push('| # | id | height @1440 | background | heading |');
  o.push('|---|---|---|---|---|');
  sec.forEach((s, i) => o.push(`| ${i + 1} | \`${s.id}\` | ${s.height}px | ${s.background} | ${mode === 'share' ? '—' : (s.heading || '').replace(/\|/g, '/')} |`));
  o.push('');
  o.push('## Design system');
  o.push('');
  const c = (cap.tokens && cap.tokens.colors) || {};
  o.push(`- Colours: background \`${c.background}\`, text \`${c.text}\`, accent \`${c.accent || 'none'}\` (contrast text/bg ${c.textOnBgContrast}). Full palette in \`design/tokens.json\`, ready-to-use CSS in \`design/tokens.css\`.`);
  o.push(`- Typography: ${analysis.typography.slice(0, 6).map((r) => `${r.role} = ${r.fontFamily.split(',')[0]} ${r.fontWeight} ${r.fluid ? r.fluid.formula : r.fontSize}`).join(' · ')}. Details in \`design/typography.md\`.`);
  o.push(`- Grid: see \`design/grid.md\`.`);
  o.push('');
  o.push('## Scroll system & intro');
  o.push('');
  const sc = analysis.scroll;
  o.push(`- Scroll: **${sc.type}**${sc.version ? ' ' + sc.version : ''}${sc.options ? ` options ${fmt(sc.options)}` : ''}${sc.feel ? ` — measured: ${sc.feel}` : ''}. See \`motion/scroll-system.json\`.`);
  const intro = analysis.intro || {};
  o.push(`- Intro: stabilised after ${intro.ms != null ? intro.ms + 'ms' : '[unknown]'}${intro.preloader && intro.preloader.length ? `, preloader \`${intro.preloader[0].selector}\`` : ''}. Load-triggered effects: ${effects.filter((e) => e.trigger === 'load').map((e) => '`' + e.id + '`').join(', ') || 'none'} (see \`motion/timeline-intro.json\`).`);
  o.push('');
  o.push('## Section by section');
  o.push('');
  for (const s of sec) {
    o.push(`### ${s.id}`);
    o.push('');
    o.push(`- Root: \`${s.selector}\` (\`<${s.tag}>\`, top ${s.top}px, height ${s.height}px at 1440${s.position !== 'static' ? ', position ' + s.position : ''})`);
    const other = Object.entries(cap.breakpoints || {}).filter(([bp]) => bp !== '1440').map(([bp, d]) => {
      const m = (d.sections || []).find((x) => x.id === s.id) || (d.sections || [])[sec.indexOf(s)];
      return m ? `${bp}: ${m.height}px` : null;
    }).filter(Boolean);
    if (other.length) o.push(`- Responsive heights: ${other.join(' · ')}`);
    for (const bp of Object.keys(refs.sections)) if (refs.sections[bp][s.id]) o.push(`- Reference @${bp}: \`${refs.sections[bp][s.id]}\``);
    const fx = effects.filter((e) => e.section === s.id);
    if (fx.length) {
      o.push('- Effects:');
      for (const e of fx) o.push(`  - [\`${e.id}\`](motion/effects/${e.id}.md) — ${e.effect_type}, ${e.trigger}, ${e.technique}, ${e.source} (${e.confidence})`);
    }
    const wc = analysis.webgl.cards.filter((w) => w.section === s.id);
    for (const w of wc) o.push(`- WebGL: [\`${w.id}\`](webgl/${w.id}.md) — ${w.type}`);
    o.push(`- Content: \`structure/content.md#${s.id}\``);
    o.push('');
  }
  const global = effects.filter((e) => e.section === 'global' || !e.section);
  o.push('## Global interactions');
  o.push('');
  if (global.length) for (const e of global) o.push(`- [\`${e.id}\`](motion/effects/${e.id}.md) — ${e.effect_type} (${e.trigger})`);
  const cur = cap.cursor || {};
  o.push(`- Cursor: ${cur.candidates && cur.candidates.length ? `custom cursor candidate(s) ${cur.candidates.map((x) => '`' + x.selector + '`').join(', ')}` : 'native'} (body cursor: \`${cur.bodyCursor || 'auto'}\`).`);
  const hovers = effects.filter((e) => e.trigger === 'hover');
  o.push(`- Hover states: ${hovers.length} (see effects with trigger \`hover\`).`);
  o.push('');
  o.push('## WebGL');
  o.push('');
  if (analysis.webgl.cards.length || analysis.webgl.three) {
    for (const w of analysis.webgl.cards) o.push(`- [\`${w.id}\`](webgl/${w.id}.md) — ${w.type}, uniforms: ${w.uniforms.map((u) => u.name).join(', ')}`);
    if (analysis.webgl.three) o.push(`- Three.js r${analysis.webgl.three.revision || '?'} scene: [\`webgl/three-scene.md\`](webgl/three-scene.md) (summary) and \`webgl/three-scene.json\` (full graph)`);
    o.push(`- GPU during capture: ${analysis.webgl.gpu || '[unknown]'}`);
  } else o.push('- none');
  o.push('');
  o.push('## Fidelity risks');
  o.push('');
  for (const r of analysis.risks) o.push(`- ${r}`);
  if (!analysis.risks.length) o.push('- none identified');
  o.push('');
  o.push('## Acceptance criteria');
  o.push('');
  o.push('Run `npx dip-verify --pack . --all` against your local build. Target: global score **S ≥ 0.90**, with');
  o.push('S = 0.40·visual + 0.20·layout + 0.30·motion + 0.10·tokens, computed at 1440, 1024 and 390 px.');
  o.push('Sub-score targets: visual ≥ 0.90, layout ≥ 0.92, motion ≥ 0.85, tokens ≥ 0.95. Media areas are masked.');
  return o.join('\n');
}

function buildPlanMd(analysis, effects, stack) {
  const o = [];
  let n = 0;
  const step = (title, body, done) => {
    n++;
    o.push(`## Step ${n} — ${title}`);
    o.push('');
    o.push(body);
    o.push('');
    o.push(`**Done when:** ${done}`);
    o.push('');
  };
  o.push('# BUILD_PLAN');
  o.push('');
  o.push('Follow the steps in order. Each step ends with a verification command.');
  o.push('');
  step('Design DNA', 'Before building, read `.claude/commands/dip-dna.md` and follow it: write `DESIGN_DNA.md` and `dna.json` at the pack root (art direction, composition, typography, colour, 3D, motion personality, copy tone, signature moments). Every later step must stay consistent with it.', '`DESIGN_DNA.md` and `dna.json` exist and only cite measured values.');
  step('Project setup', `Create a ${stack.framework} project. Install: ${stack.libraries.map((l) => '`' + l.package + '@' + l.version + '`').join(', ') || 'no extra library'}. Add \`NOTES.md\`.`, 'the dev server runs and shows an empty page.');
  step('Assets', 'Read `ASSETS.md`. For a clone kept private (study), you may use `assets/files/` and `webgl/geometry/`. For any deliverable, produce originals: images with `dip-assets image` or free stock, 3D objects rebuilt in code or with `dip-assets model`, then `dip-assets optimize`. Keep the same sizes, framing and roles.', 'every image / model slot of `ASSETS.md` has a file (placeholder allowed until the section is built).');
  step('Design tokens & fonts', 'Copy `design/tokens.css` into the global stylesheet. Load the fonts listed in `design/typography.md` (study mode: files in `assets/files/`; otherwise free equivalents). Implement the type scale with the clamp() formulas.', 'body text renders with the right family, size and colour; `npx dip-verify --pack . --tokens` ≥ 0.95.');
  step('Global layout & grid', 'Implement the grid of `design/grid.md` (margins, columns, gutters per breakpoint) and the page wrapper.', 'container widths match at 1440/1024/390.');
  step('Scroll system', `Implement the scroll system described in \`motion/scroll-system.json\` (${analysis.scroll.type}${analysis.scroll.measuredLerp ? `, lerp ${analysis.scroll.measuredLerp}` : ''}${analysis.scroll.options ? ', options ' + JSON.stringify(analysis.scroll.options) : ''}). Wire it to ScrollTrigger if GSAP is used (\`lenis.on('scroll', ScrollTrigger.update)\`).`, 'wheel scrolling feels identical (settle time within ±10%).');
  for (const s of analysis.sections) {
    const fx = effects.filter((e) => e.section === s.id);
    step(`Section ${s.id}`, `Build the static structure and content of \`${s.id}\` from \`structure/dom-1440.json\` and \`structure/content.md\`, add \`data-dip-section="${s.id}"\` on its root. Then implement its effects: ${fx.map((e) => '`' + e.id + '`').join(', ') || 'none'}.`, `\`npx dip-verify --pack . --section ${s.id}\` passes its thresholds.`);
  }
  const global = effects.filter((e) => e.section === 'global');
  if (global.length) step('Global interactions', `Implement ${global.map((e) => '`' + e.id + '`').join(', ')} (cursor, page transitions, menu).`, 'hover and pointer effects match the reference.');
  if (analysis.webgl.cards.length) step('WebGL', `Re-implement the shader cards ${analysis.webgl.cards.map((w) => '`' + w.id + '`').join(', ')} from \`webgl/\` (original code, same uniforms and behaviour).`, 'the canvases react to pointer/time/scroll like the reference frames.');
  step('Responsive', 'Check 1024 and 390 against `reference/1024` and `reference/390` and `structure/dom-1024.json`, `dom-390.json`.', '`npx dip-verify --pack . --all` visual/layout pass at every breakpoint.');
  step('Reduced motion & final check', 'Add `prefers-reduced-motion` fallbacks. Run the full verification and attach `verify-report.md`.', 'global score ≥ 0.90.');
  return o.join('\n');
}

function typographyMd(analysis, cap) {
  const o = ['# Typography', ''];
  o.push('| role | family | weight | size @1440 | fluid formula | line-height | letter-spacing | transform |');
  o.push('|---|---|---|---|---|---|---|---|');
  for (const r of analysis.typography) o.push(`| ${r.role} | ${r.fontFamily} | ${r.fontWeight} | ${r.fontSize} | ${r.fluid ? '`' + r.fluid.formula + '`' : '—'} | ${r.lineHeight} | ${r.letterSpacing} | ${r.textTransform} |`);
  o.push('');
  o.push('Sizes per breakpoint (measured):');
  o.push('');
  for (const r of analysis.typography) o.push(`- ${r.role}: ${(r.sizes || []).map((s) => `${s.viewport}px → ${s.px}px`).join(', ')}`);
  o.push('');
  o.push('## @font-face');
  o.push('');
  for (const f of (cap.tokens && cap.tokens.fontFaces) || []) o.push(`- **${f.family}** weight ${f.weight || 'normal'} ${f.style || ''} display ${f.display || 'auto'}${f.src && f.src.length ? ' — ' + f.src[0].split('/').pop() : ''}`);
  const loaded = (cap.tokens && cap.tokens.fontsLoaded) || [];
  if (loaded.length) {
    o.push('');
    o.push('Loaded font faces: ' + [...new Set(loaded.filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`))].join(', '));
  }
  o.push('');
  o.push('Commercial fonts must not be redistributed: in share mode pick a free equivalent with close metrics (Google Fonts, Fontshare).');
  return o.join('\n');
}

function gridMd(cap) {
  const o = ['# Grid', ''];
  for (const [bp, d] of Object.entries(cap.breakpoints || {})) {
    const g = d.grid;
    if (!g) continue;
    o.push(`## ${bp}px (viewport ${g.viewport}px)`);
    o.push('');
    o.push(`- Outer margin estimate: **${g.marginEstimate != null ? g.marginEstimate + 'px' : '[unknown]'}**`);
    o.push(`- Declared CSS grids (columns → count): ${g.gridColumns.map((x) => `${x.cols} cols ×${x.count}`).join(', ') || 'none'}`);
    o.push(`- Gaps (value → count): ${g.gaps.map((x) => `${x.value} ×${x.count}`).join(', ') || 'none'}`);
    o.push(`- Recurring left edges (px): ${g.leftEdges.map((e) => `${e.x}(${e.count})`).join(', ')}`);
    o.push('');
  }
  return o.join('\n');
}

function tokensCss(tokens) {
  const o = [':root {'];
  for (const [k, v] of Object.entries(tokens.color)) o.push(`  --color-${k}: ${v.$value};`);
  for (const [k, v] of Object.entries(tokens.typography)) {
    o.push(`  --font-${k}-family: ${v.$value.fontFamily};`);
    o.push(`  --font-${k}-size: ${v.$value.fontSize};`);
    o.push(`  --font-${k}-weight: ${v.$value.fontWeight};`);
    o.push(`  --font-${k}-line-height: ${v.$value.lineHeight};`);
    o.push(`  --font-${k}-letter-spacing: ${v.$value.letterSpacing};`);
  }
  for (const [k, v] of Object.entries(tokens.spacing)) o.push(`  --${k}: ${v.$value};`);
  for (const [k, v] of Object.entries(tokens.radius)) o.push(`  --${k}: ${v.$value};`);
  for (const [k, v] of Object.entries(tokens.shadow)) o.push(`  --${k}: ${v.$value};`);
  for (const [k, v] of Object.entries(tokens.duration)) o.push(`  --${k}: ${v.$value};`);
  for (const [k, v] of Object.entries(tokens.easing)) o.push(`  --${k}: ${v.$value};`);
  o.push('  /* site custom properties (as found on :root) */');
  for (const [k, v] of Object.entries((tokens.$extensions && tokens.$extensions.dip && tokens.$extensions.dip.cssVars) || {}).slice(0, 300)) o.push(`  ${k}: ${v};`);
  o.push('}');
  for (const [k, v] of Object.entries(tokens.typography)) {
    o.push(`.type-${k} { font-family: var(--font-${k}-family); font-size: var(--font-${k}-size); font-weight: var(--font-${k}-weight); line-height: var(--font-${k}-line-height); letter-spacing: var(--font-${k}-letter-spacing);${v.$extensions.dip.textTransform && v.$extensions.dip.textTransform !== 'none' ? ` text-transform: ${v.$extensions.dip.textTransform};` : ''} }`);
  }
  return o.join('\n') + '\n';
}

function contentMd(cap, mode) {
  const o = ['# Content (visible text per section)', ''];
  for (const s of cap.content || []) {
    o.push(`## ${s.section}`);
    o.push('');
    for (const b of s.blocks) o.push(`- \`${b.tag}\`: ${mode === 'share' ? lorem(b.text.length) : b.text}`);
    o.push('');
  }
  return o.join('\n');
}

function stripDomText(node) {
  if (!node) return node;
  const n = { ...node };
  if (n.text) n.text = lorem(n.text.length);
  if (n.ariaLabel) n.ariaLabel = lorem(n.ariaLabel.length);
  if (n.src) n.src = '[placeholder]';
  if (n.children) n.children = n.children.map(stripDomText);
  return n;
}

function placeholderSvg(w, h, label) {
  w = Math.max(1, Math.round(w || 800));
  h = Math.max(1, Math.round(h || 600));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#8a8a8a"/><text x="50%" y="50%" fill="#e6e6e6" font-family="sans-serif" font-size="${Math.max(10, Math.min(w, h) / 12)}" text-anchor="middle" dominant-baseline="middle">${w}×${h} ${label || ''}</text></svg>`;
}

// ------------------------------------------------------------------ main
// Asset substitution plan: what every image / video / font / 3D object becomes in a deliverable (spec: nothing
// from the original site ships; the plan tells the agent how to produce an original equivalent).
function geomFile(g, i) {
  return `webgl/geometry/${String(i + 1).padStart(2, '0')}-${(g.name || 'mesh').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.glb`;
}
function assetsMd(cap, analysis, mode) {
  const a = cap.assets || {};
  const secs = analysis.sections || [];
  const o = ['# ASSETS — substitution plan', ''];
  o.push('Nothing from the original site ships in a deliverable. For each asset below: keep the **role, size, framing and mood**, produce an **original** equivalent.');
  o.push('');
  o.push('Tools (pay per use, no subscription — see `dip-assets --help` in the DIP repo):');
  o.push('- Image: `node <DIP>/cli/dip-assets.js image --prompt "<prompt>" --size <W>x<H> --out public/img/<name>.webp` (fal.ai, needs `FAL_KEY`), or a free photo (Unsplash / Pexels).');
  o.push('- 3D model: `node <DIP>/cli/dip-assets.js model --prompt "<prompt>" --out public/models/<name>.glb` (text → image → 3D), or `--image <file>` (image → 3D). Free alternative: TRELLIS.2 on Hugging Face, Poly Haven / Kenney (CC0).');
  o.push('- Optimise every model and image before use: `node <DIP>/cli/dip-assets.js optimize <file>` (glb → draco + webp textures, images → webp).');
  o.push('- Prompts must follow `DESIGN_DNA.md` (palette, light, materials, mood). Never name the original brand or copy its logo.');
  o.push('');

  const imgs = (a.images || []).filter((i) => i.displayed && i.displayed[0] >= 40 && i.displayed[1] >= 40);
  if (imgs.length) {
    o.push('## Images');
    o.push('');
    o.push('| # | Section | Displayed | Natural | Alt / role | Study file | Deliverable |');
    o.push('|---|---|---|---|---|---|---|');
    imgs.slice(0, 80).forEach((img, i) => {
      const role = img.displayed[0] >= 1000 ? 'full-bleed / hero visual' : img.displayed[0] >= 400 ? 'feature visual' : 'thumbnail / icon';
      const file = mode === 'study' ? Object.keys(cap.assetFiles || {}).find((f) => img.url && f.endsWith((img.url.split('?')[0].split('/').pop() || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80))) : null;
      const gen = img.displayed[0] >= 400 ? `generate ${Math.min(2048, img.natural[0] || img.displayed[0] * 2)}×${Math.min(2048, img.natural[1] || img.displayed[1] * 2)} (fal.ai) or stock` : 'stock / SVG icon';
      o.push(`| ${i + 1} | ${sectionFor(secs, img.y) || '—'} | ${img.displayed.join('×')} | ${(img.natural || []).join('×')} | ${mode === 'share' ? '—' : (img.alt || '').replace(/\|/g, '/').slice(0, 50) || role} | ${file ? '`' + file + '`' : '—'} | ${gen}, ${img.objectFit || 'fill'} |`);
    });
    o.push('');
  }
  if ((a.videos || []).length) {
    o.push('## Videos');
    o.push('');
    for (const v of a.videos.slice(0, 20)) o.push(`- ${v.selector || 'video'} ${v.displayed ? v.displayed.join('×') : ''}${v.loop ? ' loop' : ''}${v.autoplay ? ' autoplay' : ''}${v.muted ? ' muted' : ''} → original footage, a stock clip, or a WebGL / CSS equivalent; keep the poster frame.`);
    o.push('');
  }
  if ((a.fonts || []).length) {
    o.push('## Fonts');
    o.push('');
    o.push('Commercial fonts need a licence for a deliverable. Otherwise use the closest free family (Google Fonts / Fontshare) with the same metrics — see `design/typography.md`.');
    o.push('');
    for (const f of a.fonts.slice(0, 20)) o.push(`- ${f.family || ''} ${f.weight || ''} ${f.style || ''} — ${mode === 'share' ? '' : f.url || ''}`);
    o.push('');
  }

  const s = analysis.webgl.sceneSummary;
  const geo = cap.threeGeometry || [];
  if (s || geo.length || (a.models || []).length) {
    o.push('## 3D objects');
    o.push('');
    o.push('Keep the **staging** exactly (camera, framing, light, motion: `webgl/three-scene.md`, `motion/effects/`); replace the **objects** with originals.');
    o.push('');
    const params = new Map(); // identical geometry + material → one line with its instances
    for (const sc of (analysis.webgl.three && analysis.webgl.three.scenes) || [])
      for (const ob of sc.objects || []) {
        if (!ob.geometry || !ob.geometry.parameters || ob.geometry.type === 'BufferGeometry') continue;
        const m = (ob.materials || [])[0];
        const ctor = `new THREE.${ob.geometry.type}(${Object.values(ob.geometry.parameters || {}).map((v) => JSON.stringify(v)).join(', ')})`;
        const key = ctor + (m ? m.type + m.color : '');
        if (!params.has(key)) {
          if (params.size >= 30) continue;
          params.set(key, { ctor, m, names: new Set(), positions: [] });
        }
        const p = params.get(key);
        if (ob.name && !/^(Mesh|Object)/.test(ob.name)) p.names.add(ob.name);
        p.positions.push(ob.position);
      }
    if (params.size) {
      o.push('### Parametric (rebuild exactly in code — no asset needed)');
      o.push('');
      for (const p of params.values()) o.push(`- ${p.names.size ? '`' + [...p.names].join('`, `') + '`: ' : ''}\`${p.ctor}\`, material ${p.m ? p.m.type + ' ' + (p.m.color || '') : '?'}${p.positions.length > 1 ? `, ×${p.positions.length} at ${p.positions.slice(0, 8).map((x) => JSON.stringify(x)).join(' ')}${p.positions.length > 8 ? ' …' : ''}` : `, position ${JSON.stringify(p.positions[0])}`}`);
      o.push('');
    }
    if (geo.length) {
      o.push('### Custom geometry (captured vertex data)');
      o.push('');
      if (mode === 'study') o.push('Study copies in `webgl/geometry/*.glb` (open in Blender or https://gltf-viewer.donmccurdy.com). They are the original site\'s work: **reference only, never ship them**.');
      o.push('');
      o.push('| Object | Vertices | Triangles | Size (x × y × z) | Material | Study file | Deliverable |');
      o.push('|---|---|---|---|---|---|---|');
      geo.forEach((g, i) => {
        const size = g.max.map((mx, k) => +(mx - g.min[k]).toFixed(2)).join(' × ');
        const kind = g.mode === 0 ? 'point cloud → sample points on an original mesh / procedural distribution' : g.vertices < 2000 ? 'simple shape → model it procedurally (extrude / lathe / merge primitives)' : 'model → generate (dip-assets model) or CC0 library, then normalise to the same size';
        o.push(`| ${g.name || g.objectType} | ${g.vertices} | ${Math.round(g.triangles)} | ${size} | ${g.material ? `${g.material.type} ${g.material.color || ''}${g.material.shader ? ' (shader)' : ''}` : '?'} | ${mode === 'study' ? '`' + geomFile(g, i) + '`' : '—'} | ${kind} |`);
      });
      o.push('');
      o.push('Normalise any replacement model to the bounding size above (centre it, scale it) so the camera framing and the motion keyframes stay valid.');
      o.push('');
    }
    if ((a.models || []).length) {
      o.push('### Loaded model files');
      o.push('');
      for (const m of a.models) o.push(`- ${mode === 'share' ? 'model' : m.url} (${m.bytes ? Math.round(m.bytes / 1024) + ' KB' : '?'}${m.draco ? ', Draco' : ''}) → original model of the same role; keep under 2 MB (Draco + webp textures).`);
      o.push('');
    }
  }
  return o.join('\n');
}

/**
 * @param {object} cap raw capture
 * @param {object} analysis output of analyze()
 * @param {object} opts {mode:'study'|'share', selection?: string[] (effect ids), transformImage?: async (bytes)=>bytes, includeRaw?: boolean}
 */
export async function buildPackFiles(cap, analysis, opts) {
  opts = opts || {};
  const mode = opts.mode || 'study';
  const files = [];
  const add = (path, data) => files.push({ path, data });
  const selection = opts.selection ? new Set(opts.selection) : null;
  const effects = analysis.effects.filter((e) => !selection || selection.has(e.id));
  const stack = recommendStack(analysis);
  const shots = cap.screenshots || {};

  // references
  const refs = { sections: {}, fullpage: null };
  for (const [path, b64] of Object.entries(shots)) {
    let bytes = base64ToBytes(b64);
    if (mode === 'share' && opts.transformImage) bytes = await opts.transformImage(bytes, path);
    add(path, bytes);
    const m = /^reference\/(\d+)\/(s\d+[^/_]*)\.png$/.exec(path);
    if (m) {
      refs.sections[m[1]] = refs.sections[m[1]] || {};
      refs.sections[m[1]][m[2]] = path;
    }
    if (/fullpage-1440/.test(path)) refs.fullpage = path;
  }
  // attach reference frames to effects
  for (const e of effects) {
    const frames = Object.keys(shots).filter((p) => p.includes('/' + e.id + '_'));
    const hoverShots = e.shots || [];
    e.reference = { frames: [...frames, ...hoverShots].slice(0, 12), curve: e.curve ? `motion/curves/${e.id}.json` : null };
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generator: `DIP (Design Intelligence Pipeline) ${DIP_VERSION}`,
    analyzerVersion: analysis.analyzerVersion,
    taxonomyVersion: analysis.taxonomyVersion,
    url: cap.meta.url,
    title: mode === 'share' ? null : cap.meta.title,
    date: cap.meta.date,
    captureMode: cap.meta.captureMode,
    mode,
    tier: analysis.tier.tier,
    tierReason: analysis.tier.why,
    complexity: analysis.complexity,
    stack,
    detectedStack: analysis.stack,
    breakpoints: Object.keys(cap.breakpoints || {}).map(Number).sort((a, b) => b - a), // main (widest) first
    sections: analysis.sections.map((s) => s.id),
    effects: effects.map((e) => e.id),
    webgl: analysis.webgl.cards.map((w) => w.id),
    machine: cap.perf && cap.perf.machine ? { ...cap.perf.machine, gpu: analysis.webgl.gpu } : null,
    llm: analysis.llm ? { model: analysis.llm.model, used: true } : { used: false },
  };
  add('manifest.json', J(manifest));
  add('AGENT_RULES.md', agentRules());
  // Claude Code commands (run on the user's Claude subscription): /dip-dna, /dip-transform, /dip-create
  for (const [name, body] of Object.entries(COMMANDS)) add('.claude/commands/' + name, body);
  for (const [name, body] of Object.entries(SKILLS)) add('.claude/skills/' + name, body);
  add('SPEC.md', specMd(cap, analysis, effects, stack, mode, refs));
  add('BUILD_PLAN.md', buildPlanMd(analysis, effects, stack));

  // design
  add('design/tokens.json', J(analysis.tokens));
  add('design/tokens.css', tokensCss(analysis.tokens));
  add('design/typography.md', typographyMd(analysis, cap));
  add('design/grid.md', gridMd(cap));

  // structure
  add('structure/sections.json', J(analysis.sections.map((s) => ({ ...s, heading: mode === 'share' && s.heading ? lorem(s.heading.length) : s.heading, responsive: Object.fromEntries(Object.entries(cap.breakpoints || {}).map(([bp, d]) => [bp, ((d.sections || []).find((x) => x.id === s.id) || {}).height || null])) }))));
  for (const [bp, d] of Object.entries(cap.breakpoints || {})) if (d.dom) add(`structure/dom-${bp}.json`, J(mode === 'share' ? { ...d.dom, tree: stripDomText(d.dom.tree) } : d.dom));
  add('structure/content.md', contentMd(cap, mode));

  // motion
  add('motion/scroll-system.json', J(analysis.scroll));
  if ((analysis.compositions || []).length) add('structure/compositions.json', J({ note: 'Multi-image compositions (layout read from the page at 1440; animated = motion measured on the group).', compositions: analysis.compositions }));
  if (analysis.scene) add('motion/scene.json', J({ note: 'Décor along the scroll at 1440: dominant background per scroll position, section colour rhythm, and animated décor changes (shifts).', ...analysis.scene }));
  const intro = effects.filter((e) => e.trigger === 'load');
  add('motion/timeline-intro.json', J({ stabilizedAfterMs: analysis.intro && analysis.intro.ms, preloader: analysis.intro && analysis.intro.preloader, effects: intro.map((e) => ({ id: e.id, t: e.t, duration: e.animation && e.animation.duration, delay: e.animation && e.animation.delay, targets: (e.targets || []).map((t) => t.selector) })).sort((a, b) => a.t - b.t) }));
  for (const e of effects) {
    const { curve, shots, llm, t, ...card } = e;
    const json = { ...card, preview: (shots || []).slice(-1)[0] || (e.reference && e.reference.frames && e.reference.frames[Math.floor(e.reference.frames.length / 2)]) || null, t_ms: t, reduced_motion: analysis.reducedMotion ? 'handled by the site' : 'not handled by the site: the agent must add a fallback', verify: { anchor: `[data-dip-effect~="${e.id}"]`, metric: e.trigger === 'scroll-scrub' ? 'scroll-curve-rms' : e.trigger === 'hover' ? 'hover-style' : 'motion-rms', threshold: e.confidence < 0.6 ? 0.12 : 0.05 } };
    if (llm) json.description = llm.summary;
    add(`motion/effects/${e.id}.json`, J(json));
    add(`motion/effects/${e.id}.md`, effectMd(e, analysis));
    if (curve) add(`motion/curves/${e.id}.json`, J({ id: e.id, x: e.trigger === 'scroll-scrub' ? 'scroll progress 0..1' : 'time progress 0..1', y: 'value progress 0..1', source: e.curveSource || 'recorder', points: curve }));
  }

  // webgl
  for (const w of analysis.webgl.cards) {
    add(`webgl/${w.id}.md`, shaderMd(w, mode));
    add(`webgl/${w.id}-uniforms.json`, J(w.uniformSamples));
    if (mode === 'study') add(`webgl/${w.id}.glsl`, `// ${w.id} — captured for study only. Do not ship.${w.material ? `\n// Three.js ${w.material}: the prefix Three.js injects (defines, built-in uniforms/attributes) is stripped.` : ''}\n// ===== vertex =====\n${w.userVertex || w.vertex}\n\n// ===== fragment =====\n${w.userFragment || w.fragment}\n`);
  }
  if (analysis.webgl.sceneSummary) add('webgl/three-scene.md', sceneMd(analysis.webgl.sceneSummary, analysis.webgl.cards, effects));
  if (analysis.webgl.three) add('webgl/three-scene.json', J(mode === 'share' ? { ...analysis.webgl.three, scenes: analysis.webgl.three.scenes.map((s) => ({ ...s, objects: s.objects.map((o) => ({ ...o, materials: o.materials && o.materials.map(({ vertexShader, fragmentShader, ...m }) => m) })) })) } : analysis.webgl.three));

  // assets
  const assets = cap.assets || {};
  const assetManifest = {
    mode,
    images: (assets.images || []).map((i) => ({ ...i, url: mode === 'share' ? null : i.url, alt: mode === 'share' ? null : i.alt, replaceable: true })),
    backgrounds: (assets.backgrounds || []).map((b) => ({ ...b, urls: mode === 'share' ? [] : b.urls })),
    videos: (assets.videos || []).map((v) => ({ ...v, url: mode === 'share' ? null : v.url, poster: mode === 'share' ? null : v.poster, replaceable: true })),
    svgs: (assets.svgs || []).map((s) => ({ ...s, markup: mode === 'share' ? null : s.markup })),
    fonts: assets.fonts || [],
    models: assets.models || [],
    lottie: assets.lottie || [],
    rive: assets.rive || [],
    iframes: assets.frames || [],
    totals: assets.totals || {},
    files: Object.keys(cap.assetFiles || {}),
  };
  add('assets/manifest.json', J(assetManifest));
  add('ASSETS.md', assetsMd(cap, analysis, mode));
  if (mode === 'study')
    (cap.threeGeometry || []).forEach((g, i) => {
      try {
        add(geomFile(g, i), geometryToGlb(g));
      } catch (e) {
        /* malformed geometry: skip */
      }
    });
  if (mode === 'study') for (const [p, b64] of Object.entries(cap.assetFiles || {})) add(p, base64ToBytes(b64));
  else (assets.images || []).slice(0, 150).forEach((img, i) => add(`assets/placeholders/img-${String(i + 1).padStart(3, '0')}.svg`, placeholderSvg(img.natural[0] || img.displayed[0], img.natural[1] || img.displayed[1], 'image')));

  // verify config
  const vcfg = {
    schemaVersion: SCHEMA_VERSION,
    url: cap.meta.url,
    breakpoints: manifest.breakpoints.length ? manifest.breakpoints : [1440],
    viewportHeight: 900,
    weights: { visual: 0.4, layout: 0.2, motion: 0.3, tokens: 0.1 },
    thresholds: { global: 0.9, visual: 0.9, layout: 0.92, motion: 0.85, tokens: 0.95 },
    masks: ['img', 'video', 'canvas', 'picture', 'iframe', '[data-dip-media]'],
    sections: analysis.sections.map((s) => ({
      id: s.id,
      anchor: `[data-dip-section="${s.id}"]`,
      reference: Object.fromEntries(Object.entries(refs.sections).map(([bp, m]) => [bp, m[s.id] || null])),
      height: Object.fromEntries(Object.entries(cap.breakpoints || {}).map(([bp, d]) => [bp, ((d.sections || []).find((x) => x.id === s.id) || {}).height || null])),
      top: s.top,
    })),
    effects: effects
      .filter((e) => e.curve || e.trigger === 'hover' || e.trigger === 'time-loop' || ['measured:press', 'measured:toggle', 'measured:click', 'measured:drag', 'measured:scene', 'measured:composition', 'measured:layout', 'read:three'].includes(e.source))
      .map((e) => ({
        id: e.id,
        section: e.section,
        anchor: `[data-dip-effect~="${e.id}"]`,
        trigger: e.trigger,
        effectType: e.effect_type,
        startMs: e.t != null ? Math.round(e.t) : null,
        startScroll: e.startScroll != null ? e.startScroll : null,
        metric: e.source === 'read:three' ? (e.trigger === 'scroll-scrub' ? '3d-scroll-path' : e.trigger === 'time-loop' ? '3d-loop' : e.trigger === 'mouse-move' ? '3d-mouse' : '3d-motion') : e.source === 'measured:press' ? 'press-style' : e.source === 'measured:toggle' ? 'toggle' : e.source === 'measured:click' ? 'click-style' : e.source === 'measured:drag' ? 'drag' : e.source === 'measured:scene' ? 'scene-colors' : e.source === 'measured:composition' || e.source === 'measured:layout' ? 'composition' : e.trigger === 'scroll-scrub' ? 'scroll-curve-rms' : e.trigger === 'hover' ? 'hover-style' : e.trigger === 'time-loop' ? 'loop-speed' : 'motion-rms',
        three: e.source === 'read:three' ? { object: e.three.object, kind: e.three.kind, channels: e.three.channels, mainChannel: e.animation.mainChannel, loop: e.animation.loop, mouse: e.animation.mouse } : undefined,
        pressChanges: e.source === 'measured:press' ? (e.animation.changes || []).slice(0, 12) : undefined,
        toggle: e.source === 'measured:toggle' ? { kind: e.animation.kind, label: e.animation.label } : undefined,
        clickChanges: e.source === 'measured:click' ? (e.animation.during || []).concat(e.animation.persistent || []).slice(0, 12) : undefined,
        drag: e.source === 'measured:drag' ? { dragPx: e.animation.dragPx, followRatio: e.animation.followRatio, travelPx: e.animation.travelPx } : undefined,
        composition: e.effect_type === 'media-choreography' ? { layout: e.animation.layout, count: e.animation.count } : undefined,
        scene: e.source === 'measured:scene' ? { from: e.animation.from, to: e.animation.to, startScroll: e.animation.startScroll, endScroll: e.animation.endScroll, mode: e.animation.mode } : undefined,
        threshold: e.confidence < 0.6 ? 0.12 : 0.05,
        duration: e.animation && typeof e.animation.duration === 'number' ? e.animation.duration : null,
        delay: e.animation && e.animation.delay ? e.animation.delay : 0,
        stagger: e.animation && typeof e.animation.stagger === 'number' ? e.animation.stagger : null,
        channels: (e.animation && e.animation.channels) || null,
        scroll: e.animation && e.animation.scroll ? e.animation.scroll : e.scrollTrigger ? { startPx: e.scrollTrigger.startPx, endPx: e.scrollTrigger.endPx, pxPerScrollPx: e.measuredCheck && e.measuredCheck.pxPerScrollPx } : null,
        loop: e.trigger === 'time-loop' ? e.measuredLoop || (e.animation && e.animation.loop) || null : undefined,
        curve: e.curve ? `motion/curves/${e.id}.json` : null,
        hoverChanges: e.trigger === 'hover' && e.animation && e.animation.changes ? e.animation.changes.slice(0, 12) : undefined,
        frames: e.reference.frames,
        rect: (() => {
          if (e.trigger === 'mouse-move' || /cursor/.test(e.effect_type)) return null;
          const t0 = (e.targets || []).find((t) => t.nid && cap.nidRects && cap.nidRects[t.nid]) || (e.targets || [])[0];
          return (t0 && ((cap.nidRects && cap.nidRects[t0.nid]) || t0.rect)) || null;
        })(),
      })),
    tokens: {
      colors: ((cap.tokens && cap.tokens.colors && cap.tokens.colors.palette) || []).slice(0, 10).map((p) => ({ hex: p.hex, share: p.share, role: p.role })),
      typography: analysis.typography.map((r) => ({ role: r.role, selectors: r.selectors, fontFamily: r.fontFamily, fontWeight: r.fontWeight, fontSize: r.fontSize, lineHeight: r.lineHeight, letterSpacing: r.letterSpacing, sizes: r.sizes })),
      radii: ((cap.tokens && cap.tokens.radii) || []).slice(0, 6).map((r) => r.value),
    },
    scroll: { type: analysis.scroll.type, lerp: analysis.scroll.measuredLerp || null, settleMs: analysis.scroll.impulse ? analysis.scroll.impulse.settleMs : null },
  };
  add('verify/dip.verify.json', J(vcfg));
  add('verify/README.md', verifyReadme());
  add('perf.json', J({ ...(cap.perf || {}), drawCalls: analysis.webgl.drawCalls, gpu: analysis.webgl.gpu }));
  add('raw/scan-log.json', J(cap.log || []));
  if (opts.includeRaw !== false && mode === 'study') {
    const { screenshots, assetFiles, threeGeometry, ...raw } = cap;
    add('raw/capture.json', JSON.stringify(raw));
    add('raw/analysis.json', J({ ...analysis, webgl: { ...analysis.webgl, cards: analysis.webgl.cards.map(({ vertex, fragment, uniformSamples, ...c }) => c) } }));
  }
  return files;
}

function verifyReadme() {
  return `# Verification (dip-verify)

\`dip-verify\` compares your local clone with the references of this pack and prints a report
meant to be read by a coding agent.

\`\`\`bash
# from the pack folder (or pass --pack <path>), with your dev server running
npx dip-verify --pack . --url http://localhost:5173 --section s01-hero
npx dip-verify --pack . --all
\`\`\`

If \`dip-verify\` is not published on npm yet, run it from the DIP repository:
\`node <dip-repo>/cli/dip-verify.js --pack . --all\`.

Contract: sections carry \`data-dip-section\`, effect targets carry \`data-dip-effect\` (see AGENT_RULES.md).
Outputs \`verify-report.md\`, \`verify-report.json\` and diff images in \`verify/diff/\`.
Exit code is non-zero when the global threshold is not met.
`;
}

export async function buildPackZip(cap, analysis, opts) {
  const files = await buildPackFiles(cap, analysis, opts);
  const root = packName(cap);
  return { name: root + '.zip', bytes: await zip(files.map((f) => ({ path: root + '/' + f.path, data: f.data }))), files };
}
