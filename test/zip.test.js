import test from 'node:test';
import assert from 'node:assert/strict';
import { zip, crc32 } from '../extension/lib/zip.js';

test('crc32 of a known string', () => {
  assert.equal(crc32(new TextEncoder().encode('The quick brown fox jumps over the lazy dog')), 0x414fa339);
});

test('zip produces local headers and an end-of-central-directory record', async () => {
  const out = await zip([
    { path: 'a/hello.md', data: '# hello\n'.repeat(100) },
    { path: 'b/bin.png', data: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) },
  ]);
  const dv = new DataView(out.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(out.length - 22, true), 0x06054b50);
  assert.equal(dv.getUint16(out.length - 22 + 10, true), 2);
});
