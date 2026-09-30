// DIP analyzer: raw capture -> structured analysis (sections, effects, tokens, scroll, webgl, tier).
// Pure JS, no browser API: runs in the side panel and in Node (dev runner / tests).
import { fitEase, easeFn, bezierFor, normalizeEaseName, sampleEase } from './easing.js';
import { TAXONOMY_VERSION, isKnownType } from './taxonomy.js';

export const ANALYZER_VERSION = '0.2.0';

const GSAP_SPECIAL = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'yoyoEase', 'repeatDelay', 'scrollTrigger', 'paused', 'overwrite', 'immediateRender', 'id', 'callbackScope', 'lazy', 'inherit', 'data', 'runBackwards', 'startAt', 'keyframes', 'defaults', 'smoothChildTiming', 'autoRemoveChildren', 'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'reversed', 'force3D', 'transformOrigin', 'clearProps', 'modifiers', 'snap']);

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

const plausibleStagger = (st) => (st != null && st > 0 && st <= 1.5 ? r3(st) : undefined);

function sectionFor(sections, y) {
  if (y == null || !sections || !sections.length) return sections && sections[0] ? sections[0].id : null;
  let best = sections[0];
  for (const s of sections) if (y >= s.top - 2) best = s;
  return best.id;
}

function phaseAt(marks, t) {
  let p = 'load';
  for (const m of marks || []) if (m.t <= t) p = m.name;
  return p;
}
function phaseKind(p) {
  if (!p) return 'load';
  if (p.startsWith('intro') || p === 'load' || p.startsWith('consent')) return 'load';
  if (p.startsWith('scroll') || p.startsWith('refs')) return 'scroll';
  if (p.startsWith('hover')) return 'hover';
  if (p.startsWith('mouse')) return 'mouse';
  if (p.startsWith('bp')) return 'breakpoint';
  if (p === 'manual') return 'manual';
  if (p.startsWith('press')) return 'press';
  if (p.startsWith('toggle') || p.startsWith('click')) return 'toggle';
  if (p.startsWith('drag')) return 'drag';
  return p;
}

function shapeOfSelector(sel) {
  return String(sel || '')
    .replace(/:nth-of-type\(\d+\)/g, '')
    .replace(/#(?:\\[0-9a-f]+ ?|[\w-])+/gi, '#id')
    .replace(/\.(swiper-slide-(active|next|prev|duplicate)|is-[\w-]+|active|current|selected|visible|inview|in-view)\b/g, '');
}

// ------------------------------------------------------------------ GSAP effects
function propsOf(vars) {
  const o = {};
  if (!vars || typeof vars !== 'object') return o;
  for (const k of Object.keys(vars)) {
    if (GSAP_SPECIAL.has(k) || k.startsWith('on')) continue;
    o[k] = vars[k];
  }
  return o;
}
function easeOf(vars, defaults) {
  const e = (vars && vars.ease) || (defaults && defaults.ease);
  if (e == null) return 'power1.out';
  return typeof e === 'string' ? normalizeEaseName(e) : String(e);
}

const IDENTITY = { x: 0, y: 0, z: 0, xPercent: 0, yPercent: 0, rotation: 0, rotationX: 0, rotationY: 0, rotationZ: 0, rotate: 0, scale: 1, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
// ScrollTrigger pinning issues gsap.to(pin, {x:0, y:0, ... scale:1}) resets: plumbing, not design.
function isTransformReset(vars) {
  if (!vars || vars.duration != null) return false;
  const keys = Object.keys(propsOf(vars));
  return keys.length >= 4 && keys.every((k) => k in IDENTITY && vars[k] === IDENTITY[k]);
}

function gsapEffects(cap, ctx) {
  const g = cap.motion && cap.motion.gsap;
  if (!g || !g.calls || !g.calls.length) return [];
  const sts = g.scrollTriggers || [];
  const stBySel = new Map();
  for (const st of sts) if (st.trigger) stBySel.set(st.trigger, st);
  const timelines = new Map();
  const loose = new Map();
  for (const c of g.calls) {
    if (c.method === 'timeline') {
      timelines.set(c.tl, { vars: c.vars || {}, t: c.t, phase: c.phase, steps: [] });
      continue;
    }
    if (c.method === 'set' || c.method === 'tl.set') continue;
    // internal plumbing (e.g. ScrollTrigger scrub tweens target other animations)
    if (c.targets && c.targets.length && c.targets.every((t) => t.gsapAnimation)) continue;
    if (isTransformReset(c.vars)) continue;
    if (c.tl) {
      if (!timelines.has(c.tl)) timelines.set(c.tl, { vars: {}, t: c.t, phase: c.phase, steps: [] });
      timelines.get(c.tl).steps.push(c);
      continue;
    }
    const v = c.vars || {};
    const key = [c.method, easeOf(v), v.duration, JSON.stringify(Object.keys(propsOf(v)).sort()), !!v.scrollTrigger, v.scrollTrigger && v.scrollTrigger.scrub, phaseKind(c.phase), shapeOfSelector((c.targets[0] || {}).selector)].join('|');
    if (!loose.has(key)) loose.set(key, []);
    loose.get(key).push(c);
  }

  const effects = [];
  const mkTargets = (calls) => {
    const out = [];
    const seen = new Set();
    for (const c of calls) for (const t of c.targets || []) {
      const k = t.nid || t.selector;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out;
  };
  const stInfo = (stVars) => {
    if (!stVars) return null;
    const trigSel = stVars.trigger && (stVars.trigger.selector || (typeof stVars.trigger === 'string' ? stVars.trigger : null));
    const resolved = trigSel ? stBySel.get(trigSel) : null;
    return {
      trigger: trigSel || null,
      triggerNid: (stVars.trigger && stVars.trigger.nid) || (resolved && resolved.triggerNid) || null,
      start: stVars.start != null ? stVars.start : 'top bottom',
      end: stVars.end != null ? stVars.end : 'bottom top',
      scrub: stVars.scrub != null ? stVars.scrub : false,
      pin: stVars.pin ? (stVars.pin === true ? trigSel : stVars.pin.selector || stVars.pin) : null,
      toggleActions: stVars.toggleActions || (stVars.scrub ? null : 'play none none none'),
      snap: stVars.snap || null,
      startPx: resolved ? resolved.start : null,
      endPx: resolved ? resolved.end : null,
    };
  };
  let t0 = 0;
  const triggerOf = (st, vars, phase, t) => {
    t0 = t || 0;
    if (st) return st.scrub ? 'scroll-scrub' : 'scroll-enter';
    if (vars && vars.repeat === -1) return 'time-loop';
    const k = phaseKind(phase);
    if (k === 'manual') return ctx.manualTrigger(t0);
    if (k === 'press') return 'press';
    if (k === 'toggle') return 'click';
    if (k === 'hover') return 'hover';
    if (k === 'mouse') return 'mouse-move';
    if (k === 'scroll') return 'scroll-enter';
    return 'load';
  };
  const animOf = (c, defaults) => {
    const v = c.vars || {};
    const d = defaults || {};
    const ease = easeOf(v, d);
    const a = {
      method: c.method.replace('tl.', ''),
      duration: v.duration != null ? v.duration : d.duration != null ? d.duration : 0.5,
      delay: v.delay || 0,
      ease,
      ease_bezier: bezierFor(ease),
    };
    if (c.method.endsWith('fromTo')) {
      a.from = propsOf(c.fromVars);
      a.to = propsOf(v);
    } else if (c.method.endsWith('from')) {
      a.from = propsOf(v);
      a.to = 'current CSS values';
    } else {
      a.from = 'current CSS values';
      a.to = propsOf(v);
    }
    if (v.stagger != null) a.stagger = v.stagger;
    if (v.repeat) a.repeat = v.repeat;
    if (v.yoyo) a.yoyo = true;
    if (c.position != null) a.position = c.position;
    return a;
  };

  for (const [id, tl] of timelines) {
    if (!tl.steps.length) continue;
    const st = stInfo(tl.vars.scrollTrigger || (tl.steps.find((s) => s.vars && s.vars.scrollTrigger) || {}).vars?.scrollTrigger);
    const targets = mkTargets(tl.steps);
    const steps = tl.steps.map((s) => ({ targets: (s.targets || []).map((t) => t.selector), ...animOf(s, tl.vars.defaults) }));
    effects.push({
      _kind: 'gsap',
      source: 'read:gsap',
      confidence: 0.97,
      technique: st ? 'gsap-scrolltrigger' : 'gsap-timeline',
      trigger: triggerOf(st, tl.vars, tl.phase, tl.t),
      targets,
      scrollTrigger: st,
      animation: { timeline: { repeat: tl.vars.repeat || 0, yoyo: !!tl.vars.yoyo, delay: tl.vars.delay || 0, defaults: tl.vars.defaults || null }, steps, duration: r3(steps.reduce((a, s) => a + (s.duration || 0), 0)) },
      t: tl.t,
      startScroll: tl.steps[0] ? tl.steps[0].s : null,
      gsapId: id,
    });
  }
  for (const [, calls] of loose) {
    const c0 = calls[0];
    const st = stInfo(c0.vars && c0.vars.scrollTrigger);
    const anim = animOf(c0);
    if (calls.length > 1) {
      const starts = calls.map((c) => c.t).sort((a, b) => a - b);
      const diffs = starts.slice(1).map((t, i) => t - starts[i]).filter((d) => d > 5);
      anim.instances = calls.length;
      if (!st && diffs.length && median(diffs) < 400) anim.observedStagger = r3(median(diffs) / 1000);
    }
    effects.push({
      _kind: 'gsap',
      source: 'read:gsap',
      confidence: 0.96,
      technique: st ? 'gsap-scrolltrigger' : 'gsap-tween',
      trigger: triggerOf(st, c0.vars, c0.phase, c0.t),
      targets: mkTargets(calls),
      scrollTrigger: st,
      animation: anim,
      t: c0.t,
      startScroll: c0.s,
    });
  }
  // ScrollTriggers without an animation (toggleClass / callbacks / pins)
  for (const st of sts) {
    if (st.animation) continue;
    if (!st.pin && !st.toggleClass) continue;
    effects.push({
      _kind: 'gsap',
      source: 'read:gsap',
      confidence: 0.95,
      technique: 'gsap-scrolltrigger',
      trigger: st.scrub ? 'scroll-scrub' : 'scroll-enter',
      targets: [{ selector: st.trigger, nid: st.triggerNid }],
      scrollTrigger: { trigger: st.trigger, start: st.startVar, end: st.endVar, startPx: st.start, endPx: st.end, scrub: st.scrub, pin: st.pin, pinSpacing: st.pinSpacing, toggleClass: st.toggleClass, snap: st.snap },
      animation: { note: st.toggleClass ? 'class toggled by ScrollTrigger; see CSS rules for the class' : 'pin only', callbacks: st.callbacks },
      t: 0,
    });
  }
  return effects;
}

// ------------------------------------------------------------------ WAAPI / CSS effects
function waapiEffects(cap, ctx) {
  const w = cap.motion && cap.motion.waapi;
  if (!w) return [];
  // Merge CSS transitions started together on the same element (e.g. opacity + transform).
  const merged = [];
  const byEl = new Map();
  for (const a of w.animations || []) {
    if (!a.target) continue;
    if (a.type !== 'CSSTransition') {
      merged.push(a);
      continue;
    }
    const key = (a.nid || a.target) + '|' + Math.round(a.t / 150);
    let m = byEl.get(key);
    if (!m) {
      m = { ...a, props: [], keyframes: [] };
      byEl.set(key, m);
      merged.push(m);
    }
    const tm = a.timing || {};
    m.props.push({ property: a.name, duration: r3((tm.duration || 0) / 1000), delay: r3((tm.delay || 0) / 1000), easing: tm.easing });
    const kfs = a.keyframes || [];
    kfs.forEach((k, i) => {
      m.keyframes[i] = { ...(m.keyframes[i] || {}), ...k };
    });
    if (/transform|translate|scale/.test(a.name)) m.timing = tm; // transform timing is the reference
  }
  for (const m of merged) if (m.props) m.name = m.props.map((p) => p.property).sort().join(',');
  const groups = new Map();
  for (const a of merged) {
    const tm = a.timing || {};
    const kind = a.type === 'CSSTransition' ? 'css-transition' : a.type === 'CSSAnimation' ? 'css-keyframes' : 'waapi';
    const scrollTl = /ScrollTimeline|ViewTimeline/.test(a.timeline || '');
    const key = [kind, a.name, tm.duration, tm.easing, scrollTl, shapeOfSelector(a.target)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const effects = [];
  for (const [, list] of groups) {
    const a = list[0];
    const tm = a.timing || {};
    const kind = a.type === 'CSSTransition' ? 'css-transition' : a.type === 'CSSAnimation' ? 'css-keyframes' : 'waapi';
    const scrollTl = /ScrollTimeline|ViewTimeline/.test(a.timeline || '');
    const phase = phaseKind(phaseAt(ctx.marks, a.t));
    let trigger = scrollTl ? 'scroll-scrub' : tm.iterations === 'Infinity' || tm.iterations === Infinity || tm.iterations > 50 ? 'time-loop' : phase === 'manual' ? ctx.manualTrigger(a.t) : phase === 'press' ? 'press' : phase === 'toggle' ? 'click' : phase === 'drag' ? 'drag' : phase === 'hover' ? 'hover' : phase === 'scroll' ? 'scroll-enter' : 'load';
    let ease = tm.easing || 'linear';
    // CSS animations carry animation-timing-function on each keyframe
    const kfEase = (a.keyframes || []).map((k) => k.easing).find((e) => e && e !== 'linear');
    if (ease === 'linear' && kfEase && kind === 'css-keyframes') ease = kfEase;
    const keyframes = (a.keyframes || []).map((k) => {
      const o = {};
      for (const p in k) if (!['composite', 'computedOffset'].includes(p)) o[p] = k[p];
      return o;
    });
    const distinct = [...new Map(list.map((x) => [x.nid || x.target, x])).values()];
    const starts = distinct.map((x) => x.t).sort((x, y) => x - y);
    const delays = distinct.map((x) => (x.timing || {}).delay || 0).sort((x, y) => x - y);
    const staggerFromDelay = delays.length > 1 ? median(delays.slice(1).map((d, i) => d - delays[i]).filter((d) => d > 0)) : null;
    effects.push({
      _kind: 'waapi',
      source: 'read:waapi',
      confidence: 0.95,
      technique: scrollTl ? 'css-scroll-timeline' : kind === 'waapi' && ctx.stackNames.has('framer-motion') ? 'framer-motion' : kind,
      trigger,
      targets: dedupeTargets(list.map((x) => ({ selector: x.target, nid: x.nid }))),
      animation: {
        name: a.name,
        keyframes,
        duration: typeof tm.duration === 'number' ? r3(tm.duration / 1000) : tm.duration,
        delay: r3((tm.delay || 0) / 1000),
        iterations: tm.iterations,
        direction: tm.direction,
        fill: tm.fill,
        ease,
        ease_bezier: bezierFor(ease),
        // a "stagger" of seconds is the same animation replayed later (new element, route, re-entry), not a stagger
        stagger: plausibleStagger(staggerFromDelay ? staggerFromDelay / 1000 : distinct.length > 1 ? median(starts.slice(1).map((t, i) => t - starts[i])) / 1000 : null),
        timeline: scrollTl ? a.timeline : undefined,
        rangeStart: a.rangeStart,
        rangeEnd: a.rangeEnd,
        pseudo: a.pseudo || undefined,
        properties: a.props || undefined,
      },
      t: a.t,
      startScroll: a.s,
    });
  }
  return effects;
}

function dedupeTargets(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const k = t.nid || t.selector;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, 60);
}

// ------------------------------------------------------------------ recorder (measured) effects
const CHANNELS = [
  ['ty', 2, 'y'],
  ['tx', 2, 'x'],
  ['op', 0.02, 'opacity'],
  ['sx', 0.01, 'scale'],
  ['rot', 0.5, 'rotate'],
  ['tz', 2, 'z'],
];

function pearson(a, b) {
  const n = a.length;
  if (n < 3) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function activeChannels(tk) {
  const out = [];
  for (const [ch, thr, name] of CHANNELS) {
    const v = tk[ch];
    if (!v || !v.length) continue;
    let mn = Infinity, mx = -Infinity;
    for (const x of v) {
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    if (mx - mn > thr) out.push({ ch, name, range: mx - mn, min: mn, max: mx });
  }
  // colour / radius / letter-spacing / variable font / SVG stroke animations
  const extraProps = new Map();
  for (const [, p, v] of tk.extra || []) {
    if (!extraProps.has(p)) extraProps.set(p, new Set());
    extraProps.get(p).add(v);
  }
  for (const [p, vals] of extraProps) if (vals.size > 1) out.push({ ch: 'extra:' + p, name: p, range: 0.5 });
  if (tk.clip && tk.clip.length > 1) out.push({ ch: 'clip', name: 'clipPath', range: 1 });
  if (tk.filter && tk.filter.length > 1) out.push({ ch: 'filter', name: 'filter', range: 1 });
  return out.sort((a, b) => b.range - a.range);
}

function segmentsOf(tk, ch, gapMs) {
  const t = tk.t, v = tk[ch];
  const segs = [];
  let cur = null;
  for (let i = 1; i < t.length; i++) {
    if (v[i] === v[i - 1]) continue;
    if (cur && t[i] - t[cur.end] <= gapMs) cur.end = i;
    else {
      if (cur) segs.push(cur);
      cur = { start: i - 1, end: i };
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

function classifyDriver(tk, main, ctx) {
  const n = tk.t.length;
  const v = tk[main.ch];
  if (!v) return { driver: 'unknown' };
  let changes = 0, withScroll = 0, withMouse = 0;
  for (let i = 1; i < n; i++) {
    if (v[i] === v[i - 1]) continue;
    changes++;
    if (tk.s[i] !== tk.s[i - 1]) withScroll++;
    if (tk.mx[i] !== tk.mx[i - 1] || tk.my[i] !== tk.my[i - 1]) withMouse++;
  }
  const scrollRatio = changes ? withScroll / changes : 0;
  const mouseRatio = changes ? withMouse / changes : 0;
  const corrS = Math.abs(pearson(tk.s, v));
  let corrMx = Math.abs(pearson(tk.mx, v));
  let corrMy = Math.abs(pearson(tk.my, v));
  // lerped followers lag behind fast pointer sweeps: compare with a smoothed pointer too
  if (Math.max(corrMx, corrMy) > 0.4 && Math.max(corrMx, corrMy) < 0.75) {
    for (const tau of [80, 160, 320, 640]) {
      const sm = (m) => {
        const o = [m[0]];
        for (let i = 1; i < m.length; i++) o.push(o[i - 1] + (1 - Math.exp(-Math.max(0, tk.t[i] - tk.t[i - 1]) / tau)) * (m[i] - o[i - 1]));
        return o;
      };
      corrMx = Math.max(corrMx, Math.abs(pearson(sm(tk.mx), v)));
      corrMy = Math.max(corrMy, Math.abs(pearson(sm(tk.my), v)));
    }
  }
  const isFixed = tk.position === 'fixed';
  if (isFixed && (corrMx > 0.9 || corrMy > 0.9) && mouseRatio > 0.6) return { driver: 'mouse', follow: true, corrMx: r2(corrMx), corrMy: r2(corrMy) };
  // loop: keeps changing across phases without scroll or mouse
  const segs = segmentsOf(tk, main.ch, 150);
  const longest = segs.reduce((a, s) => Math.max(a, tk.t[s.end] - tk.t[s.start]), 0);
  // pointer followers (often lerped: they keep settling between pointer events, so the change ratio is low)
  const pointerMoves = new Set(tk.mx.map((x, i) => x + ',' + tk.my[i])).size;
  if ((corrMx > 0.75 || corrMy > 0.75) && pointerMoves > 10 && changes > 8) return { driver: 'mouse', corrMx: r2(corrMx), corrMy: r2(corrMy) };
  if (longest > 4000 && scrollRatio < 0.7 && mouseRatio < 0.7) return { driver: 'loop', longest };
  if (scrollRatio > 0.8 && corrS > 0.6 && changes > 8) return { driver: 'scroll', corr: r2(corrS) };
  if (mouseRatio > 0.8 && (corrMx > 0.6 || corrMy > 0.6) && changes > 8) return { driver: 'mouse', corrMx: r2(corrMx), corrMy: r2(corrMy) };
  return { driver: 'time', segments: segs.length };
}

function normalize(xs, ys) {
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const y0 = ys[0], y1 = ys[ys.length - 1];
  const dx = x1 - x0 || 1, dy = y1 - y0 || 1;
  return { x: xs.map((x) => (x - x0) / dx), y: ys.map((y) => (y - y0) / dy) };
}

function measureTrack(tk, ctx) {
  ctx = ctx || {};
  const chans = activeChannels(tk);
  if (!chans.length) return null;
  const numeric = (c) => c.ch !== 'clip' && c.ch !== 'filter' && !c.ch.startsWith('extra:');
  const main = chans.find(numeric) || chans[0];
  const drv = classifyDriver(tk, main, ctx);
  const m = { nid: tk.nid, selector: tk.sel, tag: tk.tag, text: tk.text, rect0: tk.rect0, parentNid: tk.parentNid, parentSel: tk.parentSel, index: tk.index, isMedia: tk.isMedia, position: tk.position, channels: chans.map((c) => c.name), driver: drv.driver, driverInfo: drv };
  if (main.ch.startsWith('extra:')) {
    const prop = main.name;
    const list = (tk.extra || []).filter((x) => x[1] === prop);
    m.values = {};
    for (const c of chans.filter((c) => c.ch.startsWith('extra:'))) {
      const l = (tk.extra || []).filter((x) => x[1] === c.name);
      m.values[c.name] = { from: l[0][2], to: l[l.length - 1][2] };
    }
    m.start = tk.t[list[0][0]] || tk.t[0];
    m.duration = r3(((tk.t[list[list.length - 1][0]] || m.start) - m.start) / 1000);
    m.phase = phaseKind(phaseAt(ctx.marks, m.start));
    m.driver = 'time';
    return m;
  }
  if (main.ch === 'clip' || main.ch === 'filter') {
    const list = tk[main.ch];
    m.values = { [main.name]: { from: list[0][1], to: list[list.length - 1][1] } };
    const i0 = list[0][0], i1 = list[list.length - 1][0];
    m.start = tk.t[i0];
    m.duration = r3((tk.t[i1] - tk.t[i0]) / 1000);
    m.phase = phaseKind(phaseAt(ctx.marks, m.start));
    return m;
  }
  if (drv.driver === 'time') {
    const segs = segmentsOf(tk, main.ch, 150).filter((s) => s.end - s.start >= 3);
    if (!segs.length) return null;
    // capture: first occurrence (intro order); verify: the largest move (ignores tiny initial writes)
    const seg = ctx.segmentPick === 'largest' ? segs.slice().sort((a, b) => Math.abs(tk[main.ch][b.end] - tk[main.ch][b.start]) - Math.abs(tk[main.ch][a.end] - tk[main.ch][a.start]))[0] : segs[0];
    const ts = tk.t.slice(seg.start, seg.end + 1);
    const vs = tk[main.ch].slice(seg.start, seg.end + 1);
    // The sample before the first change may be stale (value held for a while): the motion really
    // started about one frame before the first changed sample.
    if (ts.length > 2 && ts[1] - ts[0] > 34) ts[0] = ts[1] - 16.7;
    const nrm = normalize(ts, vs);
    const fit = fitEase(nrm.x, nrm.y);
    m.start = ts[0];
    m.startScroll = tk.s[seg.start];
    m.duration = r3((ts[ts.length - 1] - ts[0]) / 1000);
    m.phase = phaseKind(phaseAt(ctx.marks, ts[0]));
    m.fit = fit;
    m.values = {};
    for (const c of chans) {
      if (c.ch === 'clip' || c.ch === 'filter') {
        const l = tk[c.ch];
        m.values[c.name] = { from: l[0][1], to: l[l.length - 1][1] };
        continue;
      }
      if (c.ch.startsWith('extra:')) {
        const l = (tk.extra || []).filter((x) => x[1] === c.name);
        m.values[c.name] = { from: l[0][2], to: l[l.length - 1][2] };
        continue;
      }
      m.values[c.name] = { from: tk[c.ch][seg.start], to: tk[c.ch][seg.end] };
    }
    m.curve = nrm.x.map((x, i) => [r3(x), r3(nrm.y[i])]);
    m.occurrences = segs.length;
  } else if (drv.driver === 'scroll') {
    // value = f(scroll). Keep monotonic scroll-forward samples.
    const pts = [];
    let lastS = -Infinity;
    for (let i = 0; i < tk.t.length; i++) {
      if (tk.s[i] > lastS) {
        pts.push([tk.s[i], tk[main.ch][i]]);
        lastS = tk.s[i];
      }
    }
    if (pts.length < 4) return null;
    // active range where the value changes
    let i0 = 0, i1 = pts.length - 1;
    while (i0 < i1 && pts[i0 + 1][1] === pts[0][1]) i0++;
    while (i1 > i0 && pts[i1 - 1][1] === pts[pts.length - 1][1]) i1--;
    const act = pts.slice(i0, i1 + 1);
    const nrm = normalize(act.map((p) => p[0]), act.map((p) => p[1]));
    m.scrollStart = act[0][0];
    m.scrollEnd = act[act.length - 1][0];
    m.fit = act.length > 4 ? fitEase(nrm.x, nrm.y) : null;
    m.values = {};
    for (const c of chans) {
      if (c.ch === 'clip' || c.ch === 'filter' || c.ch.startsWith('extra:')) continue;
      m.values[c.name] = { atStart: c.ch === main.ch ? act[0][1] : null, atEnd: c.ch === main.ch ? act[act.length - 1][1] : null, min: c.min, max: c.max };
    }
    m.ratio = r3((act[act.length - 1][1] - act[0][1]) / Math.max(1, act[act.length - 1][0] - act[0][0])); // px of motion per px of scroll
    m.curve = nrm.x.map((x, i) => [r3(x), r3(nrm.y[i])]);
    m.phase = 'scroll';
  } else if (drv.driver === 'mouse') {
    const v = tk[main.ch];
    const useX = (drv.corrMx || 0) >= (drv.corrMy || 0);
    const ms = useX ? tk.mx : tk.my;
    // linear regression value = a + b*mouse
    const n = v.length;
    let mm = 0, mv = 0;
    for (let i = 0; i < n; i++) {
      mm += ms[i];
      mv += v[i];
    }
    mm /= n;
    mv /= n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (ms[i] - mm) * (v[i] - mv);
      den += (ms[i] - mm) ** 2;
    }
    m.mouse = { axis: useX ? 'x' : 'y', channel: main.name, gain: den ? r3(num / den) : null };
    if (drv.follow) {
      // estimate lerp: compare lag between mouse and value
      let lagSum = 0, cnt = 0;
      for (let i = 1; i < n; i++) {
        const target = ms[i];
        const prevGap = target - v[i - 1];
        const moved = v[i] - v[i - 1];
        if (Math.abs(prevGap) > 5) {
          lagSum += moved / prevGap;
          cnt++;
        }
      }
      m.mouse.lerp = cnt ? r3(lagSum / cnt) : null;
    }
    m.values = {};
    for (const c of chans) if (c.ch !== 'clip' && c.ch !== 'filter' && !c.ch.startsWith('extra:')) m.values[c.name] = { min: c.min, max: c.max };
    m.phase = 'mouse';
  } else if (drv.driver === 'loop') {
    const v = tk[main.ch];
    const t = tk.t;
    // median instantaneous speed (robust to the wrap-around jumps of a looping track)
    const speeds = [];
    for (let i = 1; i < v.length; i++) {
      const dt = t[i] - t[i - 1];
      if (dt > 0 && dt < 100) speeds.push((v[i] - v[i - 1]) / dt);
    }
    const speed = median(speeds.filter((s) => Math.abs(s) < 5)) || 0;
    m.loop = { channel: main.name, speedPxPerS: r2(speed * 1000), min: main.min, max: main.max };
    m.values = {};
    for (const c of chans) if (c.ch !== 'clip' && c.ch !== 'filter' && !c.ch.startsWith('extra:')) m.values[c.name] = { min: c.min, max: c.max };
    m.phase = 'loop';
  }
  return m;
}

function recorderEffects(cap, ctx, explainedNids) {
  const rec = cap.motion && cap.motion.recorder;
  if (!rec) return { effects: [], measured: [] };
  const measured = [];
  for (const tk of rec.tracks || []) {
    if (explainedNids.has(tk.nid)) continue;
    // ignore the smooth-scroll wrapper (translates exactly with scroll)
    if (tk.ty && tk.ty.length > 5) {
      const c = pearson(tk.s, tk.ty);
      const slope = (tk.ty[tk.ty.length - 1] - tk.ty[0]) / ((tk.s[tk.s.length - 1] - tk.s[0]) || 1);
      if (c < -0.98 && Math.abs(slope + 1) < 0.05 && (tk.rect0 && tk.rect0.h > 2000)) {
        ctx.scrollWrapper = tk.sel;
        continue;
      }
    }
    try {
      const m = measureTrack(tk, ctx);
      if (m) measured.push(m);
    } catch (e) {
      ctx.log.push('measure failed for ' + tk.sel + ': ' + e.message);
    }
  }
  // group
  const groups = new Map();
  for (const m of measured) {
    const sec = sectionFor(ctx.sections, m.rect0 && m.rect0.y);
    m.section = sec;
    const startBucket = m.driver === 'time' ? Math.floor((m.start || 0) / 1500) : 0;
    const key = [sec, m.driver, m.phase, m.channels.join(','), m.parentNid && m.driver === 'time' ? 'p' : shapeOfSelector(m.selector), m.driver === 'time' ? startBucket : '', m.driver === 'time' ? Math.round((m.duration || 0) * 5) : ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const effects = [];
  for (const [, list] of groups) {
    list.sort((a, b) => (a.start || 0) - (b.start || 0));
    const m0 = list[0];
    const trigger = m0.phase === 'drag' ? 'drag' : m0.driver === 'scroll' ? 'scroll-scrub' : m0.driver === 'mouse' ? 'mouse-move' : m0.driver === 'loop' ? 'time-loop' : m0.phase === 'manual' ? ctx.manualTrigger(m0.start) : m0.phase === 'press' ? 'press' : m0.phase === 'toggle' ? 'click' : m0.phase === 'drag' ? 'drag' : m0.phase === 'hover' ? 'hover' : m0.phase === 'scroll' ? 'scroll-enter' : 'load';
    const anim = { channels: m0.channels, values: m0.values };
    if (m0.driver === 'time') {
      anim.duration = r3(median(list.map((x) => x.duration)));
      anim.ease = m0.fit ? m0.fit.best : null;
      anim.ease_named_nearest = m0.fit ? m0.fit.named : null;
      anim.ease_bezier = m0.fit ? m0.fit.bezier : null;
      anim.fit_rms = m0.fit ? m0.fit.rms : null;
      if (list.length > 1) {
        const diffs = list.slice(1).map((x, i) => x.start - list[i].start).filter((d) => d >= 0);
        const st = median(diffs);
        if (st != null && st < 600) anim.stagger = r3(st / 1000);
      }
    } else if (m0.driver === 'scroll') {
      anim.scroll = { startPx: m0.scrollStart, endPx: m0.scrollEnd, pxPerScrollPx: m0.ratio };
      anim.ease = m0.fit ? m0.fit.best : 'none';
      anim.fit_rms = m0.fit ? m0.fit.rms : null;
    } else if (m0.driver === 'mouse') anim.mouse = m0.mouse;
    else if (m0.driver === 'loop') anim.loop = m0.loop;
    const fitPenalty = m0.fit ? Math.min(0.3, m0.fit.rms * 3) : 0.1;
    effects.push({
      _kind: 'recorder',
      source: 'measured:recorder',
      confidence: r2(Math.max(0.35, 0.8 - fitPenalty - (list.length === 1 && m0.driver === 'time' && m0.duration < 0.08 ? 0.3 : 0))),
      technique: ctx.stackNames.has('gsap') ? 'gsap-tween' : 'js-inline-style',
      trigger,
      targets: dedupeTargets(list.map((x) => ({ selector: x.selector, nid: x.nid }))),
      animation: anim,
      measured: list.slice(0, 12).map((x) => ({ selector: x.selector, start: x.start, duration: x.duration, values: x.values })),
      curve: m0.curve,
      t: m0.start || 0,
      startScroll: m0.startScroll != null ? m0.startScroll : null,
      _m: list,
    });
  }
  return { effects, measured };
}

// ------------------------------------------------------------------ hover effects
function hoverEffects(cap, ctx) {
  const out = [];
  const groups = new Map();
  for (const h of cap.hovers || []) {
    if (!h.diff || !h.diff.length) continue;
    const key = shapeOfSelector(h.target.selector) + '|' + h.diff.map((d) => d.prop).sort().join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }
  for (const [, list] of groups) {
    const h = list[0];
    const props = [...new Set(h.diff.map((d) => d.prop))];
    let type = 'hover-state';
    if (h.magnetic) type = 'magnetic-element';
    out.push({
      _kind: 'hover',
      source: 'measured:hover',
      confidence: 0.85,
      technique: h.transition && h.transition !== 'all 0s ease 0s' ? 'css-transition' : 'js-inline-style',
      trigger: 'hover',
      effect_type: type,
      targets: dedupeTargets(list.map((x) => x.target)),
      animation: { changes: h.diff.slice(0, 20), transition: h.transition, props, magnetic: h.magnetic || undefined, sweep: h.sweep || undefined, cssRule: h.why === 'css' || undefined },
      shots: h.shots,
      t: h.t || 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ classification
function classify(e, ctx) {
  if (e.effect_type && isKnownType(e.effect_type)) return e.effect_type;
  const targets = e.targets || [];
  const tNids = new Set(targets.map((t) => t.nid).filter(Boolean));
  const tSels = targets.map((t) => t.selector || '').join(' ');
  const split = ctx.splits.find((s) => targets.some((t) => (t.nid && (s.units || []).includes(t.nid)) || t.nid === s.nid) || (s.selector && tSels.includes(s.selector)));
  const a = e.animation || {};
  let propsStr = JSON.stringify([a.to, a.from, a.steps, a.keyframes, a.values, a.changes]).toLowerCase();
  // computed transforms: matrix(a, b, c, d, tx, ty) -> expose translate axes to the rules below
  for (const m of propsStr.matchAll(/matrix\(([^)]+)\)/g)) {
    const p = m[1].split(',').map(parseFloat);
    if (p.length === 6) {
      if (Math.abs(p[5]) > 0.5) propsStr += ' "y"';
      if (Math.abs(p[4]) > 0.5) propsStr += ' "x"';
      if (Math.abs(p[0] - 1) > 0.01 && Math.abs(p[1]) < 0.01) propsStr += ' scale';
    }
  }
  const st = e.scrollTrigger;
  if (st && st.pin) {
    if (/xpercent|"x"|translatex|"x":/.test(propsStr) && e.trigger === 'scroll-scrub') return 'horizontal-scroll-section';
    return 'pinned-sequence';
  }
  if (/drawsvg|strokedashoffset|stroke-dashoffset/.test(propsStr)) return 'svg-path-draw';
  if (/morphsvg/.test(propsStr)) return 'morph-svg';
  if (/scrambletext/.test(propsStr)) return 'text-scramble';
  if (split && e.trigger !== 'hover' && e.trigger !== 'time-loop') return split.type === 'chars' ? 'text-reveal-chars' : split.type === 'words' ? 'text-reveal-words' : 'text-reveal-lines';
  if (/\.(lines?|words?|chars?|split[\w-]*)\b/.test(tSels) && /ypercent|"y"|translatey|opacity/.test(propsStr) && e.trigger !== 'hover' && e.trigger !== 'time-loop') {
    return /\.chars?\b/.test(tSels) ? 'text-reveal-chars' : /\.words?\b/.test(tSels) ? 'text-reveal-words' : 'text-reveal-lines';
  }
  const m = e._m && e._m[0];
  const media = (m && m.isMedia) || /img|video|picture|figure|media|image/.test(tSels);
  if (e.trigger === 'time-loop' && (a.loop ? a.loop.channel === 'x' && Math.abs(a.loop.max - a.loop.min) > 100 : /xpercent|translatex|"x":/.test(propsStr))) return 'marquee';
  if (e.trigger === 'mouse-move') {
    if (m && m.driverInfo && m.driverInfo.follow) return media ? 'cursor-follower-media' : 'custom-cursor';
    if (a.channels && a.channels.includes('rotate')) return 'tilt-3d';
    return 'mouse-parallax';
  }
  if (e.trigger === 'scroll-scrub' || e.trigger === 'scroll-enter') {
    // growth: an element scaled until it (nearly) fills the viewport
    const nums = [];
    const sv = a.values && a.values.scale;
    if (sv) for (const k of ['from', 'to', 'min', 'max', 'atStart', 'atEnd']) if (typeof sv[k] === 'number') nums.push(sv[k]);
    for (const o of [a.to, a.from]) if (o && typeof o.scale === 'number') nums.push(o.scale);
    if (nums.length >= 2) {
      const lo = Math.min(...nums), hi = Math.max(...nums);
      const r0 = (m && m.rect0) || (targets[0] && targets[0].rect);
      const fills = r0 && r0.w && r0.w * (hi / Math.max(lo, 0.01)) >= ctx.vw * 0.9;
      if (hi >= 2.5 || (hi / Math.max(lo, 0.01) >= 1.8 && fills && !media)) return 'zoom-through';
      if (media && hi / Math.max(lo, 0.01) >= 1.25 && fills) return 'media-expand';
    }
    if (media && e.trigger === 'scroll-scrub' && /inset\(|clip-?path|clippath/.test(propsStr) && /inset\(0(px|%)?\)|inset\(0(px|%)? 0(px|%)?|none/.test(propsStr)) return 'media-expand';
  }
  if (/clip-?path|clippath|inset\(|polygon\(/.test(propsStr)) return media ? 'image-reveal-clip' : 'image-reveal-clip';
  if (e.trigger === 'scroll-scrub') {
    if (a.channels && a.channels[0] === 'x' && a.values && a.values.x && Math.abs(a.values.x.max - a.values.x.min) > ctx.vw * 0.6) return 'horizontal-scroll-section';
    if (media || /ypercent|"y"|scale/.test(propsStr)) return 'image-parallax';
  }
  if (e.trigger === 'load' && targets.some((t) => ctx.preloaderSels.has(t.selector))) return 'preloader';
  if ((e.trigger === 'scroll-enter' || e.trigger === 'load') && /opacity|autoalpha/.test(propsStr) && /"y"|ypercent|translatey|"y":/.test(propsStr)) return 'fade-up-reveal';
  if ((e.trigger === 'scroll-enter' || e.trigger === 'load') && /scale/.test(propsStr)) return media ? 'image-reveal-clip' : 'scale-reveal';
  if (a.channels && a.channels.includes('y') && a.channels.includes('opacity')) return 'fade-up-reveal';
  if (e.trigger === 'hover') return 'hover-state';
  if (e.trigger === 'route-change') return 'page-transition';
  return 'other';
}

// ------------------------------------------------------------------ scene / décor changes along the scroll
const hexRgb = (h) => (h && /^#[0-9a-f]{6}$/i.test(h) ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : null);
const cssHex = (c) => {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(c || '');
  return m ? '#' + [m[1], m[2], m[3]].map((v) => Math.round(+v).toString(16).padStart(2, '0')).join('') : c;
};
function rgbDist(a, b) {
  const x = hexRgb(a), y = hexRgb(b);
  if (!x || !y) return a === b ? 0 : 999;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
// Samples come from the scroll pass (sceneSample): dominant viewport background, body/html background,
// theme classes. A décor change is animated when the root background or the theme changes, or when the
// colour passes through intermediate values (scrubbed or transitioned); a plain boundary between two
// sections of different colours is part of the page rhythm, not an effect.
function analyzeScene(cap, ctx, vh) {
  const raw = (cap.scene || []).filter((x) => x && x.bg);
  const out = { timeline: [], shifts: [], rhythm: [] };
  if (raw.length < 3) return out;
  const pts = [];
  let last = -1;
  for (const x of raw) if (x.s >= last) (pts.push(x), (last = x.s));
  let prev = null;
  pts.forEach((x, i) => {
    if (!prev || x.bg !== prev.bg || x.root !== prev.root || x.theme !== prev.theme || i % 6 === 0) out.timeline.push({ s: x.s, bg: x.bg, root: x.root, lum: x.lum, media: x.media });
    prev = x;
  });
  for (const sec of ctx.sections) {
    const inSec = pts.filter((x) => x.s + vh / 2 >= sec.top && x.s + vh / 2 < sec.top + sec.height);
    if (!inSec.length) continue;
    const cnt = new Map();
    for (const x of inSec) cnt.set(x.bg, (cnt.get(x.bg) || 0) + 1);
    const bg = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.rhythm.push({ section: sec.id, bg, lum: inSec[0].lum, media: Math.round((inSec.reduce((a, x) => a + (x.media || 0), 0) / inSec.length) * 100) / 100 });
  }
  let i = 0;
  while (i < pts.length - 1) {
    const a = pts[i], b = pts[i + 1];
    if (rgbDist(a.bg, b.bg) < 8 && a.root === b.root && a.theme === b.theme) {
      i++;
      continue;
    }
    let j = i + 1;
    const seen = new Set([a.bg, pts[j].bg]);
    while (j < pts.length - 1 && rgbDist(pts[j].bg, pts[j + 1].bg) >= 8 && pts[j + 1].s - pts[j].s < vh) {
      j++;
      seen.add(pts[j].bg);
    }
    const z = pts[j];
    const total = rgbDist(a.bg, z.bg);
    const rootChanged = a.root !== z.root && rgbDist(a.root, z.root) > 30;
    const themeChanged = a.theme !== z.theme;
    const gradual = seen.size >= 4;
    if (total > 40 && (rootChanged || themeChanged || gradual)) {
      out.shifts.push({
        from: a.bg,
        to: z.bg,
        lumFrom: a.lum,
        lumTo: z.lum,
        startScroll: Math.round(a.s),
        endScroll: Math.round(z.s),
        t: z.t,
        mode: gradual && z.s - a.s > 150 ? 'scrub' : 'transition',
        via: rootChanged ? 'body background' : themeChanged ? 'theme class' : 'section background',
        theme: themeChanged ? { from: a.theme, to: z.theme } : undefined,
        steps: seen.size,
      });
    }
    i = j;
  }
  // one continuous change split in pieces (e.g. a class removed at the start of a scrub) → one shift
  const merged = [];
  for (const sh of out.shifts) {
    const p = merged[merged.length - 1];
    if (p && sh.startScroll - p.endScroll <= 150) {
      p.to = sh.to;
      p.lumTo = sh.lumTo;
      p.endScroll = sh.endScroll;
      p.steps += sh.steps;
      if (sh.via === 'body background') p.via = sh.via;
      if (sh.theme) p.theme = { from: p.theme ? p.theme.from : sh.theme.from, to: sh.theme.to };
    } else merged.push({ ...sh });
  }
  // scrubbed or timed? the scan parked the page mid-change and waited: an intermediate colour at rest = scrub
  for (const sh of merged) {
    const chk = (cap.sceneChecks || []).find((c) => c.mid >= sh.startScroll - 5 && c.mid <= sh.endScroll + 5);
    if (chk && chk.bg) sh.mode = rgbDist(chk.bg, sh.from) > 25 && rgbDist(chk.bg, sh.to) > 25 ? 'scrub' : 'transition';
    else if (sh.theme) sh.mode = 'transition';
  }
  out.shifts = merged;
  return out;
}
function sceneEffects(scene, ctx, vh) {
  return scene.shifts.map((sh) => ({
    _kind: 'scene',
    source: 'measured:scene',
    confidence: sh.via === 'section background' ? 0.65 : 0.8,
    technique: sh.mode === 'scrub' ? 'gsap-scrolltrigger' : 'css-transition',
    trigger: sh.mode === 'scrub' ? 'scroll-scrub' : 'scroll-enter',
    effect_type: 'scene-color-shift',
    targets: [{ selector: sh.via === 'body background' ? 'body' : sh.via === 'theme class' ? 'html' : '[data-dip-scene]' }],
    section: sectionFor(ctx.sections, (sh.startScroll + sh.endScroll) / 2 + vh * 0.5),
    animation: sh,
    startScroll: sh.startScroll,
    t: sh.t || 0,
  }));
}

// ------------------------------------------------------------------ multi-image compositions (spiral, orbit, stack, fan…)
function spearman(a, b) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    idx.forEach(([, i], k) => (r[i] = k));
    return r;
  };
  return pearson(rank(a), rank(b));
}
export function classifyLayout(children) {
  const n = children.length;
  if (n < 4) return null;
  const kids = children.slice().sort((a, b) => a.index - b.index);
  const cx = kids.reduce((a, k) => a + k.x, 0) / n, cy = kids.reduce((a, k) => a + k.y, 0) / n;
  const size = median(kids.map((k) => Math.max(k.w, k.h))) || 1;
  const r = kids.map((k) => Math.hypot(k.x - cx, k.y - cy));
  const rMean = r.reduce((a, b) => a + b, 0) / n;
  const rStd = Math.sqrt(r.reduce((a, b) => a + (b - rMean) ** 2, 0) / n);
  const rots = kids.map((k) => k.rot || 0);
  const rotSpread = Math.max(...rots) - Math.min(...rots);
  const maxR = Math.max(...r);
  const base = { count: n, center: [Math.round(cx), Math.round(cy)], itemSize: Math.round(size), rotations: rotSpread > 2 ? rots : undefined };
  if (maxR < size * 0.8) {
    if (rotSpread > 15 && Math.abs(spearman(kids.map((k) => k.index), rots)) > 0.8) return { layout: 'fan', ...base, rotationStep: Math.round((rotSpread / (n - 1)) * 10) / 10 };
    return { layout: 'stack', ...base, offsets: kids.map((k) => [Math.round(k.x - cx), Math.round(k.y - cy)]) };
  }
  // rows / grids are ordinary layouts
  const ys = new Set(kids.map((k) => Math.round(k.y / 20))), xs = new Set(kids.map((k) => Math.round(k.x / 20)));
  if ((ys.size <= Math.ceil(n / 2) || xs.size <= Math.ceil(n / 2)) && rotSpread < 3) return { layout: 'grid', ...base };
  const ang = kids.map((k) => Math.atan2(k.y - cy, k.x - cx));
  const unwrapped = [ang[0]];
  for (let i = 1; i < n; i++) {
    let d = ang[i] - ang[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    unwrapped.push(unwrapped[i - 1] + d);
  }
  const dAng = unwrapped.slice(1).map((a, i) => a - unwrapped[i]);
  const sameDir = Math.max(dAng.filter((d) => d > 0).length, dAng.filter((d) => d < 0).length) / dAng.length;
  const turn = Math.abs(unwrapped[n - 1] - unwrapped[0]);
  const deg = (x) => Math.round((x * 180) / Math.PI);
  if (sameDir >= 0.8 && Math.abs(spearman(kids.map((k) => k.index), r)) > 0.8 && turn > Math.PI * 0.75)
    return { layout: 'spiral', ...base, radius: [Math.round(Math.min(...r)), Math.round(maxR)], turns: Math.round((turn / (2 * Math.PI)) * 100) / 100, angleStep: deg(median(dAng.map(Math.abs))), direction: dAng.reduce((a, b) => a + b, 0) > 0 ? 'clockwise' : 'counter-clockwise' };
  if (rStd / (rMean || 1) < 0.15 && sameDir >= 0.8 && turn > Math.PI) return { layout: 'circle', ...base, radius: Math.round(rMean), angleStep: deg(median(dAng.map(Math.abs))) };
  return rotSpread > 8 ? { layout: 'collage', ...base } : { layout: 'scatter', ...base };
}
function mediaCompositions(cap, ctx, all) {
  const groups = ((cap.breakpoints && (cap.breakpoints['1440'] || Object.values(cap.breakpoints)[0])) || {}).mediaGroups || [];
  const tracks = new Map((((cap.motion && cap.motion.recorder) || {}).tracks || []).map((t) => [t.nid, t]));
  const out = { compositions: [], effects: [] };
  for (const g of groups) {
    const lay = classifyLayout(g.children);
    if (!lay) continue;
    const members = new Set([g.nid, ...g.children.map((c) => c.nid)]);
    const linked = all.filter((e) => (e.targets || []).some((t) => members.has(t.nid) || (tracks.get(t.nid) && members.has(tracks.get(t.nid).parentNid))));
    const comp = { selector: g.selector, nid: g.nid, rect: g.rect, section: sectionFor(ctx.sections, g.rect.y), ...lay, animated: linked.length > 0 };
    out.compositions.push(comp);
    if (lay.layout === 'grid' && !linked.length) continue;
    if (lay.layout === 'scatter' && !linked.length) continue;
    // the most telling driver wins (a scrubbed rotation matters more than the images' own reveal)
    const PRIO = ['scroll-scrub', 'mouse-move', 'drag', 'time-loop', 'hover', 'press', 'click', 'scroll-enter', 'load'];
    const trig = linked.length ? linked.map((e) => e.trigger).sort((a, b) => PRIO.indexOf(a) - PRIO.indexOf(b))[0] : 'load';
    const starts = linked.map((e) => e.t).filter((x) => x != null).sort((a, b) => a - b);
    out.effects.push({
      _kind: 'composition',
      source: linked.length ? 'measured:composition' : 'measured:layout',
      confidence: linked.length ? 0.75 : 0.6,
      technique: linked.find((e) => e.technique) ? linked.find((e) => e.technique).technique : 'css-transform',
      trigger: trig,
      effect_type: 'media-choreography',
      targets: [{ selector: g.selector, nid: g.nid, rect: g.rect }],
      section: comp.section,
      startScroll: linked.map((e) => e.startScroll).filter((x) => x != null).sort((a, b) => a - b)[0],
      animation: {
        ...lay,
        motion: linked.slice(0, 12).map((e) => ({ id: e.effect_type, trigger: e.trigger, targets: (e.targets || []).slice(0, 3).map((t) => t.selector), duration: e.animation && e.animation.duration, ease: e.animation && e.animation.ease, values: e.animation && (e.animation.values || e.animation.to), scroll: e.animation && e.animation.scroll })),
        stagger: starts.length > 2 ? Math.round(median(starts.slice(1).map((t, i) => t - starts[i])) ) / 1000 : undefined,
      },
      _linked: linked,
      t: starts[0] || 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ press / toggle interactions (scan steps)
function interactionEffects(cap, ctx) {
  const out = [];
  for (const p of cap.presses || []) {
    if (!p.diff || !p.diff.length) continue;
    out.push({
      _kind: 'interaction',
      source: 'measured:press',
      confidence: 0.8,
      technique: 'css-transition',
      trigger: 'press',
      effect_type: 'press-hold',
      targets: [p.target],
      animation: { changes: p.diff.slice(0, 20), holdMs: p.holdMs },
      shots: p.shots || [],
      t: p.t || 0,
    });
  }
  for (const c of cap.clicks || []) {
    out.push({
      _kind: 'interaction',
      source: 'measured:click',
      confidence: 0.75,
      technique: 'css-transition',
      trigger: 'click',
      effect_type: 'click-feedback',
      targets: [c.target],
      animation: { during: (c.diff || []).slice(0, 20), persistent: (c.stays || []).slice(0, 20) },
      shots: [],
      t: c.t || 0,
    });
  }
  for (const d of cap.drags || []) {
    out.push({
      _kind: 'interaction',
      source: 'measured:drag',
      confidence: 0.75,
      technique: 'js-inline-style',
      trigger: 'drag',
      effect_type: 'gallery-drag',
      targets: [d.target],
      animation: { dragPx: d.dragPx, followPx: d.atReleasePx, travelPx: d.movedPx, inertia: d.inertia, settleMs: d.settleMs, grabCursor: d.grab || false, followRatio: d.dragPx ? Math.round((d.atReleasePx / d.dragPx) * 100) / 100 : null },
      shots: d.shots || [],
      t: d.t || 0,
    });
  }
  for (const g of cap.toggles || []) {
    if (!g.changed) continue;
    const type = g.kind === 'tab' ? 'tabs' : g.kind === 'accordion' ? 'accordion' : g.kind === 'menu' || g.coversViewport ? 'menu-overlay' : 'other';
    out.push({
      _kind: 'interaction',
      source: 'measured:toggle',
      confidence: 0.75,
      technique: 'js-inline-style',
      trigger: 'click',
      effect_type: type,
      targets: [g.target],
      animation: { kind: g.kind, label: g.label, controls: g.controls, expanded: g.expanded, settleMs: g.settleMs, opened: g.opened, styleChanges: (g.diff || []).slice(0, 20) },
      shots: g.shots || [],
      t: g.t || 0,
      _closeT: g.closeT || null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ 3D motion (Three.js camera / objects)
const CH3 = [
  ['px', 'position.x'],
  ['py', 'position.y'],
  ['pz', 'position.z'],
  ['rx', 'rotation.x'],
  ['ry', 'rotation.y'],
  ['rz', 'rotation.z'],
  ['sx', 'scale'],
  ['fov', 'fov'],
];
function channels3(tk) {
  const out = [];
  for (const [ch, name] of CH3) {
    const v = (tk[ch] || []).filter((x) => typeof x === 'number');
    if (v.length < 3) continue;
    const mn = Math.min(...v), mx = Math.max(...v);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const thr = ch.startsWith('r') ? 0.01 : ch === 'fov' ? 0.2 : Math.max(0.002, Math.abs(mean) * 0.002);
    if (mx - mn > thr) out.push({ ch, name, range: mx - mn, min: mn, max: mx, rel: (mx - mn) / (thr * 10) });
  }
  return out.sort((a, b) => b.rel - a.rel);
}
function keyframes3(tk, chans, by) {
  // value snapshots along scroll (forward only) or time, downsampled to ≤ 24 keys
  const idx = [];
  let last = -Infinity;
  for (let i = 0; i < tk.t.length; i++) {
    const k = by === 'scroll' ? tk.s[i] : tk.t[i];
    if (by === 'scroll' && k <= last) continue;
    last = k;
    idx.push(i);
  }
  const step = Math.max(1, Math.ceil(idx.length / 24));
  const keys = [];
  for (let j = 0; j < idx.length; j += step) {
    const i = idx[j];
    const o = { [by === 'scroll' ? 'scroll' : 't']: by === 'scroll' ? tk.s[i] : tk.t[i] };
    for (const c of chans) o[c.name] = tk[c.ch][i];
    keys.push(o);
  }
  return keys;
}
function analyze3DMotion(cap, ctx) {
  const tracks = (cap.three && cap.three.motion) || [];
  const effects = [];
  const vw = ctx.vw || 1440, vh = (cap.ping && cap.ping.vh) || 900;
  for (const tk of tracks) {
    const chans = channels3(tk);
    if (!chans.length) continue;
    const main = chans[0];
    const drv = classifyDriver(tk, main, ctx);
    const isCam = tk.kind === 'camera';
    const who = isCam ? 'camera' : `object "${tk.label}"`;
    const e = {
      _kind: 'three',
      source: 'read:three',
      confidence: 0.9,
      technique: 'three-scene',
      targets: [{ selector: isCam ? 'three:camera' : `three:${tk.label}`, three: tk.key }],
      section: null,
      t: tk.t[0],
      three: { object: isCam ? 'camera' : tk.label, kind: tk.kind, channels: chans.map((c) => c.name) },
    };
    if (drv.driver === 'scroll') {
      const keys = keyframes3(tk, chans, 'scroll');
      const pts = keys.map((k) => [k.scroll, k[main.name]]);
      let i0 = 0, i1 = pts.length - 1;
      while (i0 < i1 && pts[i0 + 1][1] === pts[0][1]) i0++;
      while (i1 > i0 && pts[i1 - 1][1] === pts[pts.length - 1][1]) i1--;
      const act = pts.slice(i0, i1 + 1);
      if (act.length < 3) continue;
      const nrm = normalize(act.map((p) => p[0]), act.map((p) => p[1]));
      e.trigger = 'scroll-scrub';
      e.effect_type = isCam ? 'camera-scroll-path' : '3d-object-motion';
      e.animation = { channels: e.three.channels, scroll: { startPx: act[0][0], endPx: act[act.length - 1][0] }, keyframes: keys.slice(Math.max(0, i0 - 1), i1 + 2), ease: act.length >= 8 ? fitEase(nrm.x, nrm.y).best : 'none', mainChannel: main.name };
      e.curve = nrm.x.map((x, i) => [r3(x), r3(nrm.y[i])]);
      e.curveSource = 'three';
    } else if (drv.driver === 'mouse') {
      // value = a + gain * pointer (pointer normalised to -1..1)
      const gains = {};
      for (const c of chans) {
        const v = tk[c.ch];
        const nx = tk.mx.map((x) => (x / vw) * 2 - 1), ny = tk.my.map((y) => (y / vh) * 2 - 1);
        const fit = (m) => {
          const n = v.length;
          const mm = m.reduce((a, b) => a + b, 0) / n, mv = v.reduce((a, b) => a + b, 0) / n;
          let num = 0, den = 0;
          for (let i = 0; i < n; i++) {
            num += (m[i] - mm) * (v[i] - mv);
            den += (m[i] - mm) ** 2;
          }
          return den ? r3(num / den) : 0;
        };
        gains[c.name] = { perPointerX: fit(nx), perPointerY: fit(ny) };
      }
      e.trigger = 'mouse-move';
      e.effect_type = !isCam && main.ch.startsWith('r') ? 'tilt-3d' : 'mouse-parallax';
      e.animation = { channels: e.three.channels, mouse: { normalised: 'pointer -1..1 across the viewport', gains }, range: Object.fromEntries(chans.map((c) => [c.name, [r3(c.min), r3(c.max)]])) };
    } else if (drv.driver === 'loop') {
      const speeds = {};
      for (const c of chans) {
        const v = tk[c.ch], t = tk.t;
        const d = [];
        for (let i = 1; i < v.length; i++) if (t[i] - t[i - 1] > 0 && t[i] - t[i - 1] < 250) d.push(((v[i] - v[i - 1]) / (t[i] - t[i - 1])) * 1000);
        speeds[c.name] = r3(median(d) || 0);
      }
      e.trigger = 'time-loop';
      e.effect_type = '3d-object-motion';
      e.animation = { channels: e.three.channels, loop: { perSecond: speeds, note: 'rotation in radians/s, position in scene units/s' }, range: Object.fromEntries(chans.map((c) => [c.name, [r3(c.min), r3(c.max)]])) };
    } else {
      const segs = segmentsOf(tk, main.ch, 200).filter((sg) => sg.end - sg.start >= 3);
      if (!segs.length) continue;
      const sg = segs.sort((a, b) => Math.abs(tk[main.ch][b.end] - tk[main.ch][b.start]) - Math.abs(tk[main.ch][a.end] - tk[main.ch][a.start]))[0];
      const ts = tk.t.slice(sg.start, sg.end + 1), vs = tk[main.ch].slice(sg.start, sg.end + 1);
      const nrm = normalize(ts, vs);
      const phase = phaseKind(phaseAt(ctx.marks, ts[0]));
      e.trigger = phase === 'hover' ? 'hover' : phase === 'scroll' ? 'scroll-enter' : phase === 'manual' ? ctx.manualTrigger(ts[0]) : phase === 'press' ? 'press' : phase === 'toggle' ? 'click' : phase === 'drag' ? 'drag' : 'load';
      e.effect_type = isCam ? 'camera-scroll-path' : '3d-object-motion';
      if (isCam && e.trigger !== 'scroll-enter') e.effect_type = '3d-object-motion';
      e.animation = {
        channels: e.three.channels,
        duration: r3((ts[ts.length - 1] - ts[0]) / 1000),
        ease: ts.length >= 8 ? fitEase(nrm.x, nrm.y).best : 'power2.out',
        from: Object.fromEntries(chans.map((c) => [c.name, tk[c.ch][sg.start]])),
        to: Object.fromEntries(chans.map((c) => [c.name, tk[c.ch][sg.end]])),
      };
      e.curve = nrm.x.map((x, i) => [r3(x), r3(nrm.y[i])]);
      e.curveSource = 'three';
      e.t = ts[0];
    }
    effects.push(e);
  }
  return effects;
}

// Post-processing passes recognised from Three.js / pmndrs program names and shader code.
const POST = [
  ['bloom', /LuminosityHighPass|UnrealBloom|Bloom|luminosityThreshold/i],
  ['depth-of-field', /Bokeh|DepthOfField|\bdof\b|focalLength|focusDistance/i],
  ['chromatic-aberration', /ChromaticAberration|RGBShift|rgbShift|\bchromatic/i],
  ['film-grain', /FilmShader|FilmPass|grain|nIntensity/i],
  ['vignette', /Vignette|vignette/i],
  ['fxaa-smaa', /FXAA|SMAA/i],
  ['noise', /NoiseEffect|\bnoise\s*\(/i],
  ['glitch', /Glitch/i],
  ['tone-mapping-output', /OutputPass|ToneMapping|OutputShader/i],
  ['motion-blur', /MotionBlur|velocity/i],
  ['pixelation', /Pixelat/i],
  ['outline', /Outline/i],
];
function detectPostprocessing(progs) {
  const found = new Map();
  for (const p of progs || []) {
    const src = (p.vertex || '') + '\n' + (p.fragment || '');
    const name = (/#define SHADER_NAME ([^\n]*)/.exec(src) || [])[1] || '';
    // full-screen passes draw a single quad: they read a tDiffuse / inputBuffer texture
    const fullscreen = /tDiffuse|inputBuffer|uScene|tInput/.test(src);
    if (!fullscreen && !name) continue;
    for (const [label, re] of POST) if (re.test(name) || (fullscreen && re.test(src))) found.set(label, (found.get(label) || 0) + 1);
  }
  return [...found.keys()];
}

// The same pattern applied to many elements (cards, list items, slides…) is one effect with many targets.
function mergeSimilar(list) {
  const out = [];
  const byKey = new Map();
  for (const e of list) {
    if (e._kind === 'gsap' && e.animation && e.animation.steps) {
      out.push(e);
      continue;
    }
    const a = e.animation || {};
    const dur = typeof a.duration === 'number' ? Math.round(a.duration * 20) : '';
    const props = a.channels ? a.channels.join(',') : a.name || (a.props || []).join(',') || Object.keys(typeof a.to === 'object' ? a.to || {} : {}).sort().join(',');
    const key = [e.section, e.effect_type, e.trigger, e.technique, e.source, props, dur, a.ease || '', a.loop ? a.loop.channel : ''].join('|');
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, e);
      out.push(e);
      continue;
    }
    hit.targets = dedupeTargets([...(hit.targets || []), ...(e.targets || [])]);
    hit.instances = (hit.instances || 1) + 1;
    if (e._m) hit._m = [...(hit._m || []), ...e._m];
    if (e.shots && !(hit.shots || []).length) hit.shots = e.shots;
    hit.confidence = Math.max(hit.confidence, e.confidence);
  }
  return out;
}

function complexityOf(e) {
  let c = 1;
  const n = (e.targets || []).length;
  if (n > 3) c++;
  if (e.animation && e.animation.steps && e.animation.steps.length > 3) c++;
  if (e.scrollTrigger && e.scrollTrigger.pin) c++;
  if (/webgl|three/.test(e.technique)) c += 2;
  return Math.min(5, c);
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .filter(Boolean)
    .slice(0, 4)
    .join('-');
}

// ------------------------------------------------------------------ scroll system
function analyzeScroll(cap) {
  const det = (cap.scroll && cap.scroll.detect) || { type: 'native' };
  const out = { type: det.type, version: det.version || null, evidence: det.evidence || [], options: det.options || null, snap: det.snap || null };
  const imp = cap.scroll && cap.scroll.impulse;
  if (imp && imp.samples && imp.samples.length > 3) {
    const s = imp.samples;
    const final = s[s.length - 1][1];
    const start = s[0][1];
    const total = final - start;
    out.impulse = { wheelDeltaPx: imp.delta, travelledPx: total, samples: s.slice(0, 120) };
    if (Math.abs(total) > 5) {
      const i90 = s.findIndex((p) => Math.abs(p[1] - start) >= Math.abs(total) * 0.9);
      const i99 = s.findIndex((p) => Math.abs(p[1] - start) >= Math.abs(total) * 0.99);
      const firstMove = s.findIndex((p) => p[1] !== start);
      out.impulse.settleMs = i99 >= 0 ? s[i99][0] - (s[firstMove] ? s[firstMove][0] : 0) : null;
      out.impulse.t90Ms = i90 >= 0 ? s[i90][0] : null;
      // exponential decay -> lerp: remaining_{n+1} = remaining_n * (1 - lerp)
      const ratios = [];
      for (let i = firstMove; i < s.length - 1; i++) {
        const r0 = final - s[i][1], r1 = final - s[i + 1][1];
        const dt = s[i + 1][0] - s[i][0];
        // normalise to a 60fps frame: slow pages (WebGL) run at 30fps or less
        if (Math.abs(r0) > Math.abs(total) * 0.05 && Math.abs(r1) > 0.5 && r1 / r0 > 0 && dt > 8 && dt < 250) ratios.push(Math.pow(r1 / r0, 16.667 / dt));
      }
      const settle = out.impulse.settleMs || 0;
      if (settle < 60) out.feel = 'instant (native scroll, no smoothing)';
      else if (ratios.length >= 3) {
        const rm = median(ratios);
        const lerp = r3(1 - rm);
        const spread = Math.max(...ratios) - Math.min(...ratios);
        if (spread < 0.25 && lerp > 0 && lerp < 1) {
          out.measuredLerp = lerp;
          out.feel = `exponential smoothing, lerp ≈ ${lerp} per 60fps frame`;
        } else {
          const nrm = normalize(s.slice(firstMove).map((p) => p[0]), s.slice(firstMove).map((p) => p[1]));
          const fit = fitEase(nrm.x, nrm.y);
          out.measuredDuration = r3(settle / 1000);
          out.measuredEasing = fit.best;
          out.feel = `fixed-duration smoothing ≈ ${out.measuredDuration}s, ease ${fit.best}`;
        }
      }
    }
  }
  if (out.type === 'native' && out.measuredLerp) out.type = 'custom-smooth (unidentified)';
  return out;
}

// ------------------------------------------------------------------ typography & tokens
function typographyRoles(cap) {
  const bps = cap.breakpoints || {};
  const main = bps['1440'] || Object.values(bps)[0];
  const base = (main && main.tokens && main.tokens.typography) || (cap.tokens && cap.tokens.typography) || [];
  const rolesOrder = ['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'a', 'button', 'li', 'span', 'small'];
  const roles = [];
  const used = new Set();
  const bySize = base.slice().sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize));
  if (bySize[0]) {
    roles.push({ role: 'display', ...bySize[0] });
    used.add(bySize[0]);
  }
  for (const tag of rolesOrder) {
    const cand = base.filter((t) => !used.has(t) && t.tags && t.tags[tag]).sort((a, b) => b.chars - a.chars)[0];
    if (!cand) continue;
    used.add(cand);
    roles.push({ role: tag === 'p' ? 'body' : tag === 'small' ? 'caption' : tag, ...cand });
  }
  const body = base.slice().sort((a, b) => b.chars - a.chars)[0];
  if (body && !roles.some((r) => r.role === 'body')) roles.push({ role: 'body', ...body });
  // fluid regression across breakpoints using selectors
  for (const r of roles) {
    const pts = [];
    for (const [bp, data] of Object.entries(bps)) {
      const typo = (data.tokens && data.tokens.typography) || [];
      const hit = typo.find((t) => t.selectors && r.selectors && t.selectors.some((s) => r.selectors.includes(s)));
      const vw = (data.viewport && data.viewport.w) || +bp;
      if (hit) pts.push([vw, parseFloat(hit.fontSize)]);
    }
    r.sizes = pts.map(([vw, px]) => ({ viewport: vw, px }));
    if (pts.length >= 2) {
      pts.sort((a, b) => a[0] - b[0]);
      const n = pts.length;
      const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
      let num = 0, den = 0;
      for (const [x, y] of pts) {
        num += (x - mx) * (y - my);
        den += (x - mx) ** 2;
      }
      const b = den ? num / den : 0;
      const a = my - b * mx;
      const minPx = Math.min(...pts.map((p) => p[1]));
      const maxPx = Math.max(...pts.map((p) => p[1]));
      if (Math.abs(b) > 0.0005 && maxPx - minPx > 1) {
        r.fluid = { formula: `clamp(${r2(minPx)}px, ${r2(a)}px + ${r3(b * 100)}vw, ${r2(maxPx)}px)`, slopePerVw: r3(b * 100), interceptPx: r2(a) };
      } else r.fluid = null;
    }
  }
  return roles;
}

function w3cTokens(cap, roles) {
  const t = cap.tokens || {};
  const out = { $description: 'Design tokens measured by DIP (W3C Design Tokens format)', color: {}, typography: {}, spacing: {}, radius: {}, shadow: {}, duration: {}, easing: {}, breakpoint: {} };
  const c = t.colors || {};
  if (c.background) out.color.background = { $type: 'color', $value: c.background };
  if (c.text) out.color.text = { $type: 'color', $value: c.text };
  if (c.accent) out.color.accent = { $type: 'color', $value: c.accent };
  (c.palette || []).forEach((p, i) => {
    out.color['palette-' + String(i + 1).padStart(2, '0')] = { $type: 'color', $value: p.alpha < 1 ? `${p.hex}${Math.round(p.alpha * 255).toString(16).padStart(2, '0')}` : p.hex, $extensions: { dip: { share: p.share, role: p.role } } };
  });
  for (const r of roles) {
    out.typography[r.role] = {
      $type: 'typography',
      $value: { fontFamily: r.fontFamily, fontWeight: r.fontWeight, fontSize: r.fluid ? r.fluid.formula : r.fontSize, lineHeight: r.lineHeight, letterSpacing: r.letterSpacing },
      $extensions: { dip: { textTransform: r.textTransform, measuredAt1440: r.fontSize, sizes: r.sizes, samples: r.samples } },
    };
  }
  (t.spacing || []).slice(0, 12).map((s) => s.value).map((v) => parseFloat(v)).filter((v, i, a) => v > 0 && a.indexOf(v) === i).sort((a, b) => a - b).forEach((v, i) => (out.spacing['space-' + (i + 1)] = { $type: 'dimension', $value: v + 'px' }));
  (t.radii || []).slice(0, 6).forEach((r, i) => (out.radius['radius-' + (i + 1)] = { $type: 'dimension', $value: r.value }));
  (t.shadows || []).slice(0, 4).forEach((s, i) => (out.shadow['shadow-' + (i + 1)] = { $type: 'shadow', $value: s.value }));
  (t.durations || []).slice(0, 6).forEach((d, i) => (out.duration['duration-' + (i + 1)] = { $type: 'duration', $value: d.value }));
  (t.easings || []).slice(0, 6).forEach((d, i) => (out.easing['ease-' + (i + 1)] = { $type: 'cubicBezier', $value: d.value }));
  (t.breakpoints || []).slice(0, 8).forEach((b) => (out.breakpoint[`${b.type}-${b.px}`] = { $type: 'dimension', $value: b.px + 'px' }));
  out.$extensions = { dip: { cssVars: t.cssVars || {}, themes: t.themes || [], fontFaces: t.fontFaces || [] } };
  return out;
}

// ------------------------------------------------------------------ webgl
function analyzeWebGL(cap, ctx) {
  const g = cap.webgl || {};
  const cards = [];
  const progs = g.programs || [];
  const uniforms = g.uniforms || [];
  const three = cap.three || {};
  const hasScene = (three.scenes || []).length > 0;
  // Three.js tags its programs with SHADER_TYPE / SHADER_NAME; built-in materials are described by the scene card,
  // only custom ShaderMaterial / RawShaderMaterial programs get their own shader card. Identical programs are merged.
  const seen = new Map();
  const keep = [];
  for (const p of progs) {
    const src = (p.vertex || '') + '\n' + (p.fragment || '');
    const meta = threeMeta(src);
    if (meta.type && THREE_BUILTIN.test(meta.type)) continue;
    if (!meta.type && hasScene && /#define (STANDARD|PHONG|LAMBERT|BASIC|MATCAP|TOON|PHYSICAL|DISTANCE|DEPTH|SHADOW)\b/.test(src)) continue;
    const key = userCode(p.vertex) + '\u0000' + userCode(p.fragment);
    if (seen.has(key)) {
      seen.get(key).instances++;
      seen.get(key).pids.push(p.pid);
      continue;
    }
    const entry = { p, meta, instances: 1, pids: [p.pid] };
    seen.set(key, entry);
    keep.push(entry);
  }
  keep.forEach(({ p, meta, instances, pids }) => {
    const us = uniforms.filter((u) => pids.includes(u.pid) && !THREE_UNIFORMS.test(u.name)).filter((u, i, a) => a.findIndex((x) => x.name === u.name) === i);
    const uDesc = us.map((u) => {
      const s = u.samples || [];
      const numeric = s.filter((x) => typeof x.v[0] === 'number');
      let drivenBy = 'constant';
      if (numeric.length > 3) {
        const vals = numeric.map((x) => x.v[0]);
        const ts = numeric.map((x) => x.t);
        const cT = Math.abs(pearson(ts, vals)), cS = Math.abs(pearson(numeric.map((x) => x.s), vals)), cMx = Math.abs(pearson(numeric.map((x) => x.mx), vals)), cMy = Math.abs(pearson(numeric.map((x) => x.my), vals));
        const best = Math.max(cT, cS, cMx, cMy);
        if (best < 0.5) drivenBy = 'varies';
        else if (best === cMx || best === cMy) drivenBy = 'mouse';
        else if (best === cS && cS > cT + 0.05) drivenBy = 'scroll';
        else drivenBy = 'time';
      } else if (s.length > 1) drivenBy = 'varies';
      const nm = u.name.toLowerCase();
      if (drivenBy === 'constant' || drivenBy === 'varies') {
        if (/mouse|pointer|cursor/.test(nm)) drivenBy = 'mouse (by name)';
        else if (/time/.test(nm) && s.length > 1) drivenBy = 'time (by name)';
        else if (/scroll|progress/.test(nm) && s.length > 1) drivenBy = 'scroll/progress (by name)';
      }
      return { name: u.name, kind: u.kind, drivenBy, updates: u.count, first: s[0] ? s[0].v : null, last: s.length ? s[s.length - 1].v : null, range: rangeOf(s) };
    });
    const src = userCode(p.vertex) + '\n' + userCode(p.fragment);
    const tex = (g.textures || []).filter((t) => t.cid === p.cid);
    const ctxInfo = (g.contexts || []).find((c) => c.cid === p.cid);
    const canvas = ctxInfo && ctxInfo.canvas;
    const full = canvas && canvas.rect && canvas.rect.w >= ctx.vw * 0.9;
    const hasMouse = uDesc.some((u) => /mouse/.test(u.drivenBy));
    const hasTime = uDesc.some((u) => /time/.test(u.drivenBy));
    const imageTex = tex.some((t) => t.kind === 'image' || t.kind === 'video');
    const noise = /noise|snoise|fbm|simplex|perlin|random\(/i.test(src);
    const points = /gl_PointSize/.test(p.vertex || '');
    const samplers = (src.match(/uniform\s+sampler2D\s+\w+/g) || []).length;
    let type = 'fluid-background-shader';
    if (meta.name === 'GPUComputationShader') type = 'gpgpu-simulation';
    else if (points) type = 'particles';
    else if ((imageTex || samplers) && (hasMouse || /hover|mouse|pointer/i.test(src))) type = 'image-distortion-hover';
    else if (imageTex && !hasScene) type = 'image-distortion-hover';
    else if (/grain/i.test(src)) type = 'grain-overlay';
    else if (noise && !full) type = 'noise-gradient';
    else if (hasScene && !full) type = '3d-scene';
    const id = 'w' + String(cards.length + 1).padStart(2, '0') + '-' + slug(meta.name && meta.name !== 'GPUComputationShader' ? meta.name : type);
    cards.push({
      id,
      pid: p.pid,
      pids,
      instances,
      material: meta.type || null,
      shaderName: meta.name || null,
      type,
      section: canvas && canvas.rect ? sectionFor(ctx.sections, canvas.rect.y) : null,
      canvas,
      uniforms: uDesc,
      textures: tex,
      inputs: { mouse: hasMouse, time: hasTime, scroll: uDesc.some((u) => /scroll/.test(u.drivenBy)), textures: tex.length },
      traits: { noise, points, vertexDeformation: (g.verticesMax || 0) > 1000 && /position\s*\+|position\.z|pos\.z|sin\(/.test(p.vertex || ''), fullBleed: !!full },
      vertex: p.vertex,
      fragment: p.fragment,
      userVertex: userCode(p.vertex),
      userFragment: userCode(p.fragment),
      uniformSamples: us,
    });
  });
  return { cards, three: hasScene ? three : null, sceneSummary: hasScene ? summarizeScene(three, progs) : null, gpu: g.gpu, drawCalls: g.drawCallsPerFrame, canvas2d: g.canvas2d, wgsl: (g.wgsl || []).length, programsTotal: progs.length };
}

const THREE_BUILTIN = /^(Mesh\w*Material|LineBasicMaterial|LineDashedMaterial|PointsMaterial|SpriteMaterial|ShadowMaterial)$/;
// uniforms Three.js sets on every program (camera, lights, fog…): not design parameters
const THREE_UNIFORMS = /^(modelMatrix|modelViewMatrix|projectionMatrix|viewMatrix|normalMatrix|cameraPosition|isOrthographic|toneMappingExposure|logDepthBufFC|ambientLightColor|lightProbe|(directional|point|spot|rectArea|hemisphere)Lights?\[|(directional|point|spot)Shadow|fog(Color|Near|Far|Density)|ltc_[12]|dfgLUT|boneTexture|bindMatrix)/;
function threeMeta(src) {
  const t = /#define SHADER_TYPE (\w+)/.exec(src || '');
  const n = /#define SHADER_NAME ([^\n]*)/.exec(src || '');
  return { type: t ? t[1] : null, name: n && n[1].trim() ? n[1].trim() : null };
}
// Strip the prefix Three.js prepends (defines, built-in uniforms and attributes) to keep the author's code.
function userCode(s) {
  s = s || '';
  let i = s.lastIndexOf('uniform bool isOrthographic;');
  if (i < 0) return s;
  i += 'uniform bool isOrthographic;'.length;
  const skin = s.indexOf('attribute vec4 skinWeight;', i);
  if (skin >= 0 && skin - i < 4000) {
    const end = s.indexOf('#endif', skin);
    if (end >= 0) i = end + 6;
  }
  return s.slice(i).replace(/^\s+/, '');
}
function summarizeScene(three, progs) {
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  const objs = (three.scenes || []).flatMap((s) => s.objects || []);
  const meshes = objs.filter((o) => o.materials);
  const mats = meshes.flatMap((o) => o.materials || []);
  const lights = objs.filter((o) => /Light$/.test(o.type || ''));
  const geos = meshes.map((o) => o.geometry).filter(Boolean);
  const materialTypes = count(mats, (m) => m.type);
  const programTypes = count(progs.map((p) => threeMeta((p.vertex || '') + (p.fragment || ''))), (m) => (m.name ? `${m.type}:${m.name}` : m.type || 'raw'));
  return {
    revision: three.revision,
    postprocessing: detectPostprocessing(progs),
    animationClips: objs.filter((o) => o.clips).map((o) => ({ object: o.name || o.type, clips: o.clips })),
    skinnedMeshes: objs.filter((o) => o.skinned).length,
    morphTargets: objs.filter((o) => o.morphTargets).map((o) => ({ object: o.name || o.type, ...o.morphTargets })),
    animatedObjects: (three.motion || []).map((tk) => tk.label),
    renderers: three.renderers,
    camera: three.camera,
    scenes: (three.scenes || []).length,
    objects: objs.length,
    meshes: meshes.length,
    materials: materialTypes,
    geometries: count(geos, (g) => g.type),
    maxVertices: geos.reduce((a, g) => Math.max(a, g.vertices || 0), 0),
    lights: lights.map((l) => ({ type: l.type, color: l.color, intensity: l.intensity, position: l.position })),
    fog: (three.scenes || []).map((s) => s.fog).filter(Boolean)[0] || null,
    background: (three.scenes || []).map((s) => s.background).filter(Boolean)[0] || null,
    programs: programTypes,
    models: meshes.filter((o) => o.name && !/^(Mesh|Object)/.test(o.name)).slice(0, 30).map((o) => ({ name: o.name, geometry: o.geometry && o.geometry.type, vertices: o.geometry && o.geometry.vertices, material: (o.materials || [])[0] && o.materials[0].type })),
  };
}
function rangeOf(samples) {
  const nums = samples.map((s) => s.v[0]).filter((x) => typeof x === 'number');
  if (!nums.length) return null;
  return [r3(Math.min(...nums)), r3(Math.max(...nums))];
}

// ------------------------------------------------------------------ tier & risks
function estimateTier(analysis, cap) {
  const webgl = analysis.webgl;
  const three = webgl.three;
  const hasGL = webgl.cards.length > 0 || (cap.webgl && cap.webgl.contexts && cap.webgl.contexts.some((c) => /webgl/.test(c.type)));
  const meshes = three ? three.scenes.reduce((a, s) => a + s.objects.filter((o) => o.materials).length, 0) : 0;
  if (webgl.wgsl || (webgl.canvas2d || []).some((c) => Object.values(c.calls || {}).reduce((a, b) => a + b, 0) > 5000)) return { tier: 'D', why: 'WebGPU compute or heavy procedural canvas rendering' };
  const heavy = three && three.scenes.some((s) => s.objects.some((o) => (o.geometry && o.geometry.vertices > 20000) || o.clips || o.skinned));
  if (meshes > 15 || heavy) return { tier: 'C', why: `Three.js scene with ${meshes} meshes${heavy ? ', models / animation clips' : ''}` };
  if (hasGL) return { tier: 'B', why: 'WebGL shaders (2D effects)' };
  return { tier: 'A', why: 'DOM/CSS/GSAP animations and smooth scroll only' };
}

// ------------------------------------------------------------------ main
export function analyze(cap) {
  const log = [];
  const bp1440 = (cap.breakpoints && (cap.breakpoints['1440'] || Object.values(cap.breakpoints)[0])) || {};
  const sections = bp1440.sections || [];
  const stackNames = new Set((cap.stack || []).filter((s) => s.confidence >= 0.7).map((s) => s.name));
  const ctx = {
    sections,
    marks: (cap.motion && cap.motion.marks) || [],
    splits: cap.splits || [],
    stackNames,
    vw: (bp1440.viewport && bp1440.viewport.w) || 1440,
    preloaderSels: new Set(((cap.intro && cap.intro.preloader) || []).map((p) => p.selector)),
    log,
  };
  // section of the main WebGL canvas ('global' when it is a fixed full-viewport background)
  const glc = ((cap.webgl && cap.webgl.contexts) || []).filter((c) => /webgl/.test(c.type) && c.canvas && c.canvas.rect).sort((a, b) => b.canvas.rect.w * b.canvas.rect.h - a.canvas.rect.w * a.canvas.rect.h)[0];
  if (glc) {
    const r = glc.canvas.rect, vh0 = (cap.ping && cap.ping.vh) || 900;
    ctx.canvasSection = r.w >= ctx.vw * 0.9 && r.h >= vh0 * 0.9 && r.y < 5 ? 'global' : sectionFor(sections, r.y);
  }
  const clicks = ((cap.motion && cap.motion.events) || []).filter((e) => e.type === 'click').map((e) => e.t);
  // manual recording: an animation that starts < 600ms after a click is click-triggered, otherwise pointer-driven
  ctx.manualTrigger = (t) => (clicks.some((c) => t >= c && t - c < 600) ? 'click' : 'hover');

  const gsapFx = gsapEffects(cap, ctx);
  const waapiFx = waapiEffects(cap, ctx);
  const explained = new Set();
  for (const e of [...gsapFx, ...waapiFx]) for (const t of e.targets || []) if (t.nid) explained.add(t.nid);
  // pinned elements are moved by ScrollTrigger itself; hovered elements are covered by hover effects
  for (const st of (cap.motion && cap.motion.gsap && cap.motion.gsap.scrollTriggers) || []) if (st.pinNid) explained.add(st.pinNid);
  for (const h of cap.hovers || []) if (h.target && h.target.nid && (h.diff.length || h.magnetic)) explained.add(h.target.nid);
  for (const p of cap.presses || []) if (p.target && p.target.nid && p.diff && p.diff.length) explained.add(p.target.nid);
  // split units explained by a gsap/waapi effect on the parent
  for (const s of ctx.splits) if (explained.has(s.nid)) (s.units || []).forEach((u) => explained.add(u));
  const { effects: recFx } = recorderEffects(cap, ctx, explained);
  const hoverFx = hoverEffects(cap, ctx);

  // Enrich GSAP effects with measured curves from the recorder (same targets) for verification.
  const tracksByNid = new Map(((cap.motion && cap.motion.recorder && cap.motion.recorder.tracks) || []).map((t) => [t.nid, t]));
  for (const e of [...gsapFx, ...waapiFx]) {
    const tk = (e.targets || []).map((t) => tracksByNid.get(t.nid)).find(Boolean);
    if (!tk) continue;
    try {
      const m = measureTrack(tk, ctx);
      if (m && m.loop) e.measuredLoop = m.loop;
      if (m && m.curve) {
        // read values are ground truth: the reference curve is the exact ease; the recorder curve is kept as a cross-check
        const exact = e.trigger !== 'scroll-scrub' && e.animation && typeof e.animation.ease === 'string' && !e.animation.steps;
        e.curve = exact ? sampleEase(e.animation.ease, 40) : m.curve;
        e.curveSource = exact ? 'ease-function' : 'recorder';
        if (m.startScroll != null) e.startScroll = m.startScroll; // when the motion really started (not when the code ran)
        e.measuredCheck = { driver: m.driver, duration: m.duration, fit: m.fit ? { best: m.fit.best, rms: m.fit.rms } : null, scrollStart: m.scrollStart, scrollEnd: m.scrollEnd, pxPerScrollPx: m.ratio };
      }
    } catch (err) {
      log.push('check failed: ' + err.message);
    }
  }

  // CSS transitions observed during the hover sweep belong to the hover effects
  const hoverKeys = new Set();
  for (const h of hoverFx) for (const t of h.targets) {
    hoverKeys.add(t.nid);
    hoverKeys.add(t.selector);
  }
  const waapiKept = waapiFx.filter((w) => {
    if (w.technique !== 'css-transition') return true;
    // hover-out transitions happen when the pointer leaves (next phase): same element as a hover effect → same effect
    if (w.trigger !== 'hover' && !['load', 'scroll-enter'].includes(w.trigger)) return true;
    const h = hoverFx.find((x) => x.targets.some((t) => w.targets.some((wt) => (wt.nid && wt.nid === t.nid) || wt.selector === t.selector || (wt.selector || '').startsWith(t.selector + ' '))));
    if (!h) return true;
    h.animation.transitions = h.animation.transitions || [];
    h.animation.transitions.push({ property: w.animation.name, duration: w.animation.duration, delay: w.animation.delay, ease: w.animation.ease, ease_bezier: w.animation.ease_bezier, target: w.targets[0] && w.targets[0].selector });
    if (!h.animation.duration) {
      h.animation.duration = w.animation.duration;
      h.animation.ease = w.animation.ease;
      h.animation.ease_bezier = w.animation.ease_bezier;
    }
    h.technique = 'css-transition';
    return false;
  });
  const threeFx = analyze3DMotion(cap, ctx);
  let all = [...gsapFx, ...waapiKept, ...recFx, ...hoverFx, ...threeFx, ...interactionEffects(cap, ctx)];

  // route transitions
  const routes = (cap.motion && cap.motion.routes) || [];
  if (routes.filter((r) => r.method === 'pushState').length) {
    all.push({ _kind: 'route', source: 'read:history', confidence: 0.5, technique: stackNames.has('barba') ? 'gsap-timeline' : 'js-inline-style', trigger: 'route-change', effect_type: 'page-transition', targets: [], animation: { routes: routes.slice(0, 10), libs: ['barba', 'swup', 'taxi', 'highway', 'nextjs'].filter((l) => stackNames.has(l)) }, t: routes[0].t });
  }

  // cursor
  const cursor = cap.cursor || {};
  for (const e of all) {
    if (e.trigger === 'mouse-move' && (cursor.candidates || []).some((c) => (e.targets || []).some((t) => t.nid === c.nid))) e.effect_type = 'custom-cursor';
  }

  // classify, assign section, ids
  for (const e of all) {
    e.effect_type = classify(e, ctx);
    const t0 = (e.targets || [])[0];
    let y = null;
    // untransformed layout position (measured at the end, scroll 0) first: rects taken while elements were
    // animating or pinned can land in another section
    if (t0 && t0.nid && cap.nidRects && cap.nidRects[t0.nid]) y = cap.nidRects[t0.nid].y;
    else if (e._m && e._m[0] && e._m[0].rect0) y = e._m[0].rect0.y;
    else if (t0 && t0.nid && tracksByNid.get(t0.nid) && tracksByNid.get(t0.nid).rect0) y = tracksByNid.get(t0.nid).rect0.y;
    else if (e._kind === 'hover' && t0 && t0.rect) y = t0.rect.y;
    if (e.scrollTrigger && e.scrollTrigger.triggerNid && cap.nidRects && cap.nidRects[e.scrollTrigger.triggerNid]) y = cap.nidRects[e.scrollTrigger.triggerNid].y;
    e.section = e.effect_type === 'custom-cursor' || e.effect_type === 'page-transition' ? 'global' : sectionFor(sections, y);
    if (e._kind === 'three') e.section = ctx.canvasSection || 'global';
  }
  // motion recorded right after a toggle click belongs to that toggle (menu fade, accordion height…)
  const toggles = all.filter((e) => e.source === 'measured:toggle');
  if (toggles.length) {
    all = all.filter((e) => {
      if (e.source === 'measured:toggle' || e.trigger !== 'click' || e._kind === 'three') return true;
      // opening motion follows the click; closing motion follows the restore click (closeT)
      const tg = toggles.filter((g) => e.t >= g.t - 50 && e.t <= Math.max(g.t, g._closeT || 0) + 2500).sort((a, b) => b.t - a.t)[0];
      if (!tg) return true;
      const a = e.animation || {};
      const key = tg._closeT && e.t >= tg._closeT - 50 ? 'closeMotion' : 'motion';
      tg.animation[key] = tg.animation[key] || [];
      tg.animation[key].push({ targets: (e.targets || []).slice(0, 4).map((t) => t.selector), properties: a.properties || a.name || a.channels, duration: a.duration, delay: a.delay, ease: a.ease, ease_bezier: a.ease_bezier, values: a.values, keyframes: a.keyframes });
      return false;
    });
  }
  // motion recorded right after a feedback click / during a drag belongs to it
  for (const [src, trig, win] of [['measured:click', 'click', 1500], ['measured:drag', 'drag', 3500]]) {
    const owners = all.filter((e) => e.source === src);
    if (!owners.length) continue;
    all = all.filter((e) => {
      if (e.source === src || e._kind === 'three') return true;
      // the dragged track itself (its back-and-forth can look like a loop) belongs to the drag
      const sameTarget = src === 'measured:drag' && owners.find((g) => (e.targets || []).some((t) => g.targets.some((gt) => (t.nid && t.nid === gt.nid) || (t.selector || '').startsWith(gt.selector))));
      if (e.trigger !== trig && !sameTarget) return true;
      const o = sameTarget || owners.filter((g) => e.t >= g.t - 50 && e.t <= g.t + win).sort((a, b) => b.t - a.t)[0];
      if (!o) return true;
      const a = e.animation || {};
      o.animation.motion = o.animation.motion || [];
      o.animation.motion.push({ targets: (e.targets || []).slice(0, 4).map((t) => t.selector), properties: a.properties || a.name || a.channels, duration: a.duration, delay: a.delay, ease: a.ease, ease_bezier: a.ease_bezier, values: a.values });
      return false;
    });
  }
  // press motion recorded on the pressed element / inside it
  const presses = all.filter((e) => e.source === 'measured:press');
  if (presses.length) {
    all = all.filter((e) => {
      if (e.source === 'measured:press' || e.trigger !== 'press') return true;
      const p = presses.find((x) => (e.targets || []).some((t) => (x.targets || []).some((pt) => pt.nid === t.nid || (t.selector || '').startsWith(pt.selector || '\u0000'))));
      if (!p) return true;
      p.animation.motion = p.animation.motion || [];
      p.animation.motion.push({ targets: (e.targets || []).slice(0, 4).map((t) => t.selector), duration: e.animation && e.animation.duration, ease: e.animation && e.animation.ease, values: e.animation && e.animation.values });
      return false;
    });
  }
  // "load" motion that started with the page scrolled far down is scroll-driven (header shown on scroll-up,
  // late reveals): verify it by scrolling there, not by waiting at the top
  const vh0 = (bp1440.viewport && bp1440.viewport.h) || 900;
  for (const e of all) if (e.trigger === 'load' && e.startScroll != null && e.startScroll > vh0 * 0.75 && e._kind !== 'three') e.trigger = 'scroll-enter';
  const comps = mediaCompositions(cap, ctx, all);
  if (comps.effects.length) {
    const absorbed = new Set(comps.effects.flatMap((c) => c._linked));
    all = all.filter((e) => !absorbed.has(e)).concat(comps.effects.map(({ _linked, ...c }) => c));
  }
  all = mergeSimilar(all);
  const scene = analyzeScene(cap, ctx, vh0);
  const sceneFx = sceneEffects(scene, ctx, vh0);
  if (sceneFx.length) {
    // text / border colours that follow the décor (inherited colour transitions) belong to the décor change
    const COLOR = /^(color|backgroundColor|background-color|borderColor|border-color|fill|stroke|borderTopColor|outlineColor)$/;
    const colorOnly = (e) => {
      const a = e.animation || {};
      const keys = a.values ? Object.keys(a.values) : a.keyframes ? [...new Set(a.keyframes.flatMap((k) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite'].includes(x))))] : a.name ? [a.name] : [];
      return keys.length && keys.every((k) => COLOR.test(k));
    };
    all = all.filter((e) => {
      if (e.trigger !== 'scroll-enter' && e.trigger !== 'load' && e.trigger !== 'scroll-scrub') return true;
      if (!colorOnly(e)) return true;
      // inherited colour jitter (a few RGB units) is noise, not motion
      const v = (e.animation || {}).values;
      if (v && Object.values(v).every((x) => x && typeof x.from === 'string' && rgbDist(cssHex(x.from), cssHex(x.to)) < 12)) return false;
      const y = e.startScroll != null ? e.startScroll : null;
      const owner = sceneFx.find((f) => y != null && y >= f.animation.startScroll - vh0 && y <= f.animation.endScroll + vh0) || (y == null ? sceneFx[0] : null);
      if (!owner) return true;
      owner.animation.follows = owner.animation.follows || [];
      if (owner.animation.follows.length < 12) owner.animation.follows.push({ targets: (e.targets || []).slice(0, 3).map((t) => t.selector), values: e.animation.values || e.animation.keyframes || e.animation.name, duration: e.animation.duration, ease: e.animation.ease });
      return false;
    });
  }
  all.push(...sceneFx);
  // Drop trivial measured noise: single-target, sub-50ms, tiny changes
  all = all.filter((e) => !(e._kind === 'recorder' && e.trigger !== 'scroll-scrub' && e.trigger !== 'time-loop' && e.trigger !== 'mouse-move' && e.animation && e.animation.duration != null && e.animation.duration < 0.05));
  // order: by section order then time
  const secIndex = new Map(sections.map((s, i) => [s.id, i]));
  all.sort((a, b) => (secIndex.get(a.section) ?? 999) - (secIndex.get(b.section) ?? 999) || (a.t || 0) - (b.t || 0));
  const usedIds = new Set();
  all.forEach((e, i) => {
    const secName = e.section && e.section !== 'global' ? e.section.replace(/^s\d+-/, '') : 'global';
    let id = 'e' + String(i + 1).padStart(2, '0') + '-' + slug(secName + '-' + e.effect_type.replace(/^(text|image)-/, ''));
    while (usedIds.has(id)) id += 'x';
    usedIds.add(id);
    e.id = id;
    e.complexity = complexityOf(e);
    e.libs = [...stackNames].filter((n) => ['gsap', 'scrolltrigger', 'splittext', 'lenis', 'locomotive-scroll', 'three', 'ogl', 'pixi', 'barba', 'swup', 'lottie', 'rive', 'framer-motion', 'split-type', 'splitting', 'customease', 'drawsvg', 'morphsvg', 'flip', 'scrollsmoother'].includes(n));
    e.perf_cost = e.technique && /webgl|three/.test(e.technique) ? 'high' : e.trigger === 'scroll-scrub' || e.trigger === 'mouse-move' ? 'medium' : 'low';
    const split = ctx.splits.find((s) => (e.targets || []).some((t) => (t.nid && (s.units || []).includes(t.nid)) || t.nid === s.nid));
    if (split) e.split = { type: split.type, nested: split.nested, count: split.count, mask: split.mask, container: split.selector, ariaLabel: !!split.ariaLabel };
    if (!e.curve && e.animation && e.animation.ease && e.trigger !== 'scroll-scrub') {
      try {
        e.curve = sampleEase(e.animation.ease, 40);
        e.curveSource = 'ease-function';
      } catch (err) {
        /* ignore */
      }
    }
  });

  const webgl = analyzeWebGL(cap, ctx);
  const scroll = analyzeScroll(cap);
  const roles = typographyRoles(cap);
  const tokens = w3cTokens(cap, roles);

  const analysis = {
    analyzerVersion: ANALYZER_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    url: cap.meta && cap.meta.url,
    sections,
    effects: all.map(({ _m, _kind, _closeT, t, ...rest }) => ({ ...rest, kind: _kind, t })),
    scene,
    compositions: comps.compositions,
    scroll,
    typography: roles,
    tokens,
    webgl,
    stack: cap.stack || [],
    intro: cap.intro || null,
    splits: ctx.splits.map(({ units, ...s }) => s),
    reducedMotion: !!(cap.reducedMotion && cap.reducedMotion.handled),
    log,
  };
  analysis.tier = estimateTier(analysis, cap);
  analysis.unexplained = [];
  // canvases with no captured programs = opaque blocks
  for (const c of (cap.webgl && cap.webgl.contexts) || []) {
    if (/webgl/.test(c.type) && !(cap.webgl.programs || []).some((p) => p.cid === c.cid)) analysis.unexplained.push({ kind: 'webgl-canvas-without-shader', canvas: c.canvas });
  }
  for (const f of (cap.assets && cap.assets.frames) || []) if (f.crossOrigin) analysis.unexplained.push({ kind: 'cross-origin-iframe', src: f.src });
  analysis.risks = risksOf(analysis, cap);
  analysis.complexity = Math.min(5, Math.round(1 + analysis.effects.length / 12 + (analysis.tier.tier === 'A' ? 0 : analysis.tier.tier === 'B' ? 1 : 2)));
  return analysis;
}

function risksOf(a, cap) {
  const r = [];
  const low = a.effects.filter((e) => e.confidence < 0.6);
  if (low.length) r.push(`${low.length} effect(s) with confidence < 0.6 (measured only): ${low.slice(0, 6).map((e) => e.id).join(', ')}`);
  if (!a.stack.some((s) => s.name === 'gsap' && s.confidence === 1) && a.stack.some((s) => s.name === 'gsap')) r.push('GSAP is bundled and not exposed: animation values were measured by the recorder, not read.');
  if (a.webgl.cards.length) r.push(`${a.webgl.cards.length} WebGL program(s): shaders must be re-implemented from the shader cards.`);
  if (a.webgl.three) r.push('Three.js scene: proprietary models/textures must be replaced by equivalents.');
  const imgs = (cap.assets && cap.assets.images) || [];
  if (imgs.length) r.push(`${imgs.length} images and ${((cap.assets && cap.assets.videos) || []).length} videos are proprietary: use placeholders of identical dimensions (masked in visual scoring).`);
  const fonts = (cap.tokens && cap.tokens.fontFaces) || [];
  if (fonts.length) r.push(`Custom fonts (${[...new Set(fonts.map((f) => f.family))].slice(0, 5).join(', ')}): use the original files only in study mode; otherwise pick a free font with close metrics.`);
  for (const u of a.unexplained) r.push(`Unexplained: ${u.kind}${u.src ? ' ' + u.src : ''}`);
  if (cap.log && cap.log.some((l) => l.level === 'error')) r.push('Some scan steps failed (see raw/scan-log.json).');
  return r;
}

export { sectionFor, pearson, measureTrack, analyze3DMotion, analyzeScene };
