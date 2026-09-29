/*
 * DIP — Design Intelligence Pipeline
 * Page probes. Injected in the MAIN world at document_start, before any page script.
 *
 * Golden rules (spec §4.3, §17.1):
 *  - never throw into the page: every hook is wrapped in try/catch;
 *  - always call the original native function;
 *  - patched functions keep name, length and toString();
 *  - never read form values, cookies or localStorage.
 *
 * Everything is exposed on a non-enumerable `window.__DIP__` object that the
 * scan orchestrator drives (via CDP Runtime.evaluate, chrome.scripting or Playwright).
 */
(function () {
  'use strict';
  if (window.__DIP__) return;

  const VERSION = '0.1.0';
  const W = window;
  const D = document;
  const now = () => performance.now();
  const T0 = now();

  // ---------------------------------------------------------------- natives
  const N = {
    rAF: W.requestAnimationFrame.bind(W),
    setTimeout: W.setTimeout.bind(W),
    clearTimeout: W.clearTimeout.bind(W),
    setInterval: W.setInterval.bind(W),
    getCS: W.getComputedStyle.bind(W),
    addEL: EventTarget.prototype.addEventListener,
    fnToString: Function.prototype.toString,
    defineProperty: Object.defineProperty,
    qsa: Document.prototype.querySelectorAll,
    MO: W.MutationObserver,
    fetch: W.fetch ? W.fetch.bind(W) : null,
  };

  // ---------------------------------------------------------------- journal
  const journal = {
    errors: [],
    events: [], // generic timestamped events {t,s,mx,my,type,data}
    marks: [], // phase marks from the orchestrator
    error(src, e) {
      if (this.errors.length < 200) this.errors.push({ t: rel(), src, msg: String((e && e.message) || e) });
    },
    push(type, data) {
      if (this.events.length < 20000) this.events.push({ t: rel(), s: scrollPos(), mx: mouse.x, my: mouse.y, type, data });
    },
  };
  const rel = () => Math.round((now() - T0) * 10) / 10; // ms since probes start
  const mouse = { x: -1, y: -1 };

  function safe(src, fn) {
    return function () {
      try {
        return fn.apply(this, arguments);
      } catch (e) {
        journal.error(src, e);
      }
    };
  }

  // Keep name / length / toString of patched natives.
  const disguised = new WeakMap();
  function preserveNative(patched, orig) {
    try {
      N.defineProperty(patched, 'name', { value: orig.name, configurable: true });
      N.defineProperty(patched, 'length', { value: orig.length, configurable: true });
      disguised.set(patched, orig);
    } catch (e) {
      journal.error('preserveNative', e);
    }
    return patched;
  }
  (function patchToString() {
    const orig = N.fnToString;
    const patched = function toString() {
      const target = disguised.has(this) ? disguised.get(this) : this;
      return orig.call(target);
    };
    disguised.set(patched, orig);
    try {
      N.defineProperty(patched, 'name', { value: 'toString', configurable: true });
      N.defineProperty(patched, 'length', { value: 0, configurable: true });
      Function.prototype.toString = patched;
    } catch (e) {
      journal.error('toString', e);
    }
  })();

  function wrapMethod(obj, name, makeWrapper) {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== 'function' || orig.__dipWrapped) return;
      const w = makeWrapper(orig);
      preserveNative(w, orig);
      N.defineProperty(w, '__dipWrapped', { value: true });
      const desc = Object.getOwnPropertyDescriptor(obj, name);
      if (desc && !desc.writable && !desc.set && !desc.configurable) return;
      if (desc && 'value' in desc) N.defineProperty(obj, name, { ...desc, value: w });
      else obj[name] = w;
    } catch (e) {
      journal.error('wrap:' + name, e);
    }
  }

  // ---------------------------------------------------------------- ids & selectors
  let nidSeq = 0;
  const nids = new WeakMap();
  const byNid = new Map();
  function nid(el) {
    if (!el || el.nodeType !== 1) return null;
    let id = nids.get(el);
    if (!id) {
      id = 'n' + ++nidSeq;
      nids.set(el, id);
      byNid.set(id, new WeakRef(el));
    }
    return id;
  }
  const HASHED = /(^|[-_])[a-zA-Z0-9]*\d[a-zA-Z0-9]{4,}$|^(css|sc|jsx|svelte|emotion|tw)-|^_[a-zA-Z0-9]{5,}$|__[a-zA-Z0-9-]{5,}$|^[a-z]{1,3}[A-Z0-9][a-zA-Z0-9]{4,}$/;
  const GENERATED_ID = /^\d|^[a-z]+-\d+$|^:r[0-9a-z]+:$|^radix-|^headlessui-/i;
  function goodClasses(el) {
    const out = [];
    const cl = el.classList || [];
    for (let i = 0; i < cl.length && out.length < 3; i++) {
      const c = cl[i];
      if (c.length > 40 || HASHED.test(c) || /[:[\]/!@.]/.test(c)) continue;
      if (/^(is|has)-|^(active|visible|inview|in-view|loaded|animated)$/.test(c)) continue;
      out.push(c);
    }
    return out;
  }
  function cssEsc(s) {
    return W.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }
  function isUnique(sel) {
    try {
      return D.querySelectorAll(sel).length === 1;
    } catch (e) {
      return false;
    }
  }
  const selCache = new WeakMap();
  function selector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (selCache.has(el)) return selCache.get(el);
    let sel = null;
    try {
      if (el === D.documentElement) sel = 'html';
      else if (el === D.body) sel = 'body';
      else if (el.id && !HASHED.test(el.id) && !GENERATED_ID.test(el.id) && isUnique('#' + cssEsc(el.id))) sel = '#' + cssEsc(el.id);
      else {
        for (const a of el.attributes) {
          if (/^data-(testid|test|section|scroll-section|id|name|component|block|anim|animation|split|module)$/.test(a.name) && a.value && a.value.length < 40) {
            const s = `${el.localName}[${a.name}="${a.value.replace(/"/g, '\\"')}"]`;
            if (isUnique(s)) {
              sel = s;
              break;
            }
          }
        }
        if (!sel) {
          const parts = [];
          let cur = el;
          for (let depth = 0; cur && cur.nodeType === 1 && depth < 5; depth++) {
            if (cur === D.body) {
              parts.unshift('body');
              break;
            }
            if (cur.id && !HASHED.test(cur.id) && !GENERATED_ID.test(cur.id)) {
              parts.unshift('#' + cssEsc(cur.id));
              break;
            }
            let part = cur.localName;
            const gc = goodClasses(cur);
            if (gc.length) part += '.' + gc.map(cssEsc).join('.');
            const parent = cur.parentElement;
            if (parent) {
              const same = Array.prototype.filter.call(parent.children, (c) => c.localName === cur.localName);
              if (same.length > 1 && !gc.length) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
              else if (same.length > 1) {
                const sameCls = same.filter((c) => gc.every((k) => c.classList.contains(k)));
                if (sameCls.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
              }
            }
            parts.unshift(part);
            const candidate = parts.join(' > ');
            if (isUnique(candidate)) {
              sel = candidate;
              break;
            }
            cur = parent;
          }
          if (!sel) sel = parts.join(' > ');
        }
      }
    } catch (e) {
      journal.error('selector', e);
    }
    selCache.set(el, sel);
    return sel;
  }
  function describeTargets(t) {
    try {
      if (t == null) return [];
      if (typeof t === 'string') {
        let els = [];
        try {
          els = Array.from(D.querySelectorAll(t)).slice(0, 50);
        } catch (e) {
          /* invalid selector */
        }
        return els.length ? els.map((x) => ({ selector: selector(x), nid: nid(x), query: t })) : [{ selector: t }];
      }
      const arr = t.length !== undefined && typeof t !== 'function' && !(t instanceof Element) ? Array.from(t) : [t];
      return arr.slice(0, 50).map((x) =>
        x && x.nodeType === 1 ? { selector: selector(x), nid: nid(x) } : typeof x === 'string' ? { selector: x } : x && typeof x.totalDuration === 'function' && typeof x.progress === 'function' ? { gsapAnimation: true } : { object: (x && x.constructor && x.constructor.name) || typeof x, keys: x && typeof x === 'object' ? Object.keys(x).slice(0, 8) : null }
      );
    } catch (e) {
      return [];
    }
  }

  // ---------------------------------------------------------------- scroll position
  let scrollContainer = null; // for transform-based smooth scroll (Locomotive v4)
  function scrollPos() {
    try {
      const y = W.scrollY || D.documentElement.scrollTop || 0;
      if (y || !scrollContainer) return Math.round(y);
      const m = new DOMMatrixReadOnly(N.getCS(scrollContainer).transform === 'none' ? undefined : N.getCS(scrollContainer).transform);
      return Math.round(-m.m42);
    } catch (e) {
      return 0;
    }
  }

  N.addEL.call(
    W,
    'pointermove',
    (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { capture: true, passive: true }
  );
  N.addEL.call(
    W,
    'pointerdown',
    (e) => {
      try {
        journal.push('click', { target: selector(e.target), nid: nid(e.target) });
      } catch (err) {
        /* ignore */
      }
    },
    { capture: true, passive: true }
  );
  N.addEL.call(
    W,
    'mousemove',
    (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    },
    { capture: true, passive: true }
  );

  // ---------------------------------------------------------------- sanitizing
  function sanitize(v, depth) {
    depth = depth || 0;
    if (v == null) return v;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : String(v);
    if (t === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
    if (t === 'boolean') return v;
    if (t === 'function') return v.__dipEaseName || (v.name ? `[function ${v.name}]` : '[function]');
    if (v.nodeType === 1) return { selector: selector(v), nid: nid(v) };
    if (depth > 3) return '[object]';
    if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitize(x, depth + 1));
    if (t === 'object') {
      if (v.length !== undefined && v[0] && v[0].nodeType === 1) return describeTargets(v);
      const o = {};
      let n = 0;
      for (const k in v) {
        if (n++ > 40) break;
        if (k.startsWith('_')) continue;
        try {
          o[k] = sanitize(v[k], depth + 1);
        } catch (e) {
          /* ignore */
        }
      }
      return o;
    }
    return String(v);
  }

  // ================================================================ P1 — stack detection (traps)
  const traps = {}; // name -> value when assigned
  function trapGlobal(name, onSet) {
    try {
      const existing = Object.getOwnPropertyDescriptor(W, name);
      if (existing && !existing.configurable) return;
      let value = existing ? existing.value : undefined;
      N.defineProperty(W, name, {
        configurable: true,
        enumerable: false,
        get() {
          return value;
        },
        set(v) {
          value = v;
          traps[name] = { t: rel() };
          try {
            if (v && onSet) onSet(v);
          } catch (e) {
            journal.error('trap:' + name, e);
          }
        },
      });
      if (value && onSet) onSet(value);
    } catch (e) {
      journal.error('trapGlobal:' + name, e);
    }
  }

  // ================================================================ P4a — GSAP
  const gsapLog = { calls: [], plugins: [], scrollTriggerCreates: [], instance: null, ST: null };
  const tlIds = new WeakMap();
  let tlSeq = 0;
  function tlId(tl) {
    if (!tl || typeof tl !== 'object') return null;
    if (!tlIds.has(tl)) tlIds.set(tl, 'tl' + ++tlSeq);
    return tlIds.get(tl);
  }
  let gsapDepth = 0; // >0 while inside a wrapped GSAP call: nested (internal) calls are not user calls
  function recordGsapCall(method, args, tl, result) {
    if (gsapLog.calls.length > 3000) return;
    if (gsapDepth > 0) return;
    try {
      const a = Array.from(args);
      const entry = { t: rel(), s: scrollPos(), method };
      if (tl) entry.tl = tlId(tl);
      if (method === 'timeline' && result) entry.tl = tlId(result);
      const lm = journal.marks[journal.marks.length - 1];
      entry.phase = lm ? lm.name : 'load';
      if (method === 'timeline') entry.vars = sanitize(a[0]);
      else if (method === 'fromTo') {
        entry.targets = describeTargets(a[0]);
        entry.fromVars = sanitize(a[1]);
        entry.vars = sanitize(a[2]);
        entry.position = sanitize(a[3]);
      } else {
        entry.targets = describeTargets(a[0]);
        entry.vars = sanitize(a[1]);
        entry.position = sanitize(a[2]);
      }
      gsapLog.calls.push(entry);
    } catch (e) {
      journal.error('gsap:record', e);
    }
  }
  function instrumentST(ST) {
    if (!ST || ST.__dipDone) return;
    try {
      N.defineProperty(ST, '__dipDone', { value: true });
    } catch (e) {
      /* frozen */
    }
    gsapLog.ST = ST;
    wrapMethod(ST, 'create', (orig) =>
      function create(vars) {
        try {
          if (gsapLog.scrollTriggerCreates.length < 1000 && gsapDepth === 0) gsapLog.scrollTriggerCreates.push({ t: rel(), vars: sanitize(vars) });
        } catch (e) {
          journal.error('st:create', e);
        }
        gsapDepth++;
        try {
          return orig.apply(this, arguments);
        } finally {
          gsapDepth--;
        }
      }
    );
  }
  function instrumentGSAP(g) {
    if (!g || g.__dipDone || typeof g.to !== 'function') return;
    try {
      N.defineProperty(g, '__dipDone', { value: true });
    } catch (e) {
      /* frozen */
    }
    gsapLog.instance = g;
    for (const m of ['to', 'from', 'fromTo', 'set', 'timeline']) {
      wrapMethod(g, m, (orig) =>
        function () {
          if (m !== 'timeline') recordGsapCall(m, arguments);
          gsapDepth++;
          let r;
          try {
            r = orig.apply(this, arguments);
          } finally {
            gsapDepth--;
          }
          if (m === 'timeline') recordGsapCall(m, arguments, null, r);
          return r;
        }
      );
    }
    try {
      const TL = g.core && g.core.Timeline && g.core.Timeline.prototype;
      if (TL) {
        for (const m of ['to', 'from', 'fromTo', 'set']) {
          wrapMethod(TL, m, (orig) =>
            function () {
              recordGsapCall('tl.' + m, arguments, this);
              gsapDepth++;
              try {
                return orig.apply(this, arguments);
              } finally {
                gsapDepth--;
              }
            }
          );
        }
      }
    } catch (e) {
      journal.error('gsap:tl', e);
    }
    wrapMethod(g, 'registerPlugin', (orig) =>
      function () {
        try {
          for (const p of arguments) {
            const name = (p && (p.name || (p.prototype && p.prototype.constructor && p.prototype.constructor.name))) || 'unknown';
            if (name && name.length > 2 && !/^(css|CSSPlugin|attr|endArray|roundProps|modifiers|snap)$/i.test(name)) gsapLog.plugins.push(name);
            if (p && (name === 'ScrollTrigger' || (typeof p.create === 'function' && typeof p.getAll === 'function'))) instrumentST(p);
          }
        } catch (e) {
          journal.error('gsap:registerPlugin', e);
        }
        return orig.apply(this, arguments);
      }
    );
  }
  trapGlobal('gsap', instrumentGSAP);
  trapGlobal('ScrollTrigger', instrumentST);

  // ================================================================ Three.js devtools hook
  const three = { scenes: new Set(), renderers: new Set(), lastCamera: null, cameraOf: new WeakMap() };
  (function threeHook() {
    try {
      if (W.__THREE_DEVTOOLS__) return;
      const dt = new EventTarget();
      N.defineProperty(W, '__THREE_DEVTOOLS__', { value: dt, configurable: true, writable: true });
      dt.addEventListener('observe', (e) => {
        try {
          const o = e.detail;
          if (!o) return;
          if (o.isScene) three.scenes.add(o);
          if (o.isWebGLRenderer || o.isWebGPURenderer) {
            three.renderers.add(o);
            wrapMethod(o, 'render', (orig) =>
              function (scene, camera) {
                if (camera) three.lastCamera = camera;
                if (scene && scene.isScene) {
                  three.scenes.add(scene);
                  if (camera) three.cameraOf.set(scene, camera);
                }
                return orig.apply(this, arguments);
              }
            );
          }
        } catch (err) {
          journal.error('three:observe', err);
        }
      });
    } catch (e) {
      journal.error('three', e);
    }
  })();

  // ================================================================ P4b — WAAPI
  const waapi = { animateCalls: [], seen: new Map(), events: [] };
  wrapMethod(Element.prototype, 'animate', (orig) =>
    function animate(keyframes, options) {
      try {
        if (waapi.animateCalls.length < 2000)
          waapi.animateCalls.push({ t: rel(), s: scrollPos(), target: selector(this), nid: nid(this), keyframes: sanitize(keyframes), options: sanitize(options) });
        if (rec.on) {
          const tk = track(this);
          if (tk && !tk.t.length) sampleTrack(tk, this, N.getCS(this), rel(), scrollPos());
        }
      } catch (e) {
        journal.error('animate', e);
      }
      return orig.apply(this, arguments);
    }
  );
  let animSeq = 0;
  const animIds = new WeakMap();
  function sampleAnimations() {
    try {
      if (!D.getAnimations) return;
      for (const a of D.getAnimations()) {
        let id = animIds.get(a);
        if (id && waapi.seen.has(id)) continue;
        if (waapi.seen.size > 1500) return;
        id = 'a' + ++animSeq;
        animIds.set(a, id);
        const eff = a.effect;
        const target = eff && eff.target;
        let timing = {};
        try {
          timing = eff ? eff.getTiming() : {};
        } catch (e) {
          /* ignore */
        }
        let keyframes = [];
        try {
          keyframes = eff && eff.getKeyframes ? eff.getKeyframes() : [];
        } catch (e) {
          /* ignore */
        }
        const tl = a.timeline;
        const tlType = tl ? tl.constructor.name : 'none';
        waapi.seen.set(id, {
          id,
          t: rel(),
          s: scrollPos(),
          type: a.constructor.name,
          name: a.animationName || a.transitionProperty || a.id || null,
          target: target ? selector(target) : null,
          pseudo: eff && eff.pseudoElement,
          nid: target ? nid(target) : null,
          timing: sanitize(timing),
          keyframes: sanitize(keyframes),
          timeline: tlType,
          rangeStart: sanitize(a.rangeStart),
          rangeEnd: sanitize(a.rangeEnd),
        });
      }
    } catch (e) {
      journal.error('getAnimations', e);
    }
  }
  for (const evt of ['transitionrun', 'animationstart']) {
    N.addEL.call(
      D,
      evt,
      (e) => {
        if (waapi.events.length < 3000)
          waapi.events.push({ t: rel(), s: scrollPos(), type: evt, target: selector(e.target), nid: nid(e.target), prop: e.propertyName || e.animationName });
      },
      { capture: true, passive: true }
    );
  }

  // ================================================================ P7 — listeners & routing
  const listeners = { hoverEls: new Set(), global: {}, wheelTargets: 0 };
  const HOVER_EVTS = new Set(['mouseenter', 'mouseover', 'pointerenter', 'pointerover', 'mousemove', 'pointermove', 'mouseleave']);
  wrapMethod(EventTarget.prototype, 'addEventListener', (orig) =>
    function addEventListener(type) {
      try {
        if (HOVER_EVTS.has(type)) {
          if (this === W || this === D || this === D.documentElement || this === D.body) listeners.global[type] = (listeners.global[type] || 0) + 1;
          else if (this && this.nodeType === 1 && listeners.hoverEls.size < 2000) listeners.hoverEls.add(new WeakRef(this));
        } else if (type === 'wheel') listeners.wheelTargets++;
      } catch (e) {
        /* never break */
      }
      return orig.apply(this, arguments);
    }
  );
  const routes = [];
  for (const m of ['pushState', 'replaceState']) {
    wrapMethod(History.prototype, m, (orig) =>
      function () {
        try {
          if (routes.length < 200) routes.push({ t: rel(), method: m, url: String(arguments[2] || '') });
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      }
    );
  }

  // ================================================================ P6 — WebGL / Canvas / WebGPU
  const gl = {
    contexts: [], // {cid, type, canvas}
    programs: [],
    uniforms: new Map(), // key pid|name -> {pid,name,type,samples:[]}
    textures: [],
    drawCalls: 0,
    drawCallsPerFrame: [],
    verticesMax: 0,
    canvas2d: new Map(),
    wgsl: [],
  };
  const ctxInfo = new WeakMap(); // ctx -> {cid}
  const shaderInfo = new WeakMap(); // shader -> {type, src}
  const programInfo = new WeakMap(); // program -> {pid, shaders:[]}
  const locInfo = new WeakMap(); // location -> {pid, name}
  const currentProgram = new WeakMap(); // ctx -> program info
  let pidSeq = 0;
  let cidSeq = 0;
  function canvasInfo(c) {
    try {
      if (c && c.nodeType === 1) {
        const r = c.getBoundingClientRect();
        return { selector: selector(c), nid: nid(c), width: c.width, height: c.height, rect: { x: r.x, y: r.y + scrollPos(), w: r.width, h: r.height } };
      }
      return { offscreen: true, width: c && c.width, height: c && c.height };
    } catch (e) {
      return {};
    }
  }
  let ownCanvas = null;
  function onContext(ctx, type, canvas) {
    if (!ctx || ctxInfo.has(ctx) || canvas === ownCanvas) return;
    const cid = 'c' + ++cidSeq;
    ctxInfo.set(ctx, { cid, type });
    if (gl.contexts.length < 50) gl.contexts.push({ cid, type, t: rel(), canvas: canvasInfo(canvas) });
    if (type === '2d') gl.canvas2d.set(cid, { cid, calls: {} });
  }
  function patchGetContext(proto) {
    wrapMethod(proto, 'getContext', (orig) =>
      function getContext(type) {
        const ctx = orig.apply(this, arguments);
        try {
          if (ctx && typeof type === 'string') onContext(ctx, type === 'experimental-webgl' ? 'webgl' : type, this);
        } catch (e) {
          journal.error('getContext', e);
        }
        return ctx;
      }
    );
  }
  if (W.HTMLCanvasElement) patchGetContext(HTMLCanvasElement.prototype);
  if (W.OffscreenCanvas) patchGetContext(OffscreenCanvas.prototype);

  function uniformRecorder(kind) {
    return (orig) =>
      function (loc) {
        const r = orig.apply(this, arguments);
        try {
          const li = loc && locInfo.get(loc);
          if (li) {
            const key = li.pid + '|' + li.name;
            let u = gl.uniforms.get(key);
            if (!u) {
              if (gl.uniforms.size > 400) return r;
              u = { pid: li.pid, name: li.name, kind, samples: [], last: null, lastT: -1e9, count: 0 };
              gl.uniforms.set(key, u);
            }
            u.count++;
            const vals = [];
            for (let i = 1; i < arguments.length; i++) {
              const a = arguments[i];
              if (typeof a === 'number' || typeof a === 'boolean') vals.push(+a);
              else if (a && a.length !== undefined && a.length <= 16) for (let j = 0; j < a.length; j++) vals.push(a[j]);
              else if (a && a.length) vals.push('len:' + a.length);
            }
            const sig = vals.join(',');
            const t = now();
            if (sig !== u.last && t - u.lastT > 33 && u.samples.length < 400) {
              u.samples.push({ t: rel(), s: scrollPos(), mx: mouse.x, my: mouse.y, v: vals.map((x) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x)) });
              u.last = sig;
              u.lastT = t;
            }
          }
        } catch (e) {
          /* hot path: swallow */
        }
        return r;
      };
  }
  function patchGLProto(P) {
    if (!P) return;
    wrapMethod(P, 'createShader', (orig) =>
      function (type) {
        const sh = orig.apply(this, arguments);
        try {
          if (sh) shaderInfo.set(sh, { type: type === this.VERTEX_SHADER ? 'vertex' : 'fragment', src: '' });
        } catch (e) {
          /* ignore */
        }
        return sh;
      }
    );
    wrapMethod(P, 'shaderSource', (orig) =>
      function (sh, src) {
        try {
          const i = shaderInfo.get(sh) || { type: 'unknown' };
          i.src = String(src || '').slice(0, 200000);
          shaderInfo.set(sh, i);
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      }
    );
    wrapMethod(P, 'attachShader', (orig) =>
      function (prog, sh) {
        try {
          let pi = programInfo.get(prog);
          if (!pi) {
            pi = { pid: 'p' + ++pidSeq, shaders: [] };
            programInfo.set(prog, pi);
          }
          pi.shaders.push(sh);
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      }
    );
    wrapMethod(P, 'linkProgram', (orig) =>
      function (prog) {
        const r = orig.apply(this, arguments);
        try {
          const pi = programInfo.get(prog);
          if (pi && !pi.recorded && gl.programs.length < 100) {
            pi.recorded = true;
            const ci = ctxInfo.get(this) || {};
            const rec = { pid: pi.pid, cid: ci.cid, t: rel(), vertex: '', fragment: '' };
            for (const sh of pi.shaders) {
              const si = shaderInfo.get(sh);
              if (si) rec[si.type === 'vertex' ? 'vertex' : 'fragment'] = si.src;
            }
            gl.programs.push(rec);
          }
        } catch (e) {
          journal.error('linkProgram', e);
        }
        return r;
      }
    );
    wrapMethod(P, 'getUniformLocation', (orig) =>
      function (prog, name) {
        const loc = orig.apply(this, arguments);
        try {
          const pi = programInfo.get(prog);
          if (loc && pi) locInfo.set(loc, { pid: pi.pid, name: String(name) });
        } catch (e) {
          /* ignore */
        }
        return loc;
      }
    );
    wrapMethod(P, 'useProgram', (orig) =>
      function (prog) {
        try {
          currentProgram.set(this, programInfo.get(prog));
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      }
    );
    const U = ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniform2i', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv', 'uniformMatrix3fv', 'uniformMatrix4fv'];
    for (const u of U) wrapMethod(P, u, uniformRecorder(u));
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      wrapMethod(P, m, (orig) =>
        function (mode, a, b) {
          gl.drawCalls++;
          try {
            const count = m.startsWith('drawArrays') ? b : a;
            if (count > gl.verticesMax) gl.verticesMax = count;
          } catch (e) {
            /* ignore */
          }
          return orig.apply(this, arguments);
        }
      );
    }
    for (const m of ['texImage2D', 'texSubImage2D']) {
      wrapMethod(P, m, (orig) =>
        function () {
          try {
            if (gl.textures.length < 200) {
              const src = arguments[arguments.length - 1];
              let d = null;
              if (src && src.nodeType === 1) {
                if (src.localName === 'img') d = { kind: 'image', url: src.currentSrc || src.src, w: src.naturalWidth, h: src.naturalHeight };
                else if (src.localName === 'video') d = { kind: 'video', url: src.currentSrc || src.src, w: src.videoWidth, h: src.videoHeight };
                else if (src.localName === 'canvas') d = { kind: 'canvas', w: src.width, h: src.height };
              } else if (W.ImageBitmap && src instanceof ImageBitmap) d = { kind: 'bitmap', w: src.width, h: src.height };
              if (d && !gl.textures.some((x) => x.url && x.url === d.url && x.kind === d.kind)) {
                d.t = rel();
                d.method = m;
                d.cid = (ctxInfo.get(this) || {}).cid;
                gl.textures.push(d);
              }
            }
          } catch (e) {
            /* ignore */
          }
          return orig.apply(this, arguments);
        }
      );
    }
  }
  if (W.WebGLRenderingContext) patchGLProto(WebGLRenderingContext.prototype);
  if (W.WebGL2RenderingContext) patchGLProto(WebGL2RenderingContext.prototype);
  if (W.CanvasRenderingContext2D) {
    for (const m of ['drawImage', 'fillText', 'arc', 'fillRect', 'lineTo', 'putImageData', 'bezierCurveTo']) {
      wrapMethod(CanvasRenderingContext2D.prototype, m, (orig) =>
        function () {
          try {
            const ci = ctxInfo.get(this);
            const c = ci && gl.canvas2d.get(ci.cid);
            if (c) c.calls[m] = (c.calls[m] || 0) + 1;
          } catch (e) {
            /* ignore */
          }
          return orig.apply(this, arguments);
        }
      );
    }
  }
  if (W.GPUDevice) {
    wrapMethod(GPUDevice.prototype, 'createShaderModule', (orig) =>
      function (desc) {
        try {
          if (gl.wgsl.length < 50) gl.wgsl.push({ t: rel(), code: String((desc && desc.code) || '').slice(0, 200000) });
        } catch (e) {
          /* ignore */
        }
        return orig.apply(this, arguments);
      }
    );
  }

  // ================================================================ P4c — class mutations
  const mutations = { classes: [], childList: 0, lastActivity: now(), count: 0, nonStyle: 0 };
  let mo = null;
  function startMO() {
    try {
      mo = new N.MO((list) => {
        mutations.lastActivity = now();
        for (const m of list) {
          mutations.count++;
          // stability signal: class / data-* changes only (style writes and DOM churn from tickers are not "settling")
          if (m.type === 'attributes' && m.attributeName !== 'style') mutations.nonStyle++;
          if (m.type === 'childList') {
            mutations.childList++;
            continue;
          }
          const el = m.target;
          if (m.attributeName === 'style') {
            // JS animation libs write inline styles: start tracking at the very first write.
            if (rec.on && !rec.tracked.has(nids.get(el)) && el.nodeType === 1) {
              const st = (el.getAttribute('style') || '') + '|' + (m.oldValue || '');
              if (/transform|translate|scale|rotate|opacity|clip-path|filter/.test(st)) {
                const tk = track(el);
                if (tk) sampleTrack(tk, el, N.getCS(el), rel(), scrollPos());
              }
            }
            continue;
          }
          if (mutations.classes.length > 6000) continue;
          if (m.attributeName === 'class' && rec.on) watchSubtree(el);
          if (m.attributeName === 'class') {
            const old = new Set((m.oldValue || '').split(/\s+/).filter(Boolean));
            const cur = new Set(Array.from(el.classList || []));
            const added = [...cur].filter((c) => !old.has(c));
            const removed = [...old].filter((c) => !cur.has(c));
            if (added.length || removed.length) mutations.classes.push({ t: rel(), s: scrollPos(), sel: selector(el), nid: nid(el), added, removed });
          } else if (m.attributeName && m.attributeName.startsWith('data-')) {
            mutations.classes.push({ t: rel(), s: scrollPos(), sel: selector(el), nid: nid(el), attr: m.attributeName, value: String(el.getAttribute(m.attributeName)).slice(0, 60) });
          }
        }
      });
      mo.observe(D.documentElement || D, { attributes: true, attributeOldValue: true, subtree: true, childList: true });
    } catch (e) {
      journal.error('mo', e);
    }
  }
  startMO();

  // ================================================================ P4d — universal motion recorder
  const REC_PROPS = ['transform', 'opacity', 'clipPath', 'filter'];
  const rec = {
    on: true,
    tracked: new Map(), // nid -> track
    maxTracked: 300,
    chunk: 150,
    pool: [],
    cursor: 0,
    sigs: new WeakMap(),
    frames: [], // [t, dt, overheadMs, scroll]
    overheadAvg: 0,
    lastT: now(),
    frameN: 0,
    forced: new Set(),
  };
  // Elements whose class just changed (CSS transitions / keyframes likely): checked every frame for ~1.5s.
  const priority = new Map(); // el -> {left, sig}
  function watchSubtree(el) {
    try {
      if (priority.size > 400) return;
      const nodes = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 40)];
      for (const n of nodes) {
        if (priority.has(n)) {
          priority.get(n).left = 90;
          continue;
        }
        priority.set(n, { left: 90, sig: rec.sigs.get(n) });
      }
    } catch (e) {
      /* ignore */
    }
  }
  function styleSig(cs) {
    return cs.transform + '|' + cs.opacity + '|' + cs.clipPath + '|' + cs.filter;
  }
  function decompose(tr) {
    if (!tr || tr === 'none') return [0, 0, 0, 1, 1, 0];
    try {
      const m = new DOMMatrixReadOnly(tr);
      const sx = Math.hypot(m.a, m.b);
      const rot = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      const sy = sx ? (m.a * m.d - m.b * m.c) / sx : 0;
      return [m.m41, m.m42, m.m43, sx, sy, rot];
    } catch (e) {
      return [0, 0, 0, 1, 1, 0];
    }
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  function rebuildPool() {
    try {
      const all = D.body ? D.body.getElementsByTagName('*') : [];
      const pool = [];
      for (let i = 0; i < all.length && pool.length < 6000; i++) {
        const el = all[i];
        const tn = el.localName;
        if (tn === 'script' || tn === 'style' || tn === 'link' || tn === 'meta' || tn === 'br' || tn === 'noscript' || tn === 'template') continue;
        if (el instanceof SVGElement && tn !== 'svg' && tn !== 'path' && tn !== 'g' && tn !== 'circle') continue;
        pool.push(el);
      }
      rec.pool = pool;
      if (rec.cursor >= pool.length) rec.cursor = 0;
    } catch (e) {
      journal.error('pool', e);
    }
  }
  function track(el) {
    const id = nid(el);
    if (rec.tracked.has(id)) return rec.tracked.get(id);
    if (rec.tracked.size >= rec.maxTracked) return null;
    let r = null;
    try {
      const b = el.getBoundingClientRect();
      r = { x: r2(b.x), y: r2(b.y + scrollPos()), w: r2(b.width), h: r2(b.height) };
    } catch (e) {
      /* ignore */
    }
    const t = {
      nid: id,
      el: new WeakRef(el),
      sel: selector(el),
      tag: el.localName,
      text: ((el.textContent || '').trim().slice(0, 60)) || null,
      rect0: r,
      // columns
      t: [],
      s: [],
      mx: [],
      my: [],
      tx: [],
      ty: [],
      tz: [],
      sx: [],
      sy: [],
      rot: [],
      op: [],
      clip: [], // [index, string]
      filter: [],
      top: [], // screen-space top (for pin detection)
      left: [],
      lastSig: null,
      lastClip: null,
      lastFilter: null,
    };
    rec.tracked.set(id, t);
    return t;
  }
  function sampleTrack(tk, el, cs, t, s) {
    const sig = styleSig(cs);
    let rect = null;
    if (tk.wantRect) {
      const b = el.getBoundingClientRect();
      rect = [r2(b.top), r2(b.left)];
    }
    const rsig = rect ? rect.join(',') : '';
    if (sig + rsig === tk.lastSig) return;
    tk.lastSig = sig + rsig;
    if (tk.t.length > 6000) return;
    const d = decompose(cs.transform);
    tk.t.push(Math.round(t * 10) / 10);
    tk.s.push(s);
    tk.mx.push(mouse.x);
    tk.my.push(mouse.y);
    tk.tx.push(r2(d[0]));
    tk.ty.push(r2(d[1]));
    tk.tz.push(r2(d[2]));
    tk.sx.push(Math.round(d[3] * 10000) / 10000);
    tk.sy.push(Math.round(d[4] * 10000) / 10000);
    tk.rot.push(r2(d[5]));
    tk.op.push(Math.round(parseFloat(cs.opacity) * 1000) / 1000);
    tk.top.push(rect ? rect[0] : null);
    tk.left.push(rect ? rect[1] : null);
    if (cs.clipPath !== tk.lastClip) {
      tk.clip.push([tk.t.length - 1, cs.clipPath]);
      tk.lastClip = cs.clipPath;
    }
    if (cs.filter !== tk.lastFilter) {
      tk.filter.push([tk.t.length - 1, cs.filter]);
      tk.lastFilter = cs.filter;
    }
  }
  // Push a synthetic "previous state" sample from a stored signature, just before the first real sample.
  function preSample(tk, sig, t, s) {
    if (!sig || tk.t.length) return;
    const [tr, op, clip, filter] = sig.split('|');
    const d = decompose(tr);
    tk.t.push(Math.round((t - 16) * 10) / 10);
    tk.s.push(s);
    tk.mx.push(mouse.x);
    tk.my.push(mouse.y);
    tk.tx.push(r2(d[0]));
    tk.ty.push(r2(d[1]));
    tk.tz.push(r2(d[2]));
    tk.sx.push(Math.round(d[3] * 10000) / 10000);
    tk.sy.push(Math.round(d[4] * 10000) / 10000);
    tk.rot.push(r2(d[5]));
    tk.op.push(Math.round(parseFloat(op) * 1000) / 1000);
    tk.top.push(null);
    tk.left.push(null);
    tk.clip.push([0, clip]);
    tk.filter.push([0, filter]);
    tk.lastClip = clip;
    tk.lastFilter = filter;
  }
  function recorderFrame() {
    const start = now();
    const dt = start - rec.lastT;
    rec.lastT = start;
    rec.frameN++;
    try {
      if (rec.on && D.body) {
        const t = rel();
        const s = scrollPos();
        if (rec.frameN % 60 === 1) rebuildPool();
        // sample tracked
        for (const tk of rec.tracked.values()) {
          const el = tk.el.deref();
          if (!el || !el.isConnected) continue;
          sampleTrack(tk, el, N.getCS(el), t, s);
        }
        // elements whose class just changed
        for (const [el, p] of priority) {
          if (--p.left <= 0 || !el.isConnected) {
            priority.delete(el);
            continue;
          }
          const cs = N.getCS(el);
          const sig = styleSig(cs);
          if (p.sig === undefined) p.sig = sig;
          else if (p.sig !== sig) {
            const tk = track(el);
            if (tk) {
              preSample(tk, p.sig, t, s);
              sampleTrack(tk, el, cs, t, s);
            }
            priority.delete(el);
          }
          rec.sigs.set(el, sig);
        }
        // incremental scan for newly-changing elements
        const pool = rec.pool;
        const n = Math.min(rec.chunk, pool.length);
        for (let i = 0; i < n; i++) {
          if (rec.cursor >= pool.length) rec.cursor = 0;
          const el = pool[rec.cursor++];
          if (!el || !el.isConnected) continue;
          const cs = N.getCS(el);
          const sig = styleSig(cs);
          const prev = rec.sigs.get(el);
          rec.sigs.set(el, sig);
          if (prev !== undefined && prev !== sig) {
            const tk = track(el);
            if (tk) {
              preSample(tk, prev, t, s);
              sampleTrack(tk, el, cs, t, s);
            }
          }
        }
        if (rec.frames.length < 30000) rec.frames.push([t, Math.round(dt * 10) / 10, 0, s]);
        // WAAPI sampling every ~500ms
        if (rec.frameN % 30 === 0) sampleAnimations();
        // draw calls per frame
        if (gl.drawCalls && gl.drawCallsPerFrame.length < 3000) gl.drawCallsPerFrame.push(gl.drawCalls);
        gl.drawCalls = 0;
      }
    } catch (e) {
      journal.error('recorder', e);
    }
    const overhead = now() - start;
    rec.overheadAvg = rec.overheadAvg * 0.95 + overhead * 0.05;
    if (rec.frames.length) rec.frames[rec.frames.length - 1][2] = Math.round(overhead * 100) / 100;
    // adaptive budget (spec: reduce sampling above 4ms overhead)
    if (rec.overheadAvg > 4 && rec.chunk > 20) rec.chunk = Math.max(20, Math.floor(rec.chunk * 0.8));
    else if (rec.overheadAvg < 2 && rec.chunk < 150) rec.chunk += 5;
    N.rAF(recorderFrame);
  }
  N.rAF(recorderFrame);

  // ================================================================ P10 — perf observers
  const perf = { longtasks: [], loaf: [], lcp: null, cls: 0, paints: {} };
  function observe(type, cb) {
    try {
      new PerformanceObserver((l) => {
        try {
          l.getEntries().forEach(cb);
        } catch (e) {
          /* ignore */
        }
      }).observe({ type, buffered: true });
    } catch (e) {
      /* unsupported */
    }
  }
  observe('longtask', (e) => perf.longtasks.length < 500 && perf.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }));
  observe('long-animation-frame', (e) => perf.loaf.length < 500 && perf.loaf.push({ t: Math.round(e.startTime), d: Math.round(e.duration), block: Math.round(e.blockingDuration || 0) }));
  observe('largest-contentful-paint', (e) => (perf.lcp = { t: Math.round(e.startTime), size: e.size, el: e.element ? selector(e.element) : null }));
  observe('layout-shift', (e) => {
    if (!e.hadRecentInput) perf.cls += e.value;
  });
  observe('paint', (e) => (perf.paints[e.name] = Math.round(e.startTime)));

  // ================================================================ helpers used by collectors
  function visible(el, cs) {
    cs = cs || N.getCS(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function absRect(el) {
    const r = el.getBoundingClientRect();
    const s = scrollPos();
    return { x: r2(r.left), y: r2(r.top + s), w: r2(r.width), h: r2(r.height) };
  }
  function ownText(el) {
    let t = '';
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function sleep(ms) {
    return new Promise((r) => N.setTimeout(r, ms));
  }
  function frames(n) {
    return new Promise((r) => {
      let i = 0;
      const f = () => (++i >= n ? r() : N.rAF(f));
      N.rAF(f);
    });
  }

  // ================================================================ P2 — DOM snapshot + sections
  const SNAP_PROPS = [
    'display', 'position', 'top', 'left', 'right', 'bottom', 'zIndex', 'overflow', 'overflowX', 'overflowY',
    'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridArea', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'flexGrow', 'flexShrink', 'flexBasis', 'gap', 'rowGap', 'columnGap',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'width', 'height', 'maxWidth', 'minHeight',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'color', 'fontVariationSettings', 'fontFeatureSettings',
    'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
    'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderBottomWidth', 'borderBottomColor', 'borderRadius',
    'boxShadow', 'transform', 'opacity', 'filter', 'backdropFilter', 'clipPath', 'maskImage', 'mixBlendMode',
    'objectFit', 'aspectRatio', 'pointerEvents', 'cursor', 'willChange', 'transition',
  ];
  const DEFAULTS = new Set(['none', 'normal', 'auto', '0px', 'static', 'visible', 'rgba(0, 0, 0, 0)', 'nowrap', 'row', 'start', 'stretch', '0', '1', 'fill', 'repeat', '0% 0%', 'all 0s ease 0s', 'auto / auto', 'solid', 'medium']);
  const INHERITED = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'color', 'fontVariationSettings', 'fontFeatureSettings', 'cursor']);
  function snapStyles(el, cs, parentStyles) {
    const o = {};
    for (const p of SNAP_PROPS) {
      const v = cs[p];
      if (v == null || v === '') continue;
      if (INHERITED.has(p)) {
        if (parentStyles && parentStyles[p] === v) continue;
      } else if (DEFAULTS.has(v)) continue;
      if (p === 'width' || p === 'height') continue; // rect carries it
      if (p === 'borderTopStyle' && v === 'none') continue;
      if ((p === 'borderTopColor' || p === 'borderBottomColor') && !parseFloat(cs.borderTopWidth) && !parseFloat(cs.borderBottomWidth)) continue;
      o[p] = v;
    }
    return o;
  }
  function snapshotDOM(opts) {
    opts = opts || {};
    const maxNodes = opts.maxNodes || 2500;
    let count = 0;
    const inherited = {};
    function walk(el, parentCS, depth) {
      if (count >= maxNodes || depth > 40) return null;
      const tn = el.localName;
      if (tn === 'script' || tn === 'style' || tn === 'noscript' || tn === 'template' || tn === 'link' || tn === 'meta') return null;
      const cs = N.getCS(el);
      if (cs.display === 'none') return null;
      const r = el.getBoundingClientRect();
      if ((r.width === 0 || r.height === 0) && cs.display !== 'contents' && !el.children.length) return null;
      count++;
      const full = {};
      for (const p of INHERITED) full[p] = cs[p];
      const node = { tag: tn };
      if (el.id) node.id = el.id;
      const cls = el.classList && el.classList.length ? Array.from(el.classList).slice(0, 8) : null;
      if (cls) node.class = cls;
      const role = el.getAttribute('role');
      if (role) node.role = role;
      const data = {};
      for (const a of el.attributes) {
        if (a.name.startsWith('data-') && a.value.length < 80) data[a.name] = a.value;
        if (a.name.startsWith('aria-label')) node.ariaLabel = a.value.slice(0, 120);
      }
      if (Object.keys(data).length) node.data = data;
      if (tn === 'a') node.href = el.getAttribute('href');
      if (tn === 'img') {
        node.src = el.currentSrc || el.src;
        node.alt = el.alt;
        node.natural = [el.naturalWidth, el.naturalHeight];
      }
      if (tn === 'video') node.src = el.currentSrc || el.src;
      if (tn === 'input' || tn === 'textarea' || tn === 'select') node.input = el.type || tn; // values never read
      const txt = tn === 'input' || tn === 'textarea' ? '' : ownText(el);
      if (txt) node.text = txt.slice(0, 160);
      node.nid = nid(el);
      node.rect = { x: r2(r.left), y: r2(r.top + scrollPos()), w: r2(r.width), h: r2(r.height) };
      node.style = snapStyles(el, cs, parentCS);
      if (tn === 'svg') {
        node.svg = true;
        return node; // don't descend into svg
      }
      const kids = [];
      for (const c of el.children) {
        const k = walk(c, full, depth + 1);
        if (k) kids.push(k);
      }
      // merge wrappers without visual effect
      if (kids.length === 1 && !txt && !Object.keys(node.style).length && !node.id && !node.role && !node.data) {
        const k = kids[0];
        if (Math.abs(k.rect.w - node.rect.w) < 1 && Math.abs(k.rect.h - node.rect.h) < 1) {
          k.wrappers = (k.wrappers || 0) + 1 + (node.wrappers || 0);
          return k;
        }
      }
      if (kids.length) node.children = kids;
      return node;
    }
    for (const p of INHERITED) inherited[p] = null;
    const tree = D.body ? walk(D.body, inherited, 0) : null;
    return { viewport: { w: W.innerWidth, h: W.innerHeight }, docHeight: docHeight(), nodes: count, truncated: count >= maxNodes, tree };
  }
  function docHeight() {
    try {
      let h = Math.max(D.documentElement.scrollHeight, D.body ? D.body.scrollHeight : 0);
      if (scrollContainer) h = Math.max(h, scrollContainer.getBoundingClientRect().height);
      return Math.round(h);
    } catch (e) {
      return 0;
    }
  }
  function slugify(s) {
    return String(s || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .filter(Boolean)
      .slice(0, 3)
      .join('-');
  }
  function findPageRoot() {
    let root = D.body;
    const H = docHeight();
    for (let i = 0; i < 12; i++) {
      const kids = Array.from(root.children).filter((c) => {
        const tn = c.localName;
        if (tn === 'script' || tn === 'style' || tn === 'noscript' || tn === 'link') return false;
        const cs = N.getCS(c);
        if (cs.display === 'none') return false;
        const r = c.getBoundingClientRect();
        return r.height > 0 && r.width > 0;
      });
      const big = kids.filter((c) => c.getBoundingClientRect().height >= H * 0.7);
      const nonFixed = kids.filter((c) => {
        const p = N.getCS(c).position;
        return p !== 'fixed';
      });
      if (big.length === 1 && nonFixed.length <= 3 && big[0].children.length) root = big[0];
      else break;
    }
    return root;
  }
  function sectionName(el, idx, top, h) {
    if (el.classList && el.classList.contains('pin-spacer') && el.firstElementChild) el = el.firstElementChild;
    const tn = el.localName;
    const vh = W.innerHeight;
    if (tn === 'header' || (idx === 0 && h < 160 && top < 10)) return 'header';
    if (tn === 'footer') return 'footer';
    if (tn === 'nav') return 'nav';
    const aria = el.getAttribute('aria-label') || el.getAttribute('data-section') || '';
    if (aria) return slugify(aria);
    if (el.id && !HASHED.test(el.id)) return slugify(el.id);
    const hEl = el.querySelector('h1, h2, h3');
    if (top < vh * 0.6 && (idx === 0 || idx === 1)) return 'hero';
    if (hEl && hEl.textContent.trim()) return slugify(hEl.textContent.trim());
    const gc = goodClasses(el);
    if (gc.length) return slugify(gc[0]);
    return tn;
  }
  function getSections() {
    const root = findPageRoot();
    const vh = W.innerHeight;
    const s = scrollPos();
    const raw = [];
    const pushed = new Set();
    const consider = (c) => {
      const cs = N.getCS(c);
      if (cs.display === 'none') return;
      const r = c.getBoundingClientRect();
      if (r.height < 40 || r.width < W.innerWidth * 0.5) return;
      if (cs.position === 'fixed') return; // fixed chrome (nav, cursor, background canvas)
      raw.push({ el: c, top: r.top + s, h: r.height, cs });
    };
    for (const c of root.children) consider(c);
    // also include a main's children when main is one huge child
    const main = raw.find((x) => x.el.localName === 'main' && x.h > docHeight() * 0.5 && x.el.children.length > 1);
    if (main) {
      raw.splice(raw.indexOf(main), 1, ...[]);
      pushed.add(main.el);
      for (const c of main.el.children) consider(c);
    }
    raw.sort((a, b) => a.top - b.top);
    // merge tiny consecutive blocks
    const merged = [];
    for (const x of raw) {
      const tn = x.el.localName;
      const structural = tn === 'section' || tn === 'header' || tn === 'footer';
      const prev = merged[merged.length - 1];
      if (prev && !structural && x.h < vh * 0.25 && prev.h < vh * 3) {
        prev.extra.push(x.el);
        prev.h = Math.max(prev.h, x.top + x.h - prev.top);
        continue;
      }
      merged.push({ ...x, extra: [] });
    }
    // Wrappers holding several visual sections: split them into their large children (twice at most).
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < merged.length; i++) {
        const x = merged[i];
        if (x.h < vh * 1.8 || x.el.localName === 'footer') continue;
        const kids = Array.from(x.el.children)
          .map((c) => ({ el: c, r: c.getBoundingClientRect(), cs: N.getCS(c) }))
          .filter((k) => k.cs.display !== 'none' && k.cs.position !== 'fixed' && k.cs.position !== 'absolute' && k.r.height >= vh * 0.3 && k.r.width >= W.innerWidth * 0.5);
        const covered = kids.reduce((a, k) => a + k.r.height, 0);
        if (kids.length >= 2 && covered >= x.h * 0.7) {
          merged.splice(i, 1, ...kids.map((k) => ({ el: k.el, top: k.r.top + s, h: k.r.height, cs: k.cs, extra: [] })));
          i += kids.length - 1;
        }
      }
    }
    const used = new Map();
    return merged.slice(0, 40).map((x, i) => {
      let name = sectionName(x.el, i, x.top, x.h) || 'section';
      const n = (used.get(name) || 0) + 1;
      used.set(name, n);
      if (n > 1) name += '-' + n;
      const id = 's' + String(i + 1).padStart(2, '0') + '-' + name;
      const rootEl = x.el.classList.contains('pin-spacer') && x.el.firstElementChild ? x.el.firstElementChild : x.el;
      const bg = N.getCS(rootEl).backgroundColor;
      const rootH = rootEl !== x.el ? Math.round(rootEl.getBoundingClientRect().height) : null;
      const hEl = x.el.querySelector('h1, h2, h3');
      return {
        id,
        selector: selector(rootEl),
        nid: nid(rootEl),
        tag: rootEl.localName,
        pinSpacer: rootEl !== x.el ? true : undefined,
        top: Math.round(x.top),
        height: rootH || Math.round(x.h),
        span: rootH ? Math.round(x.h) : undefined, // pinned: scroll distance including pin spacing
        background: bg,
        heading: hEl ? (hEl.innerText || hEl.textContent).trim().replace(/\s+/g, ' ').slice(0, 120) : null,
        position: x.cs.position,
        extra: x.extra.map(selector),
      };
    });
  }
  function getGrid() {
    try {
      const vw = W.innerWidth;
      const lefts = new Map();
      const gridDecl = new Map();
      const gaps = new Map();
      const els = D.body.querySelectorAll('h1,h2,h3,h4,p,img,video,a,button,li,figure,article,[class*="col"],[class*="grid"]');
      let n = 0;
      for (const el of els) {
        if (n++ > 3000) break;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.width > vw * 0.95) continue;
        const l = Math.round(r.left);
        if (l < 0 || l > vw) continue;
        lefts.set(l, (lefts.get(l) || 0) + 1);
      }
      for (const el of D.body.querySelectorAll('*')) {
        const cs = N.getCS(el);
        if (cs.display === 'grid' || cs.display === 'inline-grid') {
          const cols = cs.gridTemplateColumns.split(' ').filter((x) => x.endsWith('px')).length;
          if (cols > 1) gridDecl.set(cols, (gridDecl.get(cols) || 0) + 1);
          if (cs.columnGap && cs.columnGap !== 'normal') gaps.set(cs.columnGap, (gaps.get(cs.columnGap) || 0) + 1);
        } else if (cs.display === 'flex' && cs.columnGap && cs.columnGap !== 'normal' && cs.columnGap !== '0px') gaps.set(cs.columnGap, (gaps.get(cs.columnGap) || 0) + 1);
      }
      const sortMap = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
      const leftEdges = sortMap(lefts).slice(0, 16).map(([x, c]) => ({ x, count: c })).sort((a, b) => a.x - b.x);
      const margin = leftEdges.length ? leftEdges.filter((e) => e.count >= 3)[0] : null;
      return {
        viewport: vw,
        leftEdges,
        marginEstimate: margin ? margin.x : null,
        gridColumns: sortMap(gridDecl).slice(0, 5).map(([cols, c]) => ({ cols, count: c })),
        gaps: sortMap(gaps).slice(0, 6).map(([v, c]) => ({ value: v, count: c })),
      };
    } catch (e) {
      journal.error('grid', e);
      return null;
    }
  }

  // ================================================================ P3 — tokens
  async function getCssTexts() {
    const out = [];
    for (const sheet of Array.from(D.styleSheets).slice(0, 80)) {
      let text = null;
      try {
        text = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n');
      } catch (e) {
        if (sheet.href && N.fetch) {
          try {
            const res = await N.fetch(sheet.href, { credentials: 'omit' });
            if (res.ok) text = await res.text();
          } catch (e2) {
            /* CORS blocked */
          }
        }
      }
      if (text) out.push({ href: sheet.href || 'inline', text: text.slice(0, 1500000) });
    }
    return out;
  }
  function srgbToLab(r, g, b) {
    const f = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const R = f(r), G = f(g), B = f(b);
    let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const g3 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    X = g3(X);
    Y = g3(Y);
    Z = g3(Z);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function parseColor(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3) return null;
    const a = p.length > 3 ? p[3] : 1;
    return { r: Math.round(p[0]), g: Math.round(p[1]), b: Math.round(p[2]), a };
  }
  const hex = (c) => '#' + [c.r, c.g, c.b].map((x) => x.toString(16).padStart(2, '0')).join('');
  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
  }
  async function getTokens() {
    const out = { cssVars: {}, themes: [], colors: {}, typography: [], fontFaces: [], spacing: {}, radii: {}, shadows: {}, durations: {}, easings: {}, breakpoints: [], viewport: W.innerWidth };
    try {
      const texts = await getCssTexts();
      const rootCS = N.getCS(D.documentElement);
      const varNames = new Set();
      const bpSet = new Map();
      for (const { text } of texts) {
        const reVar = /(--[a-zA-Z0-9_-]+)\s*:/g;
        let m;
        while ((m = reVar.exec(text)) && varNames.size < 800) varNames.add(m[1]);
        const reMq = /@media[^{]*?\((min|max)-width:\s*([\d.]+)(px|em|rem)\)/g;
        while ((m = reMq.exec(text))) {
          const px = m[3] === 'px' ? parseFloat(m[2]) : parseFloat(m[2]) * 16;
          const k = m[1] + ':' + px;
          bpSet.set(k, (bpSet.get(k) || 0) + 1);
        }
        const reMq2 = /@media[^{]*?\(width\s*([<>]=?)\s*([\d.]+)(px|em|rem)\)/g;
        while ((m = reMq2.exec(text))) {
          const px = m[3] === 'px' ? parseFloat(m[2]) : parseFloat(m[2]) * 16;
          const k = (m[1].startsWith('>') ? 'min' : 'max') + ':' + px;
          bpSet.set(k, (bpSet.get(k) || 0) + 1);
        }
        const reFF = /@font-face\s*{([^}]*)}/g;
        while ((m = reFF.exec(text)) && out.fontFaces.length < 80) {
          const body = m[1];
          const g = (k) => {
            const x = new RegExp(k + '\\s*:\\s*([^;]+)', 'i').exec(body);
            return x ? x[1].trim() : null;
          };
          const urls = (body.match(/url\(([^)]+)\)/g) || []).map((u) => u.slice(4, -1).replace(/["']/g, ''));
          out.fontFaces.push({ family: (g('font-family') || '').replace(/["']/g, ''), weight: g('font-weight'), style: g('font-style'), display: g('font-display'), stretch: g('font-stretch'), unicodeRange: g('unicode-range') ? 'yes' : null, src: urls.slice(0, 3) });
        }
        const reTheme = /(\[data-theme[^\]]*\]|\.dark|\.light|\.theme-[a-z0-9-]+)\s*{/g;
        while ((m = reTheme.exec(text)) && out.themes.length < 10) if (!out.themes.includes(m[1])) out.themes.push(m[1]);
      }
      out.reducedMotionRules = texts.reduce((a, x) => a + (x.text.match(/prefers-reduced-motion/g) || []).length, 0);
      for (const v of varNames) {
        const val = rootCS.getPropertyValue(v).trim();
        if (val) out.cssVars[v] = val.slice(0, 200);
      }
      out.breakpoints = [...bpSet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, c]) => ({ type: k.split(':')[0], px: +k.split(':')[1], rules: c }));

      // colors (area weighted) + typography + spacing
      const colorAcc = new Map();
      const addColor = (c, w, role) => {
        const p = parseColor(c);
        if (!p || p.a < 0.05) return;
        const k = hex(p) + (p.a < 1 ? '@' + Math.round(p.a * 100) : '');
        const cur = colorAcc.get(k) || { hex: hex(p), alpha: p.a, rgb: p, weight: 0, roles: {} };
        cur.weight += w;
        cur.roles[role] = (cur.roles[role] || 0) + w;
        colorAcc.set(k, cur);
      };
      const typo = new Map();
      const spacing = new Map(), radii = new Map(), shadows = new Map(), durations = new Map(), easings = new Map();
      const inc = (m, k, w) => k && m.set(k, (m.get(k) || 0) + (w || 1));
      const vw = W.innerWidth, vh = W.innerHeight;
      const all = D.body ? D.body.getElementsByTagName('*') : [];
      let n = 0;
      const bodyBg = parseColor(N.getCS(D.body).backgroundColor);
      const htmlBg = parseColor(rootCS.backgroundColor);
      addColor(bodyBg && bodyBg.a > 0 ? N.getCS(D.body).backgroundColor : rootCS.backgroundColor, vw * vh * 2, 'background');
      for (let i = 0; i < all.length && n < 5000; i++) {
        const el = all[i];
        const tn = el.localName;
        if (tn === 'script' || tn === 'style' || tn === 'noscript') continue;
        const cs = N.getCS(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        n++;
        const area = Math.min(r.width, vw) * Math.min(r.height, vh * 2);
        addColor(cs.backgroundColor, area, 'background');
        const bw = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
        if (bw > 0) addColor(cs.borderTopColor, r.width * bw, 'border');
        const txt = ownText(el);
        if (txt) {
          const fs = parseFloat(cs.fontSize);
          addColor(cs.color, txt.length * fs * fs, 'text');
          const key = [cs.fontFamily, cs.fontWeight, cs.fontSize, cs.lineHeight, cs.letterSpacing, cs.textTransform, cs.fontStyle].join('|');
          const cur = typo.get(key) || { fontFamily: cs.fontFamily, fontWeight: cs.fontWeight, fontSize: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, textTransform: cs.textTransform, fontStyle: cs.fontStyle, fontFeatureSettings: cs.fontFeatureSettings, fontVariationSettings: cs.fontVariationSettings, tags: {}, chars: 0, samples: [], selectors: [] };
          cur.tags[tn] = (cur.tags[tn] || 0) + 1;
          cur.chars += txt.length;
          if (cur.samples.length < 3) cur.samples.push(txt.slice(0, 60));
          if (cur.selectors.length < 3) cur.selectors.push(selector(el));
          typo.set(key, cur);
        }
        for (const p of ['paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom', 'rowGap', 'columnGap']) {
          const v = cs[p];
          if (v && v !== '0px' && v !== 'normal' && v !== 'auto') inc(spacing, v);
        }
        if (cs.borderTopLeftRadius !== '0px') inc(radii, cs.borderTopLeftRadius);
        if (cs.boxShadow !== 'none') inc(shadows, cs.boxShadow);
        if (cs.transitionDuration && cs.transitionDuration !== '0s') {
          inc(durations, cs.transitionDuration.split(',')[0].trim());
          inc(easings, cs.transitionTimingFunction.split(/,(?![^(]*\))/)[0].trim());
        }
      }
      // cluster colors by ΔE76 < 4
      const list = [...colorAcc.values()].sort((a, b) => b.weight - a.weight);
      const clusters = [];
      for (const c of list) {
        const lab = srgbToLab(c.rgb.r, c.rgb.g, c.rgb.b);
        const hit = clusters.find((k) => k.alpha === c.alpha && Math.hypot(k.lab[0] - lab[0], k.lab[1] - lab[1], k.lab[2] - lab[2]) < 4);
        if (hit) {
          hit.weight += c.weight;
          for (const r in c.roles) hit.roles[r] = (hit.roles[r] || 0) + c.roles[r];
        } else clusters.push({ ...c, lab });
      }
      const total = clusters.reduce((a, c) => a + c.weight, 0) || 1;
      const palette = clusters.slice(0, 16).map((c) => {
        const role = Object.entries(c.roles).sort((a, b) => b[1] - a[1])[0][0];
        const chroma = Math.hypot(c.lab[1], c.lab[2]);
        return { hex: c.hex, alpha: c.alpha, share: Math.round((c.weight / total) * 1000) / 1000, role, chroma: Math.round(chroma), lab: c.lab.map((x) => Math.round(x * 10) / 10) };
      });
      const bg = palette.find((p) => p.role === 'background' && p.alpha === 1) || palette[0];
      const text = palette.find((p) => p.role === 'text');
      const accent = palette.filter((p) => p.chroma > 25 && p !== bg && p !== text).sort((a, b) => b.share - a.share)[0];
      const toRgb = (p) => ({ r: parseInt(p.hex.slice(1, 3), 16), g: parseInt(p.hex.slice(3, 5), 16), b: parseInt(p.hex.slice(5, 7), 16) });
      out.colors = {
        palette,
        background: bg ? bg.hex : null,
        text: text ? text.hex : null,
        accent: accent ? accent.hex : null,
        textOnBgContrast: bg && text ? contrast(toRgb(bg), toRgb(text)) : null,
        htmlBackground: htmlBg ? hex(htmlBg) : null,
      };
      out.typography = [...typo.values()].sort((a, b) => parseFloat(b.fontSize) - parseFloat(a.fontSize) || b.chars - a.chars).slice(0, 30);
      const top = (m, k) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([value, count]) => ({ value, count }));
      out.spacing = top(spacing, 24);
      out.radii = top(radii, 10);
      out.shadows = top(shadows, 8);
      out.durations = top(durations, 10);
      out.easings = top(easings, 10);
      try {
        const loaded = [];
        D.fonts.forEach((f) => loaded.length < 60 && loaded.push({ family: f.family.replace(/["']/g, ''), weight: f.weight, style: f.style, status: f.status, stretch: f.stretch }));
        out.fontsLoaded = loaded;
      } catch (e) {
        /* ignore */
      }
    } catch (e) {
      journal.error('tokens', e);
    }
    return out;
  }

  // ================================================================ text splits (P4e)
  function getSplits() {
    const out = [];
    try {
      const seen = new Set();
      const cands = D.body.querySelectorAll('h1,h2,h3,h4,h5,p,span,div,a,[aria-label],[data-split],[class*="split"],[class*="line"],[class*="word"],[class*="char"]');
      for (const el of cands) {
        if (out.length >= 80) break;
        if (seen.has(el)) continue;
        const kids = Array.from(el.children);
        if (kids.length < 3) continue;
        const spans = kids.filter((k) => k.localName === 'span' || k.localName === 'div');
        if (spans.length < kids.length * 0.8) continue;
        const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!full || full.length > 600) continue;
        const lens = spans.map((s) => (s.textContent || '').trim().length);
        const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
        const disp = N.getCS(spans[0]).display;
        if (!/inline-block|block|flex|inline-flex/.test(disp) && !el.getAttribute('aria-label')) continue;
        let type = avg <= 1.5 ? 'chars' : avg < 12 ? 'words' : 'lines';
        // nested splits: lines > words > chars
        const nested = spans[0].children.length > 1 ? (spans[0].children[0].textContent.trim().length <= 1 ? 'chars' : 'words') : null;
        const masked = spans.some((s) => N.getCS(s).overflow === 'hidden' || N.getCS(s).overflowY === 'hidden' || (s.parentElement && N.getCS(s.parentElement).overflow === 'hidden' && s.parentElement !== el));
        const lineWrap = spans[0].children.length === 1 && N.getCS(spans[0]).overflow === 'hidden';
        if (lineWrap) type = 'lines';
        const units = Array.from(el.querySelectorAll('*')).slice(0, 400).map(nid);
        out.push({ selector: selector(el), nid: nid(el), tag: el.localName, type, nested, count: spans.length, mask: masked || lineWrap ? 'overflow-hidden-wrapper' : null, ariaLabel: el.getAttribute('aria-label'), text: full.slice(0, 120), units });
        seen.add(el);
        spans.forEach((s) => seen.add(s));
      }
    } catch (e) {
      journal.error('splits', e);
    }
    return out;
  }

  // ================================================================ P5 — scroll system
  function detectScroll() {
    const html = D.documentElement;
    const o = { type: 'native', evidence: [], options: null };
    try {
      if (html.classList.contains('lenis') || html.classList.contains('lenis-smooth') || W.lenisVersion || W.lenis) {
        o.type = 'lenis';
        o.version = W.lenisVersion || null;
        o.evidence.push('html.lenis');
        const inst = W.lenis && W.lenis.options ? W.lenis : null;
        if (inst) {
          o.options = sanitize(inst.options);
          o.evidence.push('window.lenis instance');
        }
      }
      const loco = D.querySelector('[data-scroll-container]');
      if (html.classList.contains('has-scroll-smooth') || (loco && loco.getAttribute('style') && /transform/.test(loco.getAttribute('style')))) {
        o.type = 'locomotive';
        o.evidence.push('[data-scroll-container]');
        scrollContainer = loco;
      } else if (loco && o.type === 'native') {
        o.evidence.push('[data-scroll-container] present (Locomotive v5 uses Lenis)');
      }
      const g = gsapLog.instance || W.gsap;
      const SS = W.ScrollSmoother || (g && g.plugins && g.plugins.ScrollSmoother);
      if (D.getElementById('smooth-wrapper') || (SS && SS.get && SS.get())) {
        o.type = 'gsap-scrollsmoother';
        o.evidence.push('#smooth-wrapper');
        try {
          const inst = SS && SS.get && SS.get();
          if (inst) o.options = { smooth: inst.smooth && inst.smooth(), effects: !!inst.effects, smoothTouch: inst.vars && inst.vars.smoothTouch };
        } catch (e) {
          /* ignore */
        }
      }
      if (o.type === 'native') {
        const cs = N.getCS(html);
        if (cs.scrollBehavior === 'smooth') o.evidence.push('css scroll-behavior:smooth');
        if (cs.scrollSnapType && cs.scrollSnapType !== 'none') o.snap = cs.scrollSnapType;
        const fixedWrapper = D.body && Array.from(D.body.children).find((c) => N.getCS(c).position === 'fixed' && c.getBoundingClientRect().height >= W.innerHeight * 0.95 && c.scrollHeight > W.innerHeight * 2);
        if (fixedWrapper) {
          o.type = 'custom-virtual';
          o.evidence.push('fixed full-height wrapper: ' + selector(fixedWrapper));
          scrollContainer = fixedWrapper;
        }
      }
    } catch (e) {
      journal.error('scroll', e);
    }
    o.wheelListeners = listeners.wheelTargets;
    return o;
  }
  // Records scroll position per frame for `ms` ms. The orchestrator fires one wheel event right after starting it.
  function recordScrollResponse(ms) {
    return new Promise((resolve) => {
      const out = [];
      const t0 = now();
      const f = () => {
        out.push([Math.round(now() - t0), scrollPos()]);
        if (now() - t0 < (ms || 1500)) N.rAF(f);
        else resolve(out);
      };
      N.rAF(f);
    });
  }
  let pendingImpulse = null;
  function startImpulse(ms) {
    pendingImpulse = recordScrollResponse(ms);
    return true;
  }
  function getImpulse() {
    return pendingImpulse;
  }

  // ================================================================ P7 — interactives & hover snapshots
  const HOVER_STYLE_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'transform', 'opacity', 'boxShadow', 'filter', 'clipPath', 'letterSpacing', 'textDecorationLine', 'width', 'height', 'borderRadius', 'backgroundSize', 'scale', 'translate'];
  function listInteractive(max) {
    const out = [];
    try {
      const set = new Set(D.querySelectorAll('a[href], button, [role="button"], [data-cursor], [data-magnetic], [class*="magnetic"], [class*="btn"], [class*="button"], [class*="card"]'));
      for (const ref of listeners.hoverEls) {
        const el = ref.deref();
        if (el && el.isConnected) set.add(el);
      }
      const vw = W.innerWidth;
      const items = [];
      for (const el of set) {
        const cs = N.getCS(el);
        if (!visible(el, cs) || cs.pointerEvents === 'none') continue;
        const r = absRect(el);
        if (r.w < 8 || r.h < 8 || r.w > vw * 1.2) continue;
        if (N.getCS(el).position === 'fixed' && r.w > vw * 0.9) continue;
        items.push({ el, r });
      }
      // prioritise large + early elements, dedupe near-identical siblings (same selector class shape)
      const shape = new Map();
      items.sort((a, b) => b.r.w * b.r.h - a.r.w * a.r.h);
      for (const it of items) {
        const k = it.el.localName + '.' + goodClasses(it.el).join('.') + '|' + Math.round(it.r.w / 10) + 'x' + Math.round(it.r.h / 10);
        const c = shape.get(k) || 0;
        if (c >= 2) continue;
        shape.set(k, c + 1);
        out.push({ selector: selector(it.el), nid: nid(it.el), tag: it.el.localName, text: (it.el.textContent || '').trim().slice(0, 40), rect: it.r, listener: Array.from(listeners.hoverEls).some((w) => w.deref() === it.el) });
        if (out.length >= (max || 40)) break;
      }
      out.sort((a, b) => a.rect.y - b.rect.y);
    } catch (e) {
      journal.error('interactive', e);
    }
    return out;
  }
  function elByNid(id) {
    const w = byNid.get(id);
    return w ? w.deref() : null;
  }
  function styleSnapshot(nidOrSel) {
    const el = (typeof nidOrSel === 'string' && nidOrSel.startsWith('n') && elByNid(nidOrSel)) || D.querySelector(nidOrSel);
    if (!el) return null;
    const out = [];
    const nodes = [el, ...Array.from(el.querySelectorAll('*')).slice(0, 25)];
    const pseudo = ['::before', '::after'];
    for (const n of nodes) {
      const cs = N.getCS(n);
      const o = { sel: n === el ? ':scope' : selector(n), nid: nid(n) };
      for (const p of HOVER_STYLE_PROPS) o[p] = cs[p];
      out.push(o);
      for (const ps of pseudo) {
        const pcs = N.getCS(n, ps);
        if (pcs.content && pcs.content !== 'none') {
          const po = { sel: (n === el ? ':scope' : selector(n)) + ps };
          for (const p of HOVER_STYLE_PROPS) po[p] = pcs[p];
          out.push(po);
        }
      }
    }
    return { rect: absRect(el), viewportRect: el.getBoundingClientRect().toJSON(), styles: out, transitions: N.getCS(el).transition };
  }
  function rectOf(nidOrSel) {
    const el = (typeof nidOrSel === 'string' && nidOrSel.startsWith('n') && elByNid(nidOrSel)) || D.querySelector(nidOrSel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, abs: absRect(el) };
  }
  // Tracked recorder elements inside an anchor (dip-verify: effect targets are often children of the anchor).
  function tracksUnder(sel) {
    const root = D.querySelector(sel);
    if (!root) return null;
    const out = [];
    for (const tk of rec.tracked.values()) {
      const el = tk.el.deref();
      if (el && (el === root || root.contains(el))) out.push(tk.nid);
    }
    return { nid: nid(root), tracked: out };
  }
  function watch(sel) {
    // start tracking an anchor and its subtree immediately (before the animation runs)
    const root = D.querySelector(sel);
    if (!root) return false;
    for (const el of [root, ...Array.from(root.querySelectorAll('*')).slice(0, 60)]) {
      const tk = track(el);
      if (tk && !tk.t.length) sampleTrack(tk, el, N.getCS(el), rel(), scrollPos());
    }
    return true;
  }
  // Layout box without transforms (animations move elements; layout comparisons must not depend on it).
  function layoutRect(el) {
    if (!(el instanceof HTMLElement) || !el.offsetParent) return absRect(el);
    let x = 0, y = 0, cur = el;
    while (cur) {
      x += cur.offsetLeft;
      y += cur.offsetTop;
      cur = cur.offsetParent;
    }
    return { x: r2(x), y: r2(y), w: el.offsetWidth, h: el.offsetHeight };
  }
  function layoutOf(sel) {
    const el = D.querySelector(sel);
    return el ? layoutRect(el) : null;
  }
  function rectsFor(ids) {
    const out = {};
    for (const k of ids || []) {
      try {
        const el = (k.startsWith('n') && elByNid(k)) || D.querySelector(k);
        if (el) out[k] = layoutRect(el);
      } catch (e) {
        /* ignore */
      }
    }
    return out;
  }
  function trackRects(nidsOrSels) {
    for (const k of nidsOrSels || []) {
      const el = (k.startsWith('n') && elByNid(k)) || D.querySelector(k);
      if (!el) continue;
      const tk = track(el);
      if (tk) tk.wantRect = true;
    }
    return true;
  }
  function findCursorCandidates() {
    const out = [];
    try {
      for (const el of D.body.querySelectorAll('*')) {
        const cs = N.getCS(el);
        if (cs.position !== 'fixed' || cs.pointerEvents !== 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width < 200 && r.height < 200) out.push({ selector: selector(el), nid: nid(el), rect: r.toJSON(), mixBlendMode: cs.mixBlendMode, borderRadius: cs.borderRadius, background: cs.backgroundColor });
        if (out.length > 10) break;
      }
      const rootCursor = N.getCS(D.body).cursor;
      return { candidates: out, bodyCursor: rootCursor };
    } catch (e) {
      return { candidates: out };
    }
  }

  // ================================================================ consent (step 3)
  const CONSENT_REJECT = [
    '#onetrust-reject-all-handler', '.ot-pc-refuse-all-handler', '#didomi-notice-disagree-button', '.didomi-continue-without-agreeing',
    '#axeptio_btn_dismiss', 'button[aria-label*="Refuser" i]', '#CybotCookiebotDialogBodyButtonDecline', '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '.cky-btn-reject', '#tarteaucitronAllDenied2', '.cmplz-deny', '#cookie-notice .cn-refuse-cookie', '[data-cookiefirst-action="reject"]', '.iubenda-cs-reject-btn', '.fc-cta-do-not-consent',
  ];
  const REJECT_TEXT = /^(tout refuser|refuser|refuser tout|je refuse|continuer sans accepter|reject( all)?|decline( all)?|deny|only necessary|necessary only|use necessary cookies only|nur notwendige|rechazar|rifiuta)/i;
  function handleConsent(strategy) {
    strategy = strategy || 'reject';
    const res = { found: false, action: null, selector: null };
    try {
      if (strategy === 'none') return res;
      if (strategy === 'reject') {
        for (const s of CONSENT_REJECT) {
          const b = D.querySelector(s);
          if (b && visible(b)) {
            b.click();
            return { found: true, action: 'reject-click', selector: s };
          }
        }
        const btns = D.querySelectorAll('button, a[role="button"], [role="button"], a');
        for (const b of btns) {
          const t = (b.textContent || '').trim();
          if (t.length < 40 && REJECT_TEXT.test(t) && visible(b)) {
            const ctx = (b.closest('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [aria-modal="true"], [role="dialog"]') || {}).textContent || '';
            if (/cookie|consent|traceur|privacy|confidentialit/i.test(ctx)) {
              b.click();
              return { found: true, action: 'reject-text', selector: selector(b) };
            }
          }
        }
      }
      // hide fallback
      for (const el of D.querySelectorAll('div, section, aside, dialog')) {
        const cs = N.getCS(el);
        if ((cs.position === 'fixed' || cs.position === 'sticky') && /cookie|consent|traceurs/i.test((el.textContent || '').slice(0, 2000)) && (el.textContent || '').length < 4000) {
          const r = el.getBoundingClientRect();
          if (r.height > 30 && r.height < W.innerHeight * 1.01) {
            el.style.setProperty('display', 'none', 'important');
            res.found = true;
            res.action = 'hidden';
            res.selector = selector(el);
            break;
          }
        }
      }
    } catch (e) {
      journal.error('consent', e);
    }
    return res;
  }

  // ================================================================ scroll helpers & stability
  async function scrollToY(y, settleMs) {
    try {
      const lenis = W.lenis && typeof W.lenis.scrollTo === 'function' ? W.lenis : null;
      if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
      else W.scrollTo({ top: y, left: 0, behavior: 'instant' });
    } catch (e) {
      try {
        W.scrollTo(0, y);
      } catch (e2) {
        /* ignore */
      }
    }
    return waitScrollStable(settleMs || 400);
  }
  async function waitScrollStable(quietMs) {
    let last = scrollPos();
    let still = now();
    const t0 = now();
    while (now() - t0 < 3000) {
      await frames(2);
      const p = scrollPos();
      if (p !== last) {
        last = p;
        still = now();
      } else if (now() - still > (quietMs || 300)) break;
    }
    return scrollPos();
  }
  // Wait until no style change was observed by the recorder / mutation observer for `quietMs`.
  async function waitStable(quietMs, maxMs) {
    const t0 = now();
    quietMs = quietMs || 500;
    maxMs = maxMs || 12000;
    const streak = new Map(); // nid -> consecutive active ticks; continuous loops (marquees…) are ignored after 2s
    let lastSig = activitySig(streak);
    let stillSince = now();
    while (now() - t0 < maxMs) {
      await sleep(100);
      const sig = activitySig(streak);
      if (sig !== lastSig) {
        lastSig = sig;
        stillSince = now();
      } else if (now() - stillSince >= quietMs) return { stable: true, ms: Math.round(now() - t0) };
    }
    return { stable: false, ms: Math.round(now() - t0) };
  }
  function activitySig(streak) {
    let n = mutations.nonStyle;
    const tNow = rel();
    for (const tk of rec.tracked.values()) {
      const active = tk.t.length && tNow - tk.t[tk.t.length - 1] < 120;
      if (streak) {
        const st = streak.get(tk.nid) || { run: 0, bursts: 0, was: false };
        st.run = active ? st.run + 1 : 0;
        if (active && !st.was) st.bursts++;
        st.was = !!active;
        streak.set(tk.nid, st);
        if (st.run > 20 || st.bursts >= 3) continue; // continuous or periodic loop: not "settling"
      }
      n += tk.t.length;
    }
    return n;
  }
  function detectPreloader() {
    try {
      const vw = W.innerWidth, vh = W.innerHeight;
      const loaders = [];
      for (const el of D.querySelectorAll('[class*="loader" i], [class*="preload" i], [id*="loader" i], [id*="preload" i], [class*="intro" i]')) {
        const r = el.getBoundingClientRect();
        const cs = N.getCS(el);
        if ((cs.position === 'fixed' || cs.position === 'absolute') && r.width >= vw * 0.8 && r.height >= vh * 0.8) loaders.push({ selector: selector(el), visible: visible(el, cs), opacity: cs.opacity });
      }
      return loaders.slice(0, 5);
    } catch (e) {
      return [];
    }
  }

  // ================================================================ P1 — stack detection (collect)
  const SIGNATURES = [
    { name: 'gsap', re: /GSAP\s+(\d+\.\d+\.\d+)|gsap\.registerPlugin|_gsScope|greensock/i, ver: /GSAP\s+(\d+\.\d+\.\d+)/ },
    { name: 'scrolltrigger', re: /ScrollTrigger/ },
    { name: 'splittext', weak: true, re: /SplitText/ },
    { name: 'scrollsmoother', weak: true, re: /ScrollSmoother/ },
    { name: 'customease', weak: true, re: /CustomEase/ },
    { name: 'lenis', re: /lenis|@studio-freight\/lenis|@darkroom\.engineering/i, ver: /lenisVersion\s*=\s*["'](\d+\.\d+\.\d+)|version:\s*["'](1\.\d+\.\d+)["']/ },
    { name: 'locomotive-scroll', re: /locomotive-scroll|LocomotiveScroll|data-scroll-container/ },
    { name: 'three', re: /THREE\.WebGLRenderer|WebGLRenderer|__THREE__/, ver: /REVISION\s*=\s*["'](\d+)/ },
    { name: 'ogl', re: /\bogl\b|new\s+Renderer\(\{[^}]*dpr/ },
    { name: 'pixi', re: /PIXI\.|pixi\.js/i },
    { name: 'babylon', re: /BABYLON\./ },
    { name: 'react-three-fiber', re: /@react-three\/fiber|useFrame/ },
    { name: 'framer-motion', re: /framer-motion|motion\.div|useScroll\(/ },
    { name: 'motion-one', re: /motion\.dev|@motionone/ },
    { name: 'barba', re: /@barba\/core|barba\.init/ },
    { name: 'swup', re: /\bswup\b/i },
    { name: 'taxi', re: /@unseenco\/taxi|taxi\.js/i },
    { name: 'splitting', re: /Splitting\(|splitting\.js/i },
    { name: 'split-type', re: /SplitType|split-type/ },
    { name: 'lottie', re: /bodymovin|lottie-web|lottie\.loadAnimation|dotlottie/i },
    { name: 'rive', re: /@rive-app|rive\.wasm/ },
    { name: 'swiper', re: /\bswiper\b/i },
    { name: 'anime', re: /anime\.js|anime\.timeline/ },
    { name: 'highway', re: /@dogstudio\/highway|Highway\.Core/ },
    { name: 'theatre', re: /@theatre\/core/ },
    { name: 'spline', re: /@splinetool/ },
    { name: 'react', re: /__REACT_DEVTOOLS_GLOBAL_HOOK__|react-dom|React\.createElement/ },
    { name: 'vue', re: /__VUE__|createApp\(|Vue\.version/ },
    { name: 'svelte', re: /svelte/ },
  ];
  async function detectStack() {
    const found = new Map();
    const add = (name, confidence, evidence, version) => {
      const cur = found.get(name) || { name, confidence: 0, evidence: [], version: null };
      cur.confidence = Math.max(cur.confidence, confidence);
      if (evidence && cur.evidence.length < 6 && !cur.evidence.includes(evidence)) cur.evidence.push(evidence);
      if (version && !cur.version) cur.version = String(version);
      found.set(name, cur);
    };
    try {
      const g = gsapLog.instance || W.gsap;
      if (g) add('gsap', 1, gsapLog.instance ? 'window.gsap trapped at assignment' : 'window.gsap', g.version);
      if (gsapLog.ST || W.ScrollTrigger) add('scrolltrigger', 1, 'ScrollTrigger object');
      for (const p of gsapLog.plugins) add(p.toLowerCase().replace(/plugin$/, ''), 0.95, 'gsap.registerPlugin(' + p + ')');
      if (!g) {
        let marked = 0;
        for (const el of D.body.querySelectorAll('*')) {
          if (el._gsap) marked++;
          if (marked > 3) break;
        }
        if (marked) add('gsap', 0.9, 'elements carry _gsap cache (bundled GSAP)');
      }
      if (W.__THREE__) add('three', 1, 'window.__THREE__', W.__THREE__);
      if (three.renderers.size) add('three', 1, '__THREE_DEVTOOLS__ observe(renderer)');
      if (D.documentElement.classList.contains('lenis') || W.lenisVersion) add('lenis', 1, 'html.lenis', W.lenisVersion);
      if (D.querySelector('[data-scroll-container]')) add('locomotive-scroll', 0.8, '[data-scroll-container]');
      if (W.__NEXT_DATA__ || D.getElementById('__next') || D.querySelector('script[src*="/_next/"]')) add('nextjs', 1, '__NEXT_DATA__ / _next');
      if (W.__NUXT__ || D.getElementById('__nuxt')) add('nuxt', 1, '__NUXT__');
      if (W.Webflow || D.documentElement.getAttribute('data-wf-site')) add('webflow', 1, 'Webflow');
      if (D.querySelector('[data-framer-name], [data-framer-component-type]') || D.querySelector('script[src*="framerusercontent"]')) add('framer-site', 1, 'data-framer-*');
      if (D.querySelector('[data-barba]')) add('barba', 1, '[data-barba]');
      if (D.querySelector('[data-taxi]')) add('taxi', 1, '[data-taxi]');
      if (D.querySelector('[data-swup], #swup')) add('swup', 0.9, '[data-swup]');
      if (W.PIXI) add('pixi', 1, 'window.PIXI', W.PIXI.VERSION);
      if (W.BABYLON) add('babylon', 1, 'window.BABYLON');
      if (W.lottie || W.bodymovin || D.querySelector('lottie-player, dotlottie-player')) add('lottie', 1, 'lottie global/player');
      if (W.Swiper || D.querySelector('.swiper')) add('swiper', 0.9, '.swiper');
      if (W.__REACT_DEVTOOLS_GLOBAL_HOOK__ && W.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers && W.__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size) add('react', 1, 'react renderer');
      if (D.querySelector('[data-v-app]') || W.__VUE__) add('vue', 1, 'vue app');
      if (D.querySelector('[class*="svelte-"]')) add('svelte', 0.9, 'svelte-* classes');
      if (D.querySelector('[data-astro-cid], astro-island')) add('astro', 1, 'astro');
      if (gl.contexts.some((c) => c.type && c.type.startsWith('webgl'))) add('webgl', 1, 'WebGL context created');
      if (gl.wgsl.length) add('webgpu', 1, 'createShaderModule');
      const PLUGINS = ['ScrollTrigger', 'SplitText', 'ScrollSmoother', 'Flip', 'CustomEase', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin', 'Draggable', 'InertiaPlugin', 'Observer', 'ScrollToPlugin', 'ScrambleTextPlugin', 'TextPlugin', 'PixiPlugin', 'Physics2DPlugin'];
      for (const p of PLUGINS) if (W[p]) add(p.toLowerCase().replace(/plugin$/, ''), 1, 'window.' + p);
      const gp = g && g.plugins;
      if (gp) for (const k in gp) {
        const hit = PLUGINS.find((p) => p.toLowerCase().replace(/plugin$/, '') === k.toLowerCase().replace(/plugin$/, ''));
        if (hit) add(hit.toLowerCase().replace(/plugin$/, ''), 0.95, 'gsap.plugins.' + k);
      }
      // bundle signatures
      const scripts = performance.getEntriesByType('resource').filter((e) => e.initiatorType === 'script' || /\.m?js(\?|$)/.test(e.name)).slice(0, 30);
      const inline = Array.from(D.querySelectorAll('script:not([src])')).map((s) => s.textContent || '').join('\n').slice(0, 2000000);
      const scan = (text, src) => {
        for (const sig of SIGNATURES) {
          if (sig.re.test(text)) {
            let v = null;
            if (sig.ver) {
              const m = sig.ver.exec(text);
              if (m) v = m[1] || m[2];
            }
            add(sig.name, sig.weak ? 0.5 : 0.75, 'bundle signature in ' + src.split('/').pop().slice(0, 60), v);
          }
        }
      };
      if (inline) scan(inline, 'inline scripts');
      if (N.fetch) {
        await Promise.all(
          scripts.map(async (e) => {
            try {
              const ctrl = new AbortController();
              const to = N.setTimeout(() => ctrl.abort(), 4000);
              const res = await N.fetch(e.name, { credentials: 'omit', signal: ctrl.signal, cache: 'force-cache' });
              N.clearTimeout(to);
              if (!res.ok) return;
              const txt = (await res.text()).slice(0, 4000000);
              scan(txt, e.name);
            } catch (err) {
              /* CORS or network */
            }
          })
        );
      }
      // behavioural evidence
      if (rec.frames.length > 60) {
        const lastSec = rec.frames.slice(-60);
        if (lastSec.length >= 55) add('raf-loop', 0.6, 'continuous rAF observed');
      }
    } catch (e) {
      journal.error('stack', e);
    }
    return [...found.values()].sort((a, b) => b.confidence - a.confidence);
  }

  // ================================================================ GSAP final state (collect)
  function gsapState() {
    const g = gsapLog.instance || W.gsap;
    const out = { available: !!g, version: g && g.version, calls: gsapLog.calls, plugins: gsapLog.plugins, scrollTriggerCreates: gsapLog.scrollTriggerCreates, tweens: [], scrollTriggers: [] };
    if (!g) return out;
    try {
      const idOf = new WeakMap();
      let seq = 0;
      const tid = (a) => {
        if (!a) return null;
        if (!idOf.has(a)) idOf.set(a, 'g' + ++seq);
        return idOf.get(a);
      };
      const describe = (a, parent) => {
        const isTL = typeof a.getChildren === 'function';
        const vars = sanitize(a.vars || {});
        let ease = a.vars && a.vars.ease;
        if (typeof ease === 'function') ease = ease.__dipEaseName || '[custom]';
        const o = {
          id: tid(a),
          kind: isTL ? 'timeline' : 'tween',
          parent: parent ? tid(parent) : null,
          startTime: r3(a.startTime()),
          duration: r3(a.duration()),
          delay: r3(a.delay()),
          repeat: a.repeat ? a.repeat() : 0,
          yoyo: a.yoyo ? a.yoyo() : false,
          ease: ease || null,
          vars,
          progress: r3(a.progress()),
          targets: isTL ? [] : describeTargets(a.targets ? a.targets() : []),
          stagger: a.vars && a.vars.stagger != null ? sanitize(a.vars.stagger) : null,
          scrollTrigger: a.scrollTrigger ? tid(a.scrollTrigger) : null,
          label: a.vars && a.vars.id,
        };
        if (!isTL && a._from) o.from = true;
        return o;
      };
      const r3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x);
      const walk = (tl, depth) => {
        if (depth > 6 || out.tweens.length > 1500) return;
        for (const c of tl.getChildren(false, true, true)) {
          out.tweens.push(describe(c, tl === g.globalTimeline ? null : tl));
          if (typeof c.getChildren === 'function') walk(c, depth + 1);
        }
      };
      walk(g.globalTimeline, 0);
      const ST = gsapLog.ST || W.ScrollTrigger || (g.plugins && g.plugins.ScrollTrigger) || (g.core && g.core.globals && g.core.globals().ScrollTrigger);
      if (ST && ST.getAll) {
        for (const st of ST.getAll()) {
          const v = st.vars || {};
          out.scrollTriggers.push({
            id: tid(st),
            trigger: st.trigger ? selector(st.trigger) : null,
            triggerNid: st.trigger ? nid(st.trigger) : null,
            start: Math.round(st.start),
            end: Math.round(st.end),
            startVar: sanitize(v.start),
            endVar: sanitize(v.end),
            scrub: sanitize(v.scrub),
            pin: v.pin ? (v.pin === true ? selector(st.trigger) : sanitize(v.pin)) : null,
            pinNid: st.pin ? nid(st.pin) : null,
            pinSpacing: v.pinSpacing,
            snap: sanitize(v.snap),
            toggleActions: v.toggleActions || null,
            toggleClass: sanitize(v.toggleClass),
            horizontal: !!v.horizontal,
            animation: st.animation ? tid(st.animation) : null,
            markers: !!v.markers,
            callbacks: Object.keys(v).filter((k) => k.startsWith('on')),
          });
        }
      }
      // CustomEase curves
      const CE = W.CustomEase || (g.plugins && g.plugins.CustomEase);
      if (CE && CE.getSVGData) {
        out.customEases = [];
        for (const t of out.tweens) {
          if (typeof t.ease === 'string' && !/^(power|expo|circ|sine|back|elastic|bounce|none|linear|quad|cubic|quart|quint|strong)/.test(t.ease)) {
            try {
              const d = CE.getSVGData(t.ease, { width: 100, height: 100 });
              if (d && !out.customEases.some((x) => x.name === t.ease)) out.customEases.push({ name: t.ease, path: d });
            } catch (e) {
              /* not a custom ease */
            }
          }
        }
      }
    } catch (e) {
      journal.error('gsapState', e);
    }
    return out;
  }

  // ================================================================ Three.js scene graph
  function threeState() {
    const out = { revision: W.__THREE__ || null, renderers: [], scenes: [], camera: null };
    try {
      const v3 = (v) => (v ? [r2(v.x), r2(v.y), r2(v.z)] : null);
      const col = (c) => (c && c.getHexString ? '#' + c.getHexString() : null);
      for (const r of three.renderers) {
        const o = { type: r.constructor && r.constructor.name, toneMapping: r.toneMapping, toneMappingExposure: r.toneMappingExposure, outputColorSpace: r.outputColorSpace || r.outputEncoding, pixelRatio: r.getPixelRatio && r.getPixelRatio(), shadowMap: r.shadowMap && r.shadowMap.enabled, physicallyCorrectLights: r.physicallyCorrectLights || r.useLegacyLights === false };
        try {
          const s = r.getSize && r.getSize({ x: 0, y: 0, set(x, y) { this.x = x; this.y = y; return this; } });
          if (s) o.size = [s.x, s.y];
        } catch (e) {
          /* ignore */
        }
        out.renderers.push(o);
      }
      // main camera = the one rendering the largest scene (the last render is often a full-screen post pass)
      let biggest = null, size = -1;
      for (const sc of three.scenes) {
        let n = 0;
        try {
          sc.traverse(() => n++);
        } catch (e) {
          /* ignore */
        }
        if (n > size && three.cameraOf.get(sc)) {
          size = n;
          biggest = sc;
        }
      }
      const cam = (biggest && three.cameraOf.get(biggest)) || three.lastCamera;
      if (cam) out.camera = { type: cam.type, fov: cam.fov, near: cam.near, far: cam.far, zoom: cam.zoom, position: v3(cam.position), rotation: v3(cam.rotation) };
      for (const scene of three.scenes) {
        const s = { background: scene.background && scene.background.isColor ? col(scene.background) : scene.background ? 'texture' : null, fog: scene.fog ? { type: scene.fog.isFogExp2 ? 'FogExp2' : 'Fog', color: col(scene.fog.color), near: scene.fog.near, far: scene.fog.far, density: scene.fog.density } : null, objects: [] };
        let n = 0;
        scene.traverse((obj) => {
          if (n++ > 400) return;
          const o = { type: obj.type, name: obj.name || null, position: v3(obj.position), rotation: v3(obj.rotation), scale: v3(obj.scale), visible: obj.visible };
          if (obj.isLight) Object.assign(o, { color: col(obj.color), intensity: obj.intensity, castShadow: obj.castShadow, distance: obj.distance, angle: obj.angle });
          if (obj.isMesh || obj.isPoints || obj.isLine || obj.isInstancedMesh) {
            const g = obj.geometry;
            if (g) o.geometry = { type: g.type, parameters: sanitize(g.parameters), vertices: g.attributes && g.attributes.position ? g.attributes.position.count : null, index: g.index ? g.index.count : null };
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            o.materials = mats.filter(Boolean).map((m) => {
              const mo = { type: m.type, transparent: m.transparent, opacity: m.opacity, side: m.side, wireframe: m.wireframe, color: col(m.color), emissive: col(m.emissive), roughness: m.roughness, metalness: m.metalness, map: !!m.map, normalMap: !!m.normalMap, envMap: !!m.envMap, blending: m.blending, depthWrite: m.depthWrite };
              if (m.uniforms) mo.uniforms = Object.keys(m.uniforms).slice(0, 40);
              if (m.isShaderMaterial || m.isRawShaderMaterial) {
                mo.vertexShader = String(m.vertexShader || '').slice(0, 50000);
                mo.fragmentShader = String(m.fragmentShader || '').slice(0, 50000);
              }
              return mo;
            });
            if (obj.isInstancedMesh) o.instances = obj.count;
          }
          if (obj.isCamera) Object.assign(o, { fov: obj.fov, near: obj.near, far: obj.far });
          s.objects.push(o);
        });
        out.scenes.push(s);
      }
    } catch (e) {
      journal.error('three', e);
    }
    return out;
  }

  // ================================================================ WebGL state
  function glState() {
    const uniforms = [];
    for (const u of gl.uniforms.values()) uniforms.push({ pid: u.pid, name: u.name, kind: u.kind, count: u.count, samples: u.samples });
    let renderer = null;
    try {
      const c = D.createElement('canvas');
      ownCanvas = c;
      const ctx = c.getContext('webgl');
      if (ctx) {
        const ext = ctx.getExtension('WEBGL_debug_renderer_info');
        renderer = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
        const lose = ctx.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      }
    } catch (e) {
      /* ignore */
    }
    // refresh canvas rects (may have been created before layout)
    for (const c of gl.contexts) {
      try {
        const el = c.canvas && c.canvas.nid && elByNid(c.canvas.nid);
        if (el) c.canvas = canvasInfo(el);
      } catch (e) {
        /* ignore */
      }
    }
    return {
      contexts: gl.contexts,
      programs: gl.programs,
      uniforms,
      textures: gl.textures,
      drawCallsPerFrame: summarize(gl.drawCallsPerFrame),
      verticesMax: gl.verticesMax,
      canvas2d: [...gl.canvas2d.values()],
      wgsl: gl.wgsl,
      gpu: renderer,
    };
  }
  function summarize(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
  }

  // ================================================================ P8 — assets
  function getAssets() {
    const out = { images: [], backgrounds: [], videos: [], svgs: [], fonts: [], models: [], lottie: [], rive: [], other: [], totals: {} };
    try {
      for (const img of D.images) {
        if (out.images.length >= 300) break;
        const r = img.getBoundingClientRect();
        out.images.push({ selector: selector(img), url: img.currentSrc || img.src, natural: [img.naturalWidth, img.naturalHeight], displayed: [Math.round(r.width), Math.round(r.height)], y: Math.round(r.top + scrollPos()), srcset: img.getAttribute('srcset') ? true : false, loading: img.loading, alt: img.alt, objectFit: N.getCS(img).objectFit });
      }
      let n = 0;
      for (const el of D.body.getElementsByTagName('*')) {
        if (n++ > 6000 || out.backgrounds.length > 150) break;
        const bi = N.getCS(el).backgroundImage;
        if (bi && bi.includes('url(')) {
          const urls = (bi.match(/url\(["']?([^"')]+)["']?\)/g) || []).map((u) => u.replace(/^url\(["']?|["']?\)$/g, ''));
          const r = el.getBoundingClientRect();
          out.backgrounds.push({ selector: selector(el), urls, displayed: [Math.round(r.width), Math.round(r.height)], size: N.getCS(el).backgroundSize });
        }
      }
      for (const v of D.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        out.videos.push({ selector: selector(v), url: v.currentSrc || v.src, duration: isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null, resolution: [v.videoWidth, v.videoHeight], displayed: [Math.round(r.width), Math.round(r.height)], loop: v.loop, muted: v.muted, autoplay: v.autoplay, playsInline: v.playsInline, poster: v.poster || null });
      }
      for (const s of D.querySelectorAll('svg')) {
        if (out.svgs.length >= 60) break;
        if (s.parentElement && s.parentElement.closest('svg')) continue;
        const r = s.getBoundingClientRect();
        if (r.width < 4) continue;
        const html = s.outerHTML;
        out.svgs.push({ selector: selector(s), displayed: [Math.round(r.width), Math.round(r.height)], paths: s.querySelectorAll('path').length, bytes: html.length, markup: html.length < 20000 ? html : null });
      }
      const res = performance.getEntriesByType('resource');
      const totals = {};
      for (const e of res) {
        const url = e.name;
        const type = /\.(woff2?|ttf|otf)(\?|$)/i.test(url) ? 'font' : /\.(glb|gltf|drc|obj|fbx|usdz|ktx2|hdr|exr)(\?|$)/i.test(url) ? 'model' : /\.riv(\?|$)/i.test(url) ? 'rive' : /\.json(\?|$)/i.test(url) && /lottie|anim|bodymovin/i.test(url) ? 'lottie' : /\.(png|jpe?g|webp|avif|gif|svg)(\?|$)/i.test(url) ? 'image' : /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(url) ? 'video' : e.initiatorType === 'script' || /\.m?js(\?|$)/.test(url) ? 'script' : e.initiatorType === 'css' || /\.css(\?|$)/.test(url) ? 'css' : 'other';
        totals[type] = totals[type] || { count: 0, bytes: 0 };
        totals[type].count++;
        totals[type].bytes += e.transferSize || e.encodedBodySize || 0;
        if (type === 'font' && out.fonts.length < 60) out.fonts.push({ url, bytes: e.encodedBodySize });
        if (type === 'model' && out.models.length < 40) out.models.push({ url, bytes: e.encodedBodySize, draco: /draco|\.drc/i.test(url) });
        if (type === 'lottie' && out.lottie.length < 30) out.lottie.push({ url, bytes: e.encodedBodySize });
        if (type === 'rive' && out.rive.length < 30) out.rive.push({ url, bytes: e.encodedBodySize });
      }
      out.totals = totals;
      out.frames = Array.from(D.querySelectorAll('iframe')).slice(0, 20).map((f) => ({ src: f.src, selector: selector(f), crossOrigin: (() => { try { return !f.contentDocument; } catch (e) { return true; } })() }));
    } catch (e) {
      journal.error('assets', e);
    }
    return out;
  }

  function getContent(sections) {
    const out = [];
    try {
      for (const s of sections || []) {
        const el = elByNid(s.nid) || D.querySelector(s.selector);
        if (!el) continue;
        const blocks = [];
        const walker = D.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
        let node;
        while ((node = walker.nextNode()) && blocks.length < 80) {
          const tn = node.localName;
          if (!/^(h[1-6]|p|li|a|button|blockquote|figcaption|span|label|dt|dd|small|strong|em)$/.test(tn)) continue;
          const txt = ownText(node);
          if (!txt || txt.length < 2) continue;
          if (!visible(node)) continue;
          blocks.push({ tag: tn, text: txt.slice(0, 400) });
        }
        out.push({ section: s.id, blocks });
      }
    } catch (e) {
      journal.error('content', e);
    }
    return out;
  }

  function getPerf() {
    const nav = performance.getEntriesByType('navigation')[0];
    const fr = rec.frames.map((f) => f[1]).filter((x) => x > 0 && x < 1000);
    return {
      navigation: nav ? { domContentLoaded: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), transferSize: nav.transferSize } : null,
      paints: perf.paints,
      lcp: perf.lcp,
      cls: Math.round(perf.cls * 1000) / 1000,
      longtasks: { count: perf.longtasks.length, total: perf.longtasks.reduce((a, b) => a + b.d, 0) },
      loaf: { count: perf.loaf.length, worst: perf.loaf.reduce((a, b) => Math.max(a, b.d), 0) },
      frames: summarize(fr),
      probeOverhead: summarize(rec.frames.map((f) => f[2])),
      memory: performance.memory ? { usedJSHeap: performance.memory.usedJSHeapSize, totalJSHeap: performance.memory.totalJSHeapSize } : null,
      machine: { cores: navigator.hardwareConcurrency, memoryGB: navigator.deviceMemory || null, dpr: W.devicePixelRatio, ua: navigator.userAgent },
    };
  }

  function recorderData() {
    const tracks = [];
    for (const tk of rec.tracked.values()) {
      if (tk.t.length < 2) continue;
      const { el, lastSig, lastClip, lastFilter, wantRect, ...rest } = tk;
      const el2 = el.deref();
      if (el2) {
        rest.parentSel = el2.parentElement ? selector(el2.parentElement) : null;
        rest.parentNid = el2.parentElement ? nid(el2.parentElement) : null;
        rest.index = el2.parentElement ? Array.prototype.indexOf.call(el2.parentElement.children, el2) : 0;
        rest.position = N.getCS(el2).position;
        rest.isMedia = /^(img|video|canvas|picture|figure)$/.test(tk.tag) || !!el2.querySelector('img,video,canvas');
      }
      if (!rest.top.some((x) => x !== null)) {
        delete rest.top;
        delete rest.left;
      }
      tracks.push(rest);
    }
    return { tracks, frames: rec.frames, chunk: rec.chunk };
  }

  // Fetch a resource from the page context (same origin / CORS) and return it as base64. Study mode only.
  async function fetchBase64(url, maxBytes) {
    try {
      if (!N.fetch) return null;
      const ctrl = new AbortController();
      const to = N.setTimeout(() => ctrl.abort(), 8000);
      const res = await N.fetch(url, { credentials: 'omit', signal: ctrl.signal, cache: 'force-cache' });
      N.clearTimeout(to);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength > (maxBytes || 3e6)) return { tooBig: buf.byteLength };
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), type: res.headers.get('content-type'), bytes: buf.byteLength };
    } catch (e) {
      return null;
    }
  }

  // ================================================================ public API
  const api = {
    version: VERSION,
    t0: T0,
    rel,
    ping: () => ({ ok: true, version: VERSION, t: rel(), readyState: D.readyState, url: location.href, title: D.title, vw: W.innerWidth, vh: W.innerHeight, docHeight: docHeight(), scroll: scrollPos(), dpr: W.devicePixelRatio }),
    mark: (name) => {
      journal.marks.push({ t: rel(), name, s: scrollPos() });
      return rel();
    },
    record: (on) => {
      rec.on = !!on;
      return rec.on;
    },
    resetRecorder: () => {
      rec.tracked.clear();
      rec.frames = [];
      return true;
    },
    waitStable,
    waitScrollStable,
    scrollToY,
    scrollPos,
    docHeight,
    detectScroll,
    startImpulse,
    getImpulse,
    detectPreloader,
    handleConsent,
    getSections,
    getGrid,
    snapshotDOM,
    getTokens,
    getSplits,
    listInteractive,
    styleSnapshot,
    rectOf,
    trackRects,
    rectsFor,
    tracksUnder,
    watch,
    layoutOf,
    // recorder tracks only (lighter than collectMotion)
    recorderData: () => recorderData(),
    findCursorCandidates,
    getContent,
    getAssets,
    getPerf,
    detectStack,
    gsapState,
    threeState,
    glState,
    fetchBase64,
    // Big raw dump. Called at the end of the scan.
    collectMotion: () => {
      sampleAnimations();
      return {
        gsap: gsapState(),
        waapi: { animateCalls: waapi.animateCalls, animations: [...waapi.seen.values()], events: waapi.events },
        mutations: mutations.classes,
        recorder: recorderData(),
        routes,
        listeners: { hoverElements: listeners.hoverEls.size, global: listeners.global, wheel: listeners.wheelTargets },
        marks: journal.marks,
        errors: journal.errors,
        events: journal.events,
      };
    },
    errors: () => journal.errors,
    // diagnostics: what is still changing (used to tune stabilisation)
    activity: () => ({ nonStyle: mutations.nonStyle, all: mutations.count, tracks: [...rec.tracked.values()].map((tk) => [tk.sel, tk.t.length, tk.t.length ? tk.t[tk.t.length - 1] : null]).filter((x) => x[1] > 1) }),
    sleep,
  };
  try {
    N.defineProperty(W, '__DIP__', { value: api, enumerable: false, configurable: true, writable: false });
  } catch (e) {
    /* ignore */
  }
})();
