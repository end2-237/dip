// Runs a full DIP scan on a browser tab from any extension page (side panel or dashboard).
import { runScan } from './scan.js';
import { CdpDriver } from './cdp-driver.js';
import { StandardDriver } from './std-driver.js';

async function probeSource() {
  return (await fetch(chrome.runtime.getURL('probes/probes.js'))).text();
}

/**
 * @param {chrome.tabs.Tab} tab
 * @param {object} o { deep, breakpoints, consent, maxHovers, exportMode, manual }
 * @param {(p) => void} onProgress
 * @returns {Promise<{cap, analysis}>}
 */
export async function dissectTab(tab, o, onProgress) {
  let driver = null;
  let detach = async () => {};
  try {
    if (o.deep !== false) {
      const target = { tabId: tab.id };
      await chrome.debugger.attach(target, '1.3');
      detach = async () => chrome.debugger.detach(target).catch(() => {});
      driver = new CdpDriver((method, params) => chrome.debugger.sendCommand(target, method, params || {}));
      await driver.init(await probeSource());
    } else {
      const origin = new URL(tab.url).origin + '/*';
      await chrome.scripting.unregisterContentScripts({ ids: ['dip-probes'] }).catch(() => {});
      await chrome.scripting.registerContentScripts([{ id: 'dip-probes', matches: [origin], js: ['probes/probes.js'], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: false }]);
      detach = async () => chrome.scripting.unregisterContentScripts({ ids: ['dip-probes'] }).catch(() => {});
      driver = new StandardDriver(tab.id, tab.windowId);
    }
    const res = await runScan(
      driver,
      { url: tab.url, title: tab.title, captureMode: o.deep !== false ? 'deep' : 'standard', runner: o.runner || 'extension' },
      { breakpoints: o.breakpoints && o.breakpoints.length ? o.breakpoints : [1440], consent: o.consent, maxHovers: o.maxHovers, exportMode: o.exportMode, manual: o.manual || null },
      onProgress
    );
    if (driver.dispose) await driver.dispose();
    await detach();
    return res;
  } catch (e) {
    try {
      if (driver && driver.dispose) await driver.dispose();
    } catch (e2) {
      /* ignore */
    }
    await detach();
    throw e;
  }
}

// Open `url` in a small separate window (the scan emulates a 1440px viewport whatever the window size),
// wait for it to load, dissect it, close the window. The calling page must stay visible meanwhile.
export async function dissectUrl(url, o, onProgress) {
  const W = 560, H = 420;
  // bottom-right corner of the current window, so the calling page stays visible
  let win;
  try {
    const cur = await chrome.windows.getCurrent();
    win = await chrome.windows.create({ url, type: 'popup', width: W, height: H, left: Math.max(0, cur.left + cur.width - W - 16), top: Math.max(0, cur.top + cur.height - H - 16), focused: false });
  } catch (e) {
    win = await chrome.windows.create({ url, type: 'popup', width: W, height: H, focused: false });
  }
  const tabId = win.tabs[0].id;
  try {
    await new Promise((resolve) => {
      const done = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(done);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(done);
        resolve();
      }, 30000);
    });
    const tab = await chrome.tabs.get(tabId);
    return await dissectTab(tab, { ...o, runner: 'dashboard' }, onProgress);
  } finally {
    await chrome.windows.remove(win.id).catch(() => {});
  }
}

// share mode: half resolution + watermark (spec §10.5)
export async function shareImage(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const w = Math.max(1, Math.round(bmp.width / 2)), h = Math.max(1, Math.round(bmp.height / 2));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0, w, h);
  g.font = `${Math.max(10, Math.round(w / 40))}px system-ui`;
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.fillText('DIP · share · reference only', 12, h - 12);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}
