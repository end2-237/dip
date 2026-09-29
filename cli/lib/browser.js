// Playwright launcher shared by dip-capture and dip-verify.
import fs from 'node:fs';

export async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (e) {
    try {
      return await import('playwright-core');
    } catch (e2) {
      throw new Error('Playwright is required: run `npm install` in the DIP folder (or `npm i -D playwright && npx playwright install chromium`).');
    }
  }
}

export async function launchBrowser(opts) {
  opts = opts || {};
  const pw = await loadPlaywright();
  const launch = {
    headless: !!opts.headless,
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'],
  };
  if (process.env.DIP_CHROMIUM) launch.executablePath = process.env.DIP_CHROMIUM;
  else if (fs.existsSync('/opt/pw-browsers/chromium')) {
    /* let playwright resolve its own browsers */
  }
  if (opts.channel) launch.channel = opts.channel;
  const browser = await pw.chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  return { browser, context, pw };
}
