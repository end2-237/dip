import test from 'node:test';
import assert from 'node:assert/strict';
import { fitEase, easeFn, cubicBezier, bezierFor, normalizeEaseName } from '../extension/lib/easing.js';

const sample = (f, n = 40) => {
  const xs = [], ys = [];
  for (let i = 0; i <= n; i++) {
    xs.push(i / n);
    ys.push(f(i / n));
  }
  return { xs, ys };
};

for (const name of ['expo.out', 'power3.out', 'power2.inOut', 'sine.in', 'circ.out', 'none']) {
  test(`fitEase recovers ${name}`, () => {
    const { xs, ys } = sample(easeFn(name));
    const fit = fitEase(xs, ys);
    assert.equal(fit.named, name);
    assert.ok(fit.rms < 0.01, `rms ${fit.rms}`);
  });
}

test('fitEase fits an arbitrary cubic-bezier within 3% RMS', () => {
  const { xs, ys } = sample(cubicBezier(0.65, 0, 0.35, 1));
  const fit = fitEase(xs, ys);
  assert.ok(fit.rms < 0.03, `rms ${fit.rms}`);
});

test('cubic-bezier endpoints and monotonicity', () => {
  const f = cubicBezier(0.16, 1, 0.3, 1);
  assert.equal(f(0), 0);
  assert.equal(f(1), 1);
  let prev = 0;
  for (let i = 1; i <= 20; i++) {
    const v = f(i / 20);
    assert.ok(v >= prev - 1e-9);
    prev = v;
  }
});

test('ease name normalisation and bezier lookup', () => {
  assert.equal(normalizeEaseName('Power2.easeOut'), 'power2.out');
  assert.equal(normalizeEaseName('expo'), 'expo.out');
  assert.deepEqual(bezierFor('expo.out'), [0.16, 1, 0.3, 1]);
  assert.deepEqual(bezierFor('cubic-bezier(0.1, 0.2, 0.3, 0.4)'), [0.1, 0.2, 0.3, 0.4]);
});
