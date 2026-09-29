#!/usr/bin/env node
// dip-capture — run the same guided scan as the extension (Deep mode) with Playwright,
// on your machine (headed by default: real GPU, residential IP). Also used as the dev runner.
//
//   node cli/dip-capture.js <url> [--out dir] [--mode study|share] [--headless] [--breakpoints 1440,1024,390] [--no-zip]
//   node cli/dip-capture.js --urls urls.txt   (batch, one site at a time)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from '../extension/lib/scan.js';
import { CdpDriver } from '../extension/lib/cdp-driver.js';
import { buildPackFiles, packName } from '../extension/lib/pack.js';
import { zip } from '../extension/lib/zip.js';
import { launchBrowser } from './lib/browser.js';
import { parseArgs } from './lib/args.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROBES = fs.readFileSync(path.join(__dirname, '../extension/probes/probes.js'), 'utf8');

export async function capture(url, opts) {
  opts = opts || {};
  const { browser, context } = await launchBrowser({ headless: !!opts.headless });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const driver = new CdpDriver((m, p) => cdp.send(m, p));
  await driver.init(PROBES);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  const t0 = Date.now();
  const { cap, analysis } = await runScan(
    driver,
    { url, captureMode: 'deep', runner: 'dip-capture' },
    { breakpoints: opts.breakpoints || [1440, 1024, 390], exportMode: opts.mode || 'study', maxHovers: opts.maxHovers ?? 30, includeAssets: opts.mode !== 'share' },
    (p) => opts.quiet || process.stderr.write(`\r[${Math.round((Date.now() - t0) / 1000)}s] ${String(p.pct).padStart(3)}% ${p.label}          `)
  );
  if (!opts.quiet) process.stderr.write('\n');
  await driver.dispose();
  await browser.close();
  return { cap, analysis };
}

export async function writePack(cap, analysis, outDir, opts) {
  opts = opts || {};
  const files = await buildPackFiles(cap, analysis, { mode: opts.mode || 'study' });
  const root = path.join(outDir, packName(cap));
  fs.rmSync(root, { recursive: true, force: true });
  for (const f of files) {
    const p = path.join(root, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
  if (opts.zip !== false) fs.writeFileSync(root + '.zip', await zip(files.map((f) => ({ path: packName(cap) + '/' + f.path, data: f.data }))));
  return root;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urls = args.urls ? fs.readFileSync(args.urls, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')) : args._;
  if (!urls.length) {
    console.error('usage: dip-capture <url> [--out dir] [--mode study|share] [--headless] [--breakpoints 1440,1024,390]\n       dip-capture --urls urls.txt');
    process.exit(2);
  }
  const out = path.resolve(args.out || 'dip-packs');
  fs.mkdirSync(out, { recursive: true });
  for (const url of urls) {
    console.error(`▶ ${url}`);
    const { cap, analysis } = await capture(url, { headless: !!args.headless, mode: args.mode, breakpoints: args.breakpoints ? String(args.breakpoints).split(',').map(Number) : undefined });
    if (!analysis) {
      console.error('✗ capture failed:', JSON.stringify(cap.log.filter((l) => l.level === 'error'), null, 2));
      continue;
    }
    const dir = await writePack(cap, analysis, out, { mode: args.mode, zip: !args['no-zip'] });
    const errs = cap.log.filter((l) => l.level === 'error');
    console.error(`✓ ${analysis.sections.length} sections, ${analysis.effects.length} effects, tier ${analysis.tier.tier} → ${dir}${errs.length ? `  (${errs.length} step errors, see raw/scan-log.json)` : ''}`);
    if (urls.length > 1) await new Promise((r) => setTimeout(r, 5000)); // be gentle between sites
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
