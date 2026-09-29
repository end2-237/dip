import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { geometryToGlb } from '../extension/lib/glb.js';
import { zip } from '../extension/lib/zip.js';
import { unzip } from '../cli/lib/unzip.js';

const b64 = (arr) => Buffer.from(arr.buffer).toString('base64');

test('geometryToGlb writes a well-formed binary glTF', () => {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const glb = geometryToGlb({ name: 'tri', position: b64(pos), normal: b64(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])), uv: null, index: b64(new Uint32Array([0, 1, 2])), min: [0, 0, 0], max: [1, 1, 0], mode: 4, material: { type: 'MeshStandardMaterial', color: '#ff0000', roughness: 0.5, metalness: 0 } });
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67);
  assert.equal(dv.getUint32(8, true), glb.length);
  const jsonLen = dv.getUint32(12, true);
  assert.equal(jsonLen % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
  assert.equal(json.accessors[0].count, 3);
  assert.equal(json.meshes[0].primitives[0].indices, 2);
  assert.equal(dv.getUint32(20 + jsonLen, true), json.buffers[0].byteLength);
  assert.equal(json.materials[0].pbrMetallicRoughness.baseColorFactor[0], 1);
});

test('unzip reads the zips written by the extension', async () => {
  const files = [{ path: 'p/manifest.json', data: new TextEncoder().encode('{"url":"https://x.test"}') }, { path: 'p/a/b.txt', data: new TextEncoder().encode('x'.repeat(5000)) }];
  const out = unzip(Buffer.from(await zip(files)));
  assert.deepEqual(out.map((f) => f.path), ['p/manifest.json', 'p/a/b.txt']);
  assert.equal(out[1].data.toString(), 'x'.repeat(5000));
});

test('dip-library indexes packs and exposes the Claude Code commands', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diplib-'));
  const pack = [
    { path: 'dip-pack_a.test/manifest.json', data: JSON.stringify({ url: 'https://a.test/', tier: 'B', detectedStack: [{ name: 'gsap', confidence: 1 }] }) },
    { path: 'dip-pack_a.test/design/tokens.json', data: JSON.stringify({ color: { 'palette-01': { $value: '#111111', $extensions: { dip: { share: 0.8, role: 'background' } } } } }) },
    { path: 'dip-pack_a.test/motion/effects/e01-hero-text-reveal-lines.json', data: JSON.stringify({ id: 'e01-hero-text-reveal-lines', effect_type: 'text-reveal-lines', trigger: 'load', animation: { duration: 1.2, ease: 'expo.out', stagger: 0.08 }, confidence: 0.9 }) },
  ].map((f) => ({ path: f.path, data: new TextEncoder().encode(f.data) }));
  fs.writeFileSync(path.join(tmp, 'a.zip'), await zip(pack));
  const lib = path.join(tmp, 'lib');
  execFileSync('node', ['cli/dip-library.js', 'add', path.join(tmp, 'a.zip'), '--lib', lib], { stdio: 'pipe' });
  const idx = JSON.parse(fs.readFileSync(path.join(lib, 'index.json'), 'utf8'));
  assert.equal(idx.packs[0].domain, 'a.test');
  assert.equal(idx.packs[0].effects[0].ease, 'expo.out');
  assert.match(fs.readFileSync(path.join(lib, 'EFFECTS.md'), 'utf8'), /text-reveal-lines[\s\S]*1\.2s, expo\.out, stagger 0\.08/);
  assert.ok(fs.existsSync(path.join(lib, '.claude/commands/dip-create.md')));
  assert.ok(fs.existsSync(path.join(lib, '.claude/commands/dip-clone.md')));
  const found = execFileSync('node', ['cli/dip-library.js', 'search', 'gsap', '--effect', 'text-reveal-lines', '--lib', lib]).toString();
  assert.match(found, /a\.test[\s\S]*e01-hero-text-reveal-lines/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
