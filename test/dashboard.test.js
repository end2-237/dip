// E2E: the extension dashboard imports pack zips into a library folder (OPFS stands in for the user's
// folder), lists them, indexes the animations and prepares Claude Code commands. Needs Playwright + Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zip } from '../extension/lib/zip.js';
import { serve } from '../cli/lib/serve.js';

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
    await page.waitForFunction(() => document.querySelectorAll('#mo-list .fx').length === 2);
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
    // built sites: sites/<slug>/ with a dip-review report
    await page.evaluate(async () => {
      const r = await navigator.storage.getDirectory();
      const put = async (p, text) => {
        const parts = p.split('/');
        let d = r;
        for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x, { create: true });
        const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
        await w.write(text);
        await w.close();
      };
      await put('sites/demo/package.json', '{"name":"demo"}');
      await put('sites/demo/NOTES.md', '# NOTES demo');
      await put('production/demo/BRIEF.md', '| Références | alpha-hotel.test · beta.test |');
      await put('sites/demo/review/review.json', JSON.stringify({ score: 72, date: '2026-09-30T10:00:00Z', issues: [{ sev: 'high', area: 'header', msg: 'Le menu fixe passe par-dessus le texte', fix: 'fond au scroll', cost: 10 }] }));
    });
    await page.goto(page.url().replace(/#.*/, '#sites'));
    await page.reload();
    await page.waitForSelector('#sites-grid .card .score');
    assert.equal((await page.textContent('#sites-grid .card .score')).trim(), '72');
    await page.click('#sites-grid .card');
    await page.waitForSelector('.issue');
    assert.match(await page.textContent('#dr-body'), /\/dip-review sites\/demo/);
    assert.match(await page.textContent('#dr-body'), /alpha-hotel\.test/);
    // a site dissected again: found in the library, replaced, its DNA and categories kept
    const again = await page.evaluate(async () => {
      const ws = await import('./lib/workspace.js');
      const root = await navigator.storage.getDirectory();
      const [old] = await ws.findPacksFor(root, 'https://www.alpha-hotel.test/rooms');
      await ws.writeFile(root, old.path + '/DESIGN_DNA.md', '# ADN alpha');
      await ws.writeFile(root, old.path + '/tags.json', '{"sector":"hotellerie-restauration"}');
      await ws.replacePack(root, 'dip-pack_alpha-hotel.test_2026-10-01', [{ path: 'manifest.json', data: JSON.stringify({ url: 'https://alpha-hotel.test/', date: '2026-10-01T10:00:00Z' }) }], [old]);
      const fsa = ws.fsAdapter(root);
      const now = await ws.findPacksFor(root, 'https://alpha-hotel.test/');
      return { n: now.length, name: now[0].name, dna: await fsa.readText(now[0].path + '/DESIGN_DNA.md'), tags: await fsa.readText(now[0].path + '/tags.json'), oldGone: (await fsa.readText(old.path + '/SPEC.md')) == null, none: (await ws.findPacksFor(root, 'https://other.test/')).length };
    });
    assert.deepEqual(again, { n: 1, name: 'dip-pack_alpha-hotel.test_2026-10-01', dna: '# ADN alpha', tags: '{"sector":"hotellerie-restauration"}', oldGone: true, none: 0 });
    // scan dialog warns about a site already in the library
    await page.reload();
    await page.click('#btn-scan');
    await page.fill('#scan-url', 'alpha-hotel.test');
    assert.match(await page.textContent('#scan-dup'), /Déjà disséqué/);
    await page.keyboard.press('Escape');
    // update command carries the install folder typed in Réglages
    await page.goto(page.url().replace(/#.*/, '#settings'));
    await page.fill('#set-home', 'D:\\dip-x\\dip-x\\extension\\');
    await page.dispatchEvent('#set-home', 'change');
    await page.waitForFunction(() => document.querySelector('#set-cmd').textContent.startsWith('$env:DIP_HOME'));
    assert.equal(await page.textContent('#set-cmd'), '$env:DIP_HOME = "D:\\dip-x\\dip-x"; irm https://raw.githubusercontent.com/end2-237/dip/main/scripts/update-dip.ps1 | iex');
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dashboard: one-click re-dissection of an old pack keeps its DNA', { timeout: 420000 }, async () => {
  const { chromium } = await import('playwright');
  const srv = await serve('fixtures', 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dipre-'));
  const url = `${srv.url}/css-only/`;
  const root = 'dip-pack_old-scan_2026-01-01/';
  const files = [
    { path: root + 'manifest.json', data: enc({ url, date: '2026-01-01T10:00:00Z', tier: 'A', mode: 'study', analyzerVersion: '0.1.0', detectedStack: [] }) },
    { path: root + 'DESIGN_DNA.md', data: enc('# DNA written by Claude\n') },
    { path: root + 'dna.json', data: enc({ keywords: ['editorial'] }) },
  ];
  const zp = path.join(tmp, 'old.zip');
  fs.writeFileSync(zp, await zip(files));
  const ext = path.resolve('extension');
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${id}/dashboard.html?opfs=1#library`);
    await page.evaluate(() => chrome.storage.local.set({ dipSettings: { breakpoints: [1440], maxHovers: 4, consent: 'none' } }));
    await page.setInputFiles('#file-import', [zp]);
    await page.waitForSelector('#lib-grid .card .badge.warn', { timeout: 30000 });
    page.on('dialog', (d) => d.accept());
    await page.click('#btn-redissect-all');
    await page.waitForFunction(() => document.querySelector('#job').hidden && !document.querySelector('#lib-grid .badge.warn') && document.querySelectorAll('#lib-grid .card').length === 1, null, { timeout: 360000 });
    const out = await page.evaluate(async () => {
      const r = await navigator.storage.getDirectory();
      const packs = await r.getDirectoryHandle('packs');
      const names = [];
      for await (const [n] of packs.entries()) names.push(n);
      const d = await packs.getDirectoryHandle(names[0]);
      const txt = async (f) => (await (await d.getFileHandle(f)).getFile()).text();
      return { names, manifest: JSON.parse(await txt('manifest.json')), dna: await txt('DESIGN_DNA.md') };
    });
    assert.equal(out.names.length, 1);
    assert.notEqual(out.names[0], 'dip-pack_old-scan_2026-01-01');
    assert.equal(out.manifest.analyzerVersion, '0.2.0');
    assert.match(out.dna, /DNA written by Claude/);
  } finally {
    await ctx.close();
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('dashboard: focus analysis of one circled animation', { timeout: 300000 }, async () => {
  const { chromium } = await import('playwright');
  const srv = await serve('fixtures', 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dipfocus-'));
  const ext = path.resolve('extension');
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: false, viewport: { width: 1440, height: 900 }, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/dashboard.html?opfs=1#motion`);
    await page.click('#btn-focus-new');
    await page.fill('#focus-url', `${srv.url}/gsap-lenis/`);
    const popup = ctx.waitForEvent('page');
    await page.click('#focus-go');
    const site = await popup;
    // the user: circle the hero title with the mouse, then confirm
    await site.waitForSelector('[data-dip-overlay]', { state: 'attached', timeout: 60000 });
    await site.waitForTimeout(500);
    await site.click('[data-dip-overlay] >> css=button.draw');
    const vp = site.viewportSize() || { width: 1280, height: 800 };
    const cx = vp.width / 2, cy = vp.height * 0.45, rx = vp.width * 0.4, ry = vp.height * 0.25;
    await site.mouse.move(cx + rx, cy);
    await site.mouse.down();
    for (let i = 1; i <= 36; i++) await site.mouse.move(cx + rx * Math.cos((i / 36) * Math.PI * 2), cy + ry * Math.sin((i / 36) * Math.PI * 2));
    await site.mouse.up();
    await site.click('[data-dip-overlay] >> css=button.draw');
    await page.waitForSelector('#focus-grid .fx', { timeout: 240000 });
    const out = await page.evaluate(async () => {
      const r = await navigator.storage.getDirectory();
      const eff = await r.getDirectoryHandle('effects');
      const names = [];
      for await (const [n] of eff.entries()) names.push(n);
      const d = await eff.getDirectoryHandle(names[0]);
      const txt = async (f) => (await (await d.getFileHandle(f)).getFile()).text();
      return { names, json: JSON.parse(await txt('effect.json')), md: await txt('EFFECT.md'), lib: await (await (await r.getFileHandle('EFFECTS.md')).getFile()).text() };
    });
    assert.equal(out.names.length, 1);
    assert.equal(out.json.type, 'text-reveal-lines');
    assert.match(out.json.commonName.fr, /ligne par ligne/);
    assert.ok(out.json.frames.length >= 8);
    assert.match(out.md, /\/dip-effect/);
    assert.match(out.lib, /Focused analyses/);
    await page.waitForSelector('#drawer:not([hidden]) .frames img');
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('side panel: a site already in the library asks before dissecting again', { timeout: 120000 }, async () => {
  const { chromium } = await import('playwright');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dipdup-'));
  const srv = await serve('fixtures', 0);
  const ext = path.resolve('extension');
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { headless: false, args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = new URL(sw.url()).host;
    const dash = await ctx.newPage();
    await dash.goto(`chrome-extension://${id}/dashboard.html?opfs=1#library`);
    await dash.setInputFiles('#file-import', [await fakePack(tmp, '127.0.0.1', 'e01-hero-text-reveal-lines')]);
    await dash.waitForFunction(() => document.querySelector('#nav-count').textContent === '1', null, { timeout: 60000 });
    const site = await ctx.newPage();
    await site.goto(srv.url + '/css-only/');
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => /css-only/.test(t.url)).id);
    const panel = await ctx.newPage();
    const errors = [];
    panel.on('pageerror', (e) => errors.push(e.message));
    await panel.goto(`chrome-extension://${id}/sidepanel.html?opfs=1&tab=${tabId}`);
    await panel.click('#btn-dissect');
    await panel.waitForSelector('#dup:not([hidden])');
    assert.match(await panel.textContent('#dup'), /déjà disséqué/i);
    await panel.click('#dup-cancel');
    assert.equal(await panel.locator('#dup').isHidden(), true);
    assert.equal(await panel.locator('#progress').isHidden(), true);
    assert.deepEqual(errors, []);
  } finally {
    await ctx.close();
    await srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
