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
  // honour the standard proxy variables (corporate networks, sandboxes)
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  // (raw Chromium flags: Playwright's `proxy` option also routes loopback through the proxy, which breaks local dev servers)
  if (proxy) launch.args.push(`--proxy-server=${proxy.replace(/^https?:\/\/[^@]*@/, 'http://')}`, '--proxy-bypass-list=<local>;localhost;127.0.0.1;[::1]');
  const browser = await pw.chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: opts.width || 1440, height: opts.height || 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  return { browser, context, pw };
}
