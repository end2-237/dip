// E2E: the extension dashboard imports pack zips into a library folder (OPFS stands in for the user's
// folder), lists them, indexes the animations and prepares Claude Code commands. Needs Playwright + Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zip } from '../extension/lib/zip.js';

const enc = (s) => new TextEncoder().encode(typeof s === 'string' ? s : JSON.stringify(s));
async function fakePack(tmp, domain, fx) {
  const root = `dip-pack_${domain}_2026-09-29/`;
  const files = [
    { path: root + 'manifest.json', data: enc({ url: `https://${domain}/`, date: '2026-09-29T10:00:00Z', tier: 'B', mode: 'study', detectedStack: [{ name: 'gsap', confidence: 1 }], webgl: [] }) },
    { path: root + 'SPEC.md', data: enc(`# SPEC — ${domain}\n\n| a | b |\n|---|---|\n| 1 | \`x\` |\n`) },
    { path: root + 'design/tokens.json', data: enc({ color: { 'palette-01': { $value: '#101010', $extensions: { dip: { share: 0.8, role: 'background' } } } }, typography: { display: { $value: { fontFamily: 'Canela, serif' } } } }) },
    { path: root + 'structure/sections.json', data: enc([{ id: 's01-hero', height: 900 }]) },
    { path: root + `motion/effects/${fx}.json`, data: enc({ id: fx, effect_type: 'text-reveal-lines', trigger: 'load', technique: 'gsap-tween', animation: { duration: 1.2, ease: 'expo.out', stagger: 0.08 }, confidence: 0.9 }) },
    { path: root + `motion/effects/${fx}.md`, data: enc(`# ${fx}\n\n- duration **1.2s**`) },
  ];
  const p = path.join(tmp, domain + '.zip');
  fs.writeFileSync(p, await zip(files));
  return p;
}

test('dashboard: import packs, browse, prepare commands', { timeout: 180000 }, async () => {
  const { chromium } = await import('playwright');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dipdash-'));
  const zips = [await fakePack(tmp, 'alpha-hotel.test', 'e01-hero-text-reveal-lines'), await fakePack(tmp, 'beta.test', 'e01-intro-text-reveal-lines')];
  const ext = path.resolve('extension');
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/dashboard.html?opfs=1#library`);
    await page.setInputFiles('#file-import', zips);
    await page.waitForFunction(() => document.querySelector('#nav-count').textContent === '2', null, { timeout: 60000 });
    assert.equal(await page.locator('#lib-grid .card').count(), 2);
    // pack drawer + markdown document
    await page.locator('#lib-grid .card').first().click();
    await page.click('[data-doc="SPEC.md"]');
    await page.waitForSelector('.md table', { timeout: 10000 });
    await page.keyboard.press('Escape');
    // animations index
    await page.click('nav a[data-page="motion"]');
    await page.waitForFunction(() => document.querySelectorAll('.mo-row').length === 2);
    // create: brief → command + brief file
    await page.click('nav a[data-page="create"]');
    await page.fill('[name=company]', 'Maison Test');
    await page.fill('[name=sector]', 'hotel');
    await page.click('#cr-go');
    await page.waitForFunction(() => document.querySelector('#cr-cmd').textContent.startsWith('/dip-create'));
    const cmd = await page.textContent('#cr-cmd');
    assert.match(cmd, /^\/dip-create briefs\/maison-test\.md — références : packs\/dip-pack_/);
    await page.click('.seg[data-m="dna"]');
    await page.click('#cr-go');
    assert.match(await page.textContent('#cr-cmd'), /^\/dip-dna packs\/dip-pack_\S+ packs\/dip-pack_/);
    const opfs = await page.evaluate(async () => {
      const r = await navigator.storage.getDirectory();
      const read = async (...p) => {
        let d = r;
        for (const x of p.slice(0, -1)) d = await d.getDirectoryHandle(x);
        return (await (await d.getFileHandle(p[p.length - 1])).getFile()).text();
      };
      return { lib: await read('LIBRARY.md'), fx: await read('EFFECTS.md'), brief: await read('briefs', 'maison-test.md'), cmd: await read('.claude', 'commands', 'dip-create.md') };
    });
    assert.match(opfs.lib, /alpha-hotel\.test/);
    assert.match(opfs.fx, /1\.2s, expo\.out, stagger 0\.08/);
    assert.match(opfs.brief, /Secteur : hotel/);
    assert.match(opfs.cmd, /\$ARGUMENTS/);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
