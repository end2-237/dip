#!/usr/bin/env node
// dip-assets — produce ORIGINAL images and 3D models for a DIP build, pay per use (no subscription).
//
//   node cli/dip-assets.js image  --prompt "..." [--size 1600x900] [--model fal-ai/flux/dev] --out public/img/hero.webp
//   node cli/dip-assets.js model  --prompt "..." [--engine trellis|rodin|hunyuan] --out public/models/apple.glb
//   node cli/dip-assets.js model  --image ref.png [--engine trellis|rodin|hunyuan] --out public/models/apple.glb
//   node cli/dip-assets.js optimize <file.glb|file.png|file.jpg> [--max 2048] [--out file]
//
// image / model use fal.ai (pay per call): create a key at https://fal.ai/dashboard/keys and set it in the
// environment, never in a file of the project:  PowerShell  $env:FAL_KEY="..."   ·  bash  export FAL_KEY=...
// optimize is free and local: glb → gltf-transform (Draco + webp textures), images → webp through Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.js';
import { launchBrowser } from './lib/browser.js';

const QUEUE = process.env.FAL_QUEUE_URL || 'https://queue.fal.run';
const ENGINES = {
  // image → 3D; `text` engines also accept a prompt directly
  trellis: { app: 'fal-ai/trellis', input: (img) => ({ image_url: img }) },
  hunyuan: { app: 'fal-ai/hunyuan3d/v2', input: (img) => ({ input_image_url: img }) },
  rodin: { app: 'fal-ai/hyper3d/rodin', input: (img, prompt) => ({ ...(img ? { input_image_urls: [img] } : {}), ...(prompt ? { prompt } : {}), geometry_file_format: 'glb', material: 'PBR', quality: 'medium' }), text: true },
};
// Suffix that makes a text-to-image render usable as the input of an image-to-3D model.
const OBJECT_SHOT = 'single isolated object, centered, full object visible, three-quarter view, soft studio lighting, plain light grey background, no text, no shadow on the ground';

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

function key() {
  const k = process.env.FAL_KEY;
  if (!k) die('FAL_KEY is not set. Create a key at https://fal.ai/dashboard/keys then, in the same terminal:\n    PowerShell: $env:FAL_KEY="<key>"\n    bash:       export FAL_KEY=<key>\n  (never paste the key in a chat or commit it)');
  return k;
}

async function falRun(app, input, label) {
  const headers = { Authorization: 'Key ' + key(), 'Content-Type': 'application/json' };
  const res = await fetch(`${QUEUE}/${app}`, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!res.ok) die(`${app}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  const job = await res.json();
  const statusUrl = job.status_url || `${QUEUE}/${app}/requests/${job.request_id}/status`;
  const responseUrl = job.response_url || `${QUEUE}/${app}/requests/${job.request_id}`;
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await (await fetch(statusUrl, { headers })).json().catch(() => ({}));
    process.stderr.write(`\r${label}: ${st.status || '…'} ${Math.round((Date.now() - t0) / 1000)}s   `);
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED' || st.status === 'ERROR') die(`${app} failed: ${JSON.stringify(st).slice(0, 400)}`);
    if (Date.now() - t0 > 15 * 60e3) die(`${app}: no result after 15 min (request ${job.request_id})`);
  }
  process.stderr.write('\n');
  const out = await fetch(responseUrl, { headers });
  if (!out.ok) die(`${app}: result HTTP ${out.status} ${(await out.text()).slice(0, 400)}`);
  return out.json();
}

// first URL in a fal response (optionally matching an extension)
function findUrl(obj, re) {
  let found = null;
  const walk = (v) => {
    if (found || v == null) return;
    if (typeof v === 'string') {
      if (/^(https?:|data:)/.test(v) && (!re || re.test(v.split('?')[0]))) found = v;
    } else if (typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(obj);
  return found;
}

async function download(url, out) {
  let bytes;
  if (url.startsWith('data:')) bytes = Buffer.from(url.split(',')[1], 'base64');
  else {
    const r = await fetch(url);
    if (!r.ok) die(`download ${url}: HTTP ${r.status}`);
    bytes = Buffer.from(await r.arrayBuffer());
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, bytes);
  return bytes.length;
}

function dataUri(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function size(s) {
  const m = /^(\d+)x(\d+)$/.exec(String(s || '1600x900'));
  if (!m) die('--size must look like 1600x900');
  // diffusion models want multiples of 16
  return { width: Math.round(+m[1] / 16) * 16, height: Math.round(+m[2] / 16) * 16 };
}

async function generateImage(prompt, opts) {
  const app = opts.model || 'fal-ai/flux/dev';
  const r = await falRun(app, { prompt, image_size: size(opts.size), num_images: 1, enable_safety_checker: true }, 'image');
  const url = findUrl(r.images || r, /\.(png|jpe?g|webp)$/i) || findUrl(r);
  if (!url) die('no image in the response: ' + JSON.stringify(r).slice(0, 300));
  return url;
}

async function cmdImage(a) {
  if (!a.prompt) die('--prompt is required');
  const out = a.out || 'image.webp';
  const url = await generateImage(a.prompt, a);
  const tmp = /\.webp$/i.test(out) ? out + '.src' : out;
  const n = await download(url, tmp);
  if (tmp !== out) {
    await toWebp(tmp, out, +a.max || 2560);
    fs.rmSync(tmp);
  }
  console.error(`✓ ${out} (${Math.round((tmp !== out ? fs.statSync(out).size : n) / 1024)} KB)`);
}

async function cmdModel(a) {
  const engine = ENGINES[a.engine || 'trellis'] || die('--engine must be one of ' + Object.keys(ENGINES).join(', '));
  if (!a.prompt && !a.image) die('--prompt or --image is required');
  const out = a.out || 'model.glb';
  let img = a.image ? (/^https?:/.test(a.image) ? a.image : dataUri(a.image)) : null;
  if (!img && !engine.text) {
    // text → image → 3D: keep the intermediate render next to the model so it can be reviewed
    img = await generateImage(`${a.prompt}, ${OBJECT_SHOT}`, { size: '1024x1024', model: a['image-model'] });
    const ref = out.replace(/\.glb$/i, '') + '.ref.png';
    await download(img, ref);
    console.error(`  reference image: ${ref}`);
  }
  const r = await falRun(engine.app, engine.input(img, a.prompt), a.engine || 'trellis');
  const url = findUrl(r, /\.glb$/i) || findUrl(r.model_mesh || r);
  if (!url) die('no model in the response: ' + JSON.stringify(r).slice(0, 300));
  const n = await download(url, out);
  console.error(`✓ ${out} (${Math.round(n / 1024)} KB) — run \`dip-assets optimize ${out}\` before shipping`);
}

// image → webp (optionally downscaled) through Chromium's encoder: no native dependency
async function toWebp(src, out, max) {
  const { browser, context } = await launchBrowser({ headless: true });
  try {
    const page = await context.newPage();
    const b64 = await page.evaluate(
      async ({ uri, max }) => {
        const img = new Image();
        img.src = uri;
        await img.decode();
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const blob = await new Promise((r) => c.toBlob(r, 'image/webp', 0.85));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(bin);
      },
      { uri: dataUri(src), max }
    );
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  } finally {
    await browser.close();
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    p.on('close', resolve);
    p.on('error', () => resolve(1));
  });
}

async function cmdOptimize(a) {
  const src = a._[1] || die('usage: dip-assets optimize <file>');
  if (!fs.existsSync(src)) die('not found: ' + src);
  const before = fs.statSync(src).size;
  let out;
  if (/\.(glb|gltf)$/i.test(src)) {
    out = a.out || src.replace(/\.(glb|gltf)$/i, '.opt.glb');
    const code = await run('npx', ['-y', '@gltf-transform/cli@4', 'optimize', src, out, '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', String(+a.max || 2048)]);
    if (code !== 0) die('gltf-transform failed (it needs network access the first time to download the tool)');
  } else if (/\.(png|jpe?g|webp|avif)$/i.test(src)) {
    out = a.out || src.replace(/\.[^.]+$/, '.webp');
    if (path.resolve(out) === path.resolve(src)) out = src.replace(/\.[^.]+$/, '.opt.webp');
    await toWebp(src, out, +a.max || 2560);
  } else die('optimize supports .glb/.gltf and .png/.jpg/.webp/.avif');
  console.error(`✓ ${out}: ${Math.round(before / 1024)} KB → ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'image') return cmdImage(a);
  if (cmd === 'model') return cmdModel(a);
  if (cmd === 'optimize') return cmdOptimize(a);
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(cmd ? 2 : 0);
}

main().catch((e) => die(e.stack || String(e)));
