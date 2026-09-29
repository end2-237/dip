// Easing library: GSAP named eases, CSS cubic-bezier, and curve fitting.

const PI = Math.PI;

function powIn(p) {
  return (t) => Math.pow(t, p);
}
function makeOut(fin) {
  return (t) => 1 - fin(1 - t);
}
function makeInOut(fin) {
  return (t) => (t < 0.5 ? fin(t * 2) / 2 : 1 - fin((1 - t) * 2) / 2);
}
const IN = {
  power1: powIn(2),
  power2: powIn(3),
  power3: powIn(4),
  power4: powIn(5),
  sine: (t) => 1 - Math.cos((t * PI) / 2),
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  circ: (t) => 1 - Math.sqrt(Math.max(0, 1 - t * t)),
  back: (t) => {
    const s = 1.70158;
    return t * t * ((s + 1) * t - s);
  },
};
const ALIASES = { quad: 'power1', cubic: 'power2', quart: 'power3', quint: 'power4', strong: 'power4' };

// easings.net cubic-bezier equivalents (used when emitting CSS).
export const BEZIER = {
  'none': [0, 0, 1, 1],
  'power1.in': [0.11, 0, 0.5, 0],
  'power1.out': [0.5, 1, 0.89, 1],
  'power1.inOut': [0.45, 0, 0.55, 1],
  'power2.in': [0.32, 0, 0.67, 0],
  'power2.out': [0.33, 1, 0.68, 1],
  'power2.inOut': [0.65, 0, 0.35, 1],
  'power3.in': [0.5, 0, 0.75, 0],
  'power3.out': [0.25, 1, 0.5, 1],
  'power3.inOut': [0.76, 0, 0.24, 1],
  'power4.in': [0.64, 0, 0.78, 0],
  'power4.out': [0.22, 1, 0.36, 1],
  'power4.inOut': [0.83, 0, 0.17, 1],
  'sine.in': [0.12, 0, 0.39, 0],
  'sine.out': [0.61, 1, 0.88, 1],
  'sine.inOut': [0.37, 0, 0.63, 1],
  'expo.in': [0.7, 0, 0.84, 0],
  'expo.out': [0.16, 1, 0.3, 1],
  'expo.inOut': [0.87, 0, 0.13, 1],
  'circ.in': [0.55, 0, 1, 0.45],
  'circ.out': [0, 0.55, 0.45, 1],
  'circ.inOut': [0.85, 0, 0.15, 1],
  'back.in': [0.36, 0, 0.66, -0.56],
  'back.out': [0.34, 1.56, 0.64, 1],
  'back.inOut': [0.68, -0.6, 0.32, 1.6],
};
const CSS_NAMED = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dsx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  function solve(x) {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return t;
      const d = dsx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}

/** Parse a GSAP or CSS ease string into a function (t in [0,1] -> progress). */
export function easeFn(name) {
  if (typeof name !== 'string' || !name) return (t) => 1 - Math.pow(1 - t, 2); // GSAP default power1.out
  const s = name.trim();
  let m = /^cubic-bezier\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(',').map(Number);
    return cubicBezier(p[0], p[1], p[2], p[3]);
  }
  if (CSS_NAMED[s]) return cubicBezier(...CSS_NAMED[s]);
  if (s === 'none' || s === 'linear' || s === 'Linear.easeNone' || s === 'power0' || s.startsWith('power0')) return (t) => t;
  m = /^([a-zA-Z]+)\d?(?:\.(in|out|inOut))?(?:\(([^)]*)\))?$/.exec(s);
  if (m) {
    let base = m[1].toLowerCase();
    const pm = /^power(\d)/.exec(s);
    if (pm) base = 'power' + pm[1];
    base = ALIASES[base] || base;
    const dir = m[2] || 'out';
    let fin = IN[base];
    if (base === 'back' && m[3]) {
      const k = parseFloat(m[3]);
      fin = (t) => t * t * ((k + 1) * t - k);
    }
    if (base === 'elastic') {
      const amp = 1, period = 0.3;
      const fout = (t) => (t === 0 || t === 1 ? t : amp * Math.pow(2, -10 * t) * Math.sin(((t - period / 4) * (2 * PI)) / period) + 1);
      return dir === 'in' ? (t) => 1 - fout(1 - t) : dir === 'inOut' ? makeInOut((t) => 1 - fout(1 - t)) : fout;
    }
    if (base === 'bounce') {
      const fout = (t) => {
        const n = 7.5625, d = 2.75;
        if (t < 1 / d) return n * t * t;
        if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
        if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
        return n * (t -= 2.625 / d) * t + 0.984375;
      };
      return dir === 'in' ? (t) => 1 - fout(1 - t) : dir === 'inOut' ? makeInOut((t) => 1 - fout(1 - t)) : fout;
    }
    if (fin) return dir === 'in' ? fin : dir === 'inOut' ? makeInOut(fin) : makeOut(fin);
  }
  return (t) => 1 - Math.pow(1 - t, 2);
}

/** Canonical GSAP-style name, e.g. "power3" -> "power3.out", "Power2.easeOut" -> "power2.out". */
export function normalizeEaseName(s) {
  if (typeof s !== 'string') return null;
  const legacy = /^(Power\d|Expo|Circ|Sine|Back|Elastic|Bounce|Quad|Cubic|Quart|Quint|Strong)\.ease(In|Out|InOut)$/.exec(s);
  if (legacy) {
    const b = legacy[1].toLowerCase();
    return (ALIASES[b] || b) + '.' + (legacy[2] === 'InOut' ? 'inOut' : legacy[2].toLowerCase());
  }
  if (/^(power\d|expo|circ|sine|back|elastic|bounce)$/.test(s)) return s + '.out';
  return s;
}

export function bezierFor(name) {
  const n = normalizeEaseName(name);
  if (!n) return null;
  if (BEZIER[n]) return BEZIER[n];
  const b = n.replace(/\(.*\)$/, '');
  if (BEZIER[b]) return BEZIER[b];
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(n);
  if (m) return m[1].split(',').map(Number);
  if (CSS_NAMED[n]) return CSS_NAMED[n];
  return null;
}

export function rmsAgainst(fn, xs, ys) {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    const d = fn(xs[i]) - ys[i];
    s += d * d;
  }
  return Math.sqrt(s / Math.max(1, xs.length));
}

// Nelder–Mead for the 4 bezier control values.
function nelderMead(f, x0, iters) {
  const n = x0.length;
  let simplex = [x0];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] += 0.15;
    simplex.push(x);
  }
  let vals = simplex.map(f);
  for (let k = 0; k < (iters || 250); k++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    simplex = idx.map((i) => simplex[i]);
    vals = idx.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < 1e-7) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const xr = c.map((v, j) => v + (v - worst[j]));
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((v, j) => v + 2 * (v - worst[j]));
      const fe = f(xe);
      if (fe < fr) {
        simplex[n] = xe;
        vals[n] = fe;
      } else {
        simplex[n] = xr;
        vals[n] = fr;
      }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr;
      vals[n] = fr;
    } else {
      const xc = c.map((v, j) => v + 0.5 * (worst[j] - v));
      const fc = f(xc);
      if (fc < vals[n]) {
        simplex[n] = xc;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          vals[i] = f(simplex[i]);
        }
      }
    }
  }
  return { x: simplex[0], f: vals[0] };
}

const NAMED_CANDIDATES = [
  'none',
  ...['power1', 'power2', 'power3', 'power4', 'sine', 'expo', 'circ', 'back'].flatMap((b) => [b + '.in', b + '.out', b + '.inOut']),
  'ease', 'ease-in', 'ease-out', 'ease-in-out',
];

/**
 * Fit a normalised progress curve.
 * @param {number[]} xs normalised time/scroll in [0,1]
 * @param {number[]} ys normalised progress in [0,1] (may overshoot)
 * @returns {{named:string, namedRms:number, bezier:number[], bezierRms:number, best:string, rms:number}}
 */
export function fitEase(xs, ys) {
  let best = { name: 'none', rms: Infinity };
  for (const n of NAMED_CANDIDATES) {
    const r = rmsAgainst(easeFn(n), xs, ys);
    if (r < best.rms) best = { name: n, rms: r };
  }
  // too few samples: a free 4-parameter bezier would overfit (e.g. y1 = 2.3); keep the nearest named ease
  if (xs.length < 8) {
    const bz0 = bezierFor(best.name) || [0.25, 0.1, 0.25, 1];
    return { named: best.name, namedRms: round4(best.rms), bezier: bz0, bezierRms: round4(best.rms), best: best.name, rms: round4(best.rms), fewSamples: true };
  }
  const start = bezierFor(best.name) || [0.25, 0.1, 0.25, 1];
  const obj = (p) => {
    const x1 = Math.min(1, Math.max(0, p[0])), x2 = Math.min(1, Math.max(0, p[2]));
    // x in [0,1] (CSS rule); y kept within [-0.6, 1.6]: beyond that the fit is chasing noise
    const pen = Math.abs(p[0] - x1) + Math.abs(p[2] - x2) + Math.max(0, Math.abs(p[1] - 0.5) - 1.1) + Math.max(0, Math.abs(p[3] - 0.5) - 1.1);
    return rmsAgainst(cubicBezier(x1, p[1], x2, p[3]), xs, ys) + pen;
  };
  const nm = nelderMead(obj, start.slice(), 300);
  const bz = [nm.x[0], nm.x[1], nm.x[2], nm.x[3]].map((v, i) => Math.round((i % 2 === 0 ? Math.min(1, Math.max(0, v)) : v) * 1000) / 1000);
  const bzRms = rmsAgainst(cubicBezier(...bz), xs, ys);
  const namedWins = best.rms <= bzRms * 1.35 || best.rms < 0.012;
  return {
    named: best.name,
    namedRms: round4(best.rms),
    bezier: bz,
    bezierRms: round4(bzRms),
    best: namedWins ? best.name : `cubic-bezier(${bz.join(', ')})`,
    rms: round4(namedWins ? best.rms : bzRms),
  };
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

/** Resample a named ease into n points (used to write reference curves for GSAP-read effects). */
export function sampleEase(name, n) {
  const f = easeFn(name);
  const out = [];
  for (let i = 0; i <= (n || 40); i++) {
    const x = i / (n || 40);
    out.push([round4(x), round4(f(x))]);
  }
  return out;
}
