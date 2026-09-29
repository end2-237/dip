// Standard mode driver (no chrome.debugger, no "debugging" banner): probes + captureVisibleTab.
// Limits: no breakpoint emulation, synthetic (untrusted) input, screenshots at window size only.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class StandardDriver {
  constructor(tabId, windowId) {
    this.tabId = tabId;
    this.windowId = windowId;
    this.capabilities = { emulation: false, trustedInput: false, clip: true, fullPage: false };
    this.lastShot = 0;
  }

  async exec(func, args) {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: this.tabId }, world: 'MAIN', func, args: args || [] });
    return r ? r.result : undefined;
  }

  async call(fn, ...args) {
    const r = await this.exec(
      async (fn, args) => {
        const d = window.__DIP__;
        if (!d) return { err: 'DIP probes not loaded' };
        try {
          return { v: await d[fn](...args) };
        } catch (e) {
          return { err: String((e && e.message) || e) };
        }
      },
      [fn, args]
    );
    if (!r) throw new Error('no result from page');
    if (r.err) throw new Error(r.err);
    return r.v;
  }

  async evaluate(code) {
    return this.exec((c) => (0, eval)(c), [code]);
  }

  async setViewport() {
    /* not supported in Standard mode */
  }

  async reload() {
    await chrome.tabs.reload(this.tabId);
    await new Promise((resolve) => {
      const onUpd = (id, info) => {
        if (id === this.tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpd);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpd);
      setTimeout(resolve, 30000);
    });
  }

  async screenshot(clip) {
    const wait = 550 - (Date.now() - this.lastShot); // captureVisibleTab is limited to 2 calls/s
    if (wait > 0) await sleep(wait);
    this.lastShot = Date.now();
    const url = await chrome.tabs.captureVisibleTab(this.windowId, { format: 'png' });
    const b64 = url.split(',')[1];
    if (!clip) return b64;
    const vw = await this.exec(() => window.innerWidth);
    return cropPng(b64, clip, vw);
  }

  async wheel(x, y, dy) {
    await this.exec(
      (x, y, dy) => {
        const before = window.scrollY;
        const el = document.elementFromPoint(x, y) || document.body;
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        return new Promise((r) =>
          setTimeout(() => {
            if (window.scrollY === before) window.scrollBy(0, dy);
            r();
          }, 40)
        );
      },
      [x, y, dy]
    );
  }

  async mouseMove(x, y) {
    await this.exec(
      (x, y) => {
        const el = document.elementFromPoint(x, y) || document.body;
        const o = { clientX: x, clientY: y, bubbles: true };
        el.dispatchEvent(new PointerEvent('pointermove', o));
        el.dispatchEvent(new MouseEvent('mousemove', o));
      },
      [x, y]
    );
  }
}

export async function cropPng(b64, clip, cssViewportWidth) {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = bmp.width / (cssViewportWidth || bmp.width);
  const w = Math.max(1, Math.round(clip.w * scale)), h = Math.max(1, Math.round(clip.h * scale));
  const c = new OffscreenCanvas(w, h);
  c.getContext('2d').drawImage(bmp, Math.round(clip.x * scale), Math.round(clip.y * scale), w, h, 0, 0, w, h);
  const out = await c.convertToBlob({ type: 'image/png' });
  return bytesToB64(new Uint8Array(await out.arrayBuffer()));
}

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
