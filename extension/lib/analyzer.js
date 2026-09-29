// DIP analyzer: raw capture -> structured analysis (sections, effects, tokens, scroll, webgl, tier).
// Pure JS, no browser API: runs in the side panel and in Node (dev runner / tests).
import { fitEase, easeFn, bezierFor, normalizeEaseName, sampleEase } from './easing.js';
import { TAXONOMY_VERSION, isKnownType } from './taxonomy.js';

export const ANALYZER_VERSION = '0.1.0';

const GSAP_SPECIAL = new Set(['duration', 'delay', 'ease', 'stagger', 'repeat', 'yoyo', 'yoyoEase', 'repeatDelay', 'scrollTrigger', 'paused', 'overwrite', 'immediateRender', 'id', 'callbackScope', 'lazy', 'inherit', 'data', 'runBackwards', 'startAt', 'keyframes', 'defaults', 'smoothChildTiming', 'autoRemoveChildren', 'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'reversed', 'force3D', 'transformOrigin', 'clearProps', 'modifiers', 'snap']);

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

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
    let trigger = scrollTl ? 'scroll-scrub' : tm.iterations === 'Infinity' || tm.iterations === Infinity || tm.iterations > 50 ? 'time-loop' : phase === 'manual' ? ctx.manualTrigger(a.t) : phase === 'hover' ? 'hover' : phase === 'scroll' ? 'scroll-enter' : 'load';
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
        stagger: staggerFromDelay ? r3(staggerFromDelay / 1000) : distinct.length > 1 ? r3(median(starts.slice(1).map((t, i) => t - starts[i])) / 1000) : undefined,
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
  const corrMx = Math.abs(pearson(tk.mx, v));
  const corrMy = Math.abs(pearson(tk.my, v));
  const isFixed = tk.position === 'fixed';
  if (isFixed && (corrMx > 0.9 || corrMy > 0.9) && mouseRatio > 0.6) return { driver: 'mouse', follow: true, corrMx: r2(corrMx), corrMy: r2(corrMy) };
  // loop: keeps changing across phases without scroll or mouse
  const segs = segmentsOf(tk, main.ch, 150);
  const longest = segs.reduce((a, s) => Math.max(a, tk.t[s.end] - tk.t[s.start]), 0);
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
  const main = chans.find((c) => c.ch !== 'clip' && c.ch !== 'filter') || chans[0];
  const drv = classifyDriver(tk, main, ctx);
  const m = { nid: tk.nid, selector: tk.sel, tag: tk.tag, text: tk.text, rect0: tk.rect0, parentNid: tk.parentNid, parentSel: tk.parentSel, index: tk.index, isMedia: tk.isMedia, position: tk.position, channels: chans.map((c) => c.name), driver: drv.driver, driverInfo: drv };
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
      if (c.ch === 'clip' || c.ch === 'filter') continue;
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
    for (const c of chans) if (c.ch !== 'clip' && c.ch !== 'filter') m.values[c.name] = { min: c.min, max: c.max };
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
    for (const c of chans) if (c.ch !== 'clip' && c.ch !== 'filter') m.values[c.name] = { min: c.min, max: c.max };
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
    const trigger = m0.driver === 'scroll' ? 'scroll-scrub' : m0.driver === 'mouse' ? 'mouse-move' : m0.driver === 'loop' ? 'time-loop' : m0.phase === 'manual' ? ctx.manualTrigger(m0.start) : m0.phase === 'hover' ? 'hover' : m0.phase === 'scroll' ? 'scroll-enter' : 'load';
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
      animation: { changes: h.diff.slice(0, 20), transition: h.transition, props, magnetic: h.magnetic || undefined },
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
  if (split && e.trigger !== 'hover') return split.type === 'chars' ? 'text-reveal-chars' : split.type === 'words' ? 'text-reveal-words' : 'text-reveal-lines';
  if (/\.(lines?|words?|chars?|split[\w-]*)\b/.test(tSels) && /ypercent|"y"|translatey|opacity/.test(propsStr) && e.trigger !== 'hover') {
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
  if (meshes > 3 || (three && three.scenes.some((s) => s.objects.some((o) => o.geometry && o.geometry.vertices > 5000)))) return { tier: 'C', why: `Three.js scene with ${meshes} meshes / models` };
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
    if (w.trigger !== 'hover' || w.technique !== 'css-transition') return true;
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
  let all = [...gsapFx, ...waapiKept, ...recFx, ...hoverFx];

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
  }
  all = mergeSimilar(all);
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
    effects: all.map(({ _m, _kind, t, ...rest }) => ({ ...rest, kind: _kind, t })),
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

export { sectionFor, pearson, measureTrack };
