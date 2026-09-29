// Integration: scan each fixture with the real probes + CDP driver (headless Chromium) and compare
// with its expected.json ground truth. Needs Playwright + Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { serve } from '../cli/lib/serve.js';
import { capture } from '../cli/dip-capture.js';

const near = (a, b, tol) => Math.abs(a - b) <= tol;

for (const fx of ['gsap-lenis', 'css-only', 'webgl-shader', 'three-interactions']) {
  test(`fixture ${fx} matches expected.json`, { timeout: 300000 }, async () => {
    const expected = JSON.parse(fs.readFileSync(`fixtures/${fx}/expected.json`, 'utf8'));
    const s = await serve('fixtures', 0);
    let res;
    try {
      res = await capture(`${s.url}/${fx}/`, { headless: true, breakpoints: [1440], maxHovers: 8, quiet: true });
    } finally {
      await s.close();
    }
    const { cap, analysis } = res;
    assert.ok(analysis, 'analysis produced');
    assert.deepEqual(cap.log.filter((l) => l.level === 'error'), []);
    const names = new Set(analysis.stack.filter((x) => x.confidence >= 0.7).map((x) => x.name));
    for (const n of expected.stack) assert.ok(names.has(n), `stack ${n} detected`);
    assert.equal(analysis.scroll.type, expected.scroll.type);
    if (expected.scroll.lerp) assert.ok(near(analysis.scroll.measuredLerp, expected.scroll.lerp, expected.scroll.lerp * 0.1), `lerp ${analysis.scroll.measuredLerp}`);
    for (const ex of expected.effects) {
      const hit = analysis.effects.find((e) => (!ex.effect_type || e.effect_type === ex.effect_type) && e.trigger === ex.trigger && e.source === ex.source);
      assert.ok(hit, `effect ${JSON.stringify(ex)} found`);
      const a = hit.animation || {};
      if (ex.duration != null) assert.ok(near(a.duration, ex.duration, ex.duration * 0.05), `${hit.id} duration ${a.duration}`);
      if (ex.ease) assert.equal(a.ease, ex.ease);
      if (ex.stagger != null) assert.ok(near(a.stagger, ex.stagger, 0.01), `${hit.id} stagger ${a.stagger}`);
      if (ex.delay != null) assert.ok(near(a.delay, ex.delay, 0.05), `${hit.id} delay ${a.delay}`);
    }
    assert.ok(analysis.effects.length <= (expected.maxEffects || expected.effects.length + 1), `no spurious effects (${analysis.effects.map((e) => e.id).join(', ')})`);
    for (const w of expected.webgl || []) {
      const card = analysis.webgl.cards.find((c) => c.type === w.type);
      assert.ok(card, `webgl ${w.type}`);
      for (const [u, drv] of Object.entries(w.uniforms)) assert.equal(card.uniforms.find((x) => x.name === u).drivenBy, drv);
    }
    if (expected.tier) assert.equal(analysis.tier.tier, expected.tier);
    for (const name of expected.customGeometry || []) assert.ok((cap.threeGeometry || []).some((g) => g.name === name && g.position), `custom geometry ${name} exported`);
    // probe overhead budget (spec §17.1): < 5% of a 16.7ms frame at p95
    assert.ok(cap.perf.probeOverhead.p95 < 0.84, `probe overhead p95 ${cap.perf.probeOverhead.p95}ms`);
  });
}
