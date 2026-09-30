#!/usr/bin/env node
// dip-focus — analyse ONE animation of a page in depth (same engine as the extension's focus analysis).
//
//   node cli/dip-focus.js --url https://site.com [--lib D:\DIP-Library]                 (a window opens: circle the zone)
//   node cli/dip-focus.js --url https://site.com --region x,y,w,h,scroll --headless     (zone given in page px)
//
// Writes the focus pack to <lib>/effects/<slug>/ (EFFECT.md, effect.json, frames/, curves/, code/).
// Then, in Claude Code at the library root: /dip-effect effects/<slug>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpDriver } from '../extension/lib/cdp-driver.js';
import { runFocus, analyzeFocus, focusFiles } from '../extension/lib/focus.js';
import { launchBrowser } from './lib/browser.js';
import { parseArgs } from './lib/args.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROBES = fs.readFileSync(path.join(__dirname, '../extension/probes/probes.js'), 'utf8');

export async function focus(url, opts) {
  opts = opts || {};
  const { browser, context } = await launchBrowser({ headless: !!opts.headless, width: opts.width || 1440, height: opts.height || 900 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const driver = new CdpDriver((m, p) => cdp.send(m, p));
  await driver.init(PROBES);
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  await driver.call('waitStable', 800, 9000).catch(() => {});
  if (opts.region) {
    await driver.call('scrollToY', opts.region.scroll, 300);
    await new Promise((r) => setTimeout(r, 1200));
  }
  const fc = await runFocus(driver, { region: opts.region, onProgress: (p) => opts.quiet || process.stderr.write(`\r${String(p.pct).padStart(3)}% ${p.label}          `) });
  if (!opts.quiet) process.stderr.write('\n');
  await driver.dispose();
  await browser.close();
  if (!fc) return null;
  const fa = analyzeFocus(fc);
  return { fc, fa, ...focusFiles(fc, fa) };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.url) {
    console.error('usage: dip-focus --url <url> [--lib dir] [--region x,y,w,h,scroll] [--headless]');
    process.exit(2);
  }
  const region = a.region ? (([x, y, w, h, scroll]) => ({ x, y, w, h, scroll }))(String(a.region).split(',').map(Number)) : null;
  const res = await focus(a.url, { headless: !!a.headless, region });
  if (!res) {
    console.error('✗ cancelled');
    process.exit(1);
  }
  const root = path.join(path.resolve(a.lib || process.env.DIP_LIBRARY || 'dip-library'), 'effects', res.slug);
  for (const f of res.files) {
    const p = path.join(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
  console.error(`✓ ${res.json.commonName.fr} (${res.json.type}, ${res.fa.effects.length} mouvement(s)) → ${root}`);
  console.error(`  Puis dans Claude Code (bibliothèque) : /dip-effect effects/${res.slug}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
