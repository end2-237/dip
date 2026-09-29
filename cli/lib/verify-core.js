// verify-core: image and curve comparison used by dip-verify.
// Image maths run inside a Playwright page (canvas decode), so no native image dependency is needed.

export function interp(points, x) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1], [x1, y1] = points[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** RMS between two normalised curves [[x,y],...] sampled at 41 points. */
export function curveRms(ref, got) {
  if (!ref || !got || ref.length < 2 || got.length < 2) return null;
  let s = 0;
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    const d = interp(ref, x) - interp(got, x);
    s += d * d;
  }
  return Math.sqrt(s / (n + 1));
}

// CIE ΔE2000
export function hexToLab(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const R = f((n >> 16) & 255), G = f((n >> 8) & 255), B = f(n & 255);
  let X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  X = g(X);
  Y = g(Y);
  Z = g(Z);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const x = Math.atan2(b, a) / rad;
    return x < 0 ? x + 360 : x;
  };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh));
}

/**
 * Browser-side comparison (pass to page.evaluate). Returns multi-scale SSIM, mismatch ratio, a diff PNG,
 * and the bounding box of the worst region. `masks` are rects in clone CSS px (media areas).
 */
export async function compareInPage({ refB64, gotB64, masks, width }) {
  const load = async (b64) => createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const [ref, got] = await Promise.all([load(refB64), load(gotB64)]);
  const W = width || 320;
  const scaleRef = W / ref.width, scaleGot = W / got.width;
  const H = Math.max(8, Math.round(Math.min(ref.height * scaleRef, got.height * scaleGot)));
  const heightRatio = Math.min(ref.height * scaleRef, got.height * scaleGot) / Math.max(ref.height * scaleRef, got.height * scaleGot);
  const draw = (bmp, s) => {
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, bmp.width, H / s, 0, 0, W, H);
    g.fillStyle = '#808080';
    for (const m of masks || []) g.fillRect(m.x * scaleGot, m.y * scaleGot, m.w * scaleGot, m.h * scaleGot);
    return { c, d: g.getImageData(0, 0, W, H).data };
  };
  const A = draw(ref, scaleRef), B = draw(got, scaleGot);
  const gray = (d) => {
    const o = new Float32Array(W * H);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) o[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return o;
  };
  const ga = gray(A.d), gb = gray(B.d);
  const ssimAt = (a, b, w, h, win) => {
    const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
    let sum = 0, n = 0;
    const step = Math.max(2, win / 2);
    for (let y = 0; y + win <= h; y += step) {
      for (let x = 0; x + win <= w; x += step) {
        let ma = 0, mb = 0;
        for (let yy = 0; yy < win; yy++) for (let xx = 0; xx < win; xx++) {
          const k = (y + yy) * w + x + xx;
          ma += a[k];
          mb += b[k];
        }
        const N = win * win;
        ma /= N;
        mb /= N;
        let va = 0, vb = 0, cov = 0;
        for (let yy = 0; yy < win; yy++) for (let xx = 0; xx < win; xx++) {
          const k = (y + yy) * w + x + xx;
          const da = a[k] - ma, db = b[k] - mb;
          va += da * da;
          vb += db * db;
          cov += da * db;
        }
        va /= N - 1;
        vb /= N - 1;
        cov /= N - 1;
        sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
        n++;
      }
    }
    return n ? sum / n : 1;
  };
  const half = (a, w, h) => {
    const w2 = Math.floor(w / 2), h2 = Math.floor(h / 2);
    const o = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) o[y * w2 + x] = (a[2 * y * w + 2 * x] + a[2 * y * w + 2 * x + 1] + a[(2 * y + 1) * w + 2 * x] + a[(2 * y + 1) * w + 2 * x + 1]) / 4;
    return { o, w: w2, h: h2 };
  };
  const s1 = ssimAt(ga, gb, W, H, 8);
  const ha = half(ga, W, H), hb = half(gb, W, H);
  const s2 = ssimAt(ha.o, hb.o, ha.w, ha.h, 8);
  let ssim = 0.5 * s1 + 0.5 * s2;
  ssim *= 0.85 + 0.15 * heightRatio; // section height mismatch penalty
  // diff map
  const out = new OffscreenCanvas(W, H);
  const og = out.getContext('2d');
  og.drawImage(B.c, 0, 0);
  const img = og.getImageData(0, 0, W, H);
  let bad = 0;
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    const d = Math.abs(A.d[i] - B.d[i]) + Math.abs(A.d[i + 1] - B.d[i + 1]) + Math.abs(A.d[i + 2] - B.d[i + 2]);
    if (d > 90) {
      bad++;
      img.data[i] = 255;
      img.data[i + 1] = Math.round(img.data[i + 1] * 0.3);
      img.data[i + 2] = Math.round(img.data[i + 2] * 0.3);
      const x = j % W, y = Math.floor(j / W);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  og.putImageData(img, 0, 0);
  const blob = await out.convertToBlob({ type: 'image/png' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return {
    ssim: Math.max(0, Math.min(1, ssim)),
    mismatch: bad / (W * H),
    heightRatio,
    worst: bad ? { x: Math.round(minX / scaleGot), y: Math.round(minY / scaleGot), w: Math.round((maxX - minX) / scaleGot), h: Math.round((maxY - minY) / scaleGot) } : null,
    diffB64: btoa(s),
  };
}
