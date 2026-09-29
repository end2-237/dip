// Zips extension/ into dist/dip-extension-<version>.zip (for sharing or the Chrome Web Store).
import fs from 'node:fs';
import path from 'node:path';
import { zip } from '../extension/lib/zip.js';

const root = path.resolve('extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else files.push({ path: path.relative(root, p).split(path.sep).join('/'), data: new Uint8Array(fs.readFileSync(p)) });
  }
})(root);
fs.mkdirSync('dist', { recursive: true });
const out = path.join('dist', `dip-extension-${manifest.version}.zip`);
fs.writeFileSync(out, await zip(files));
console.log(`${out} (${files.length} files)`);
