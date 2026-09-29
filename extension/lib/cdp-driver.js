// CDP driver: works with chrome.debugger (extension "Deep" mode) and with a Playwright CDPSession
// (dev runner / tests). `send(method, params)` must return a promise of the CDP result.

export class CdpDriver {
  constructor(send, opts) {
    this.send = send;
    this.opts = opts || {};
    this.capabilities = { emulation: true, trustedInput: true, clip: true, fullPage: true };
    this.viewport = { w: 1440, h: 900 };
    this.probeScriptId = null;
  }

  async init(probeSource) {
    await this.send('Page.enable', {});
    await this.send('Runtime.enable', {});
    if (probeSource) {
      const r = await this.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource });
      this.probeScriptId = r && r.identifier;
    }
  }

  async dispose() {
    try {
      if (this.probeScriptId) await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.probeScriptId });
      await this.send('Emulation.clearDeviceMetricsOverride', {});
    } catch (e) {
      /* tab may be gone */
    }
  }

  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'evaluate failed');
    }
    return r.result ? r.result.value : undefined;
  }

  call(fn, ...args) {
    return this.evaluate(`(async () => { const d = window.__DIP__; if (!d) throw new Error('DIP probes not loaded'); return await d[${JSON.stringify(fn)}](...${JSON.stringify(args)}); })()`);
  }

  async setViewport(w, h) {
    this.viewport = { w, h };
    await this.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600, screenWidth: w, screenHeight: h });
    // references must not depend on the OS scrollbar width (15px on Windows): layout at the full breakpoint width
    await this.send('Emulation.setScrollbarsHidden', { hidden: true }).catch(() => {});
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: false });
  }

  // clip in viewport CSS px
  async screenshot(clip) {
    const params = { format: 'png', fromSurface: true };
    if (clip) {
      const [sx, sy] = (await this.evaluate('[window.scrollX, window.scrollY]')) || [0, 0];
      params.clip = { x: clip.x + sx, y: clip.y + sy, width: Math.max(1, clip.w), height: Math.max(1, clip.h), scale: 1 };
    }
    const r = await this.send('Page.captureScreenshot', params);
    return r.data;
  }

  async fullPage(maxH) {
    const m = await this.send('Page.getLayoutMetrics', {});
    const size = m.cssContentSize || m.contentSize;
    const h = Math.min(size.height, maxH || 16000);
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: this.viewport.w, height: h, scale: 0.5 } });
    return r.data;
  }

  async wheel(x, y, dy) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy });
  }

  async mouseMove(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y) });
  }

  async mouseDown(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 1, clickCount: 1 });
  }

  async mouseUp(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(x), y: Math.round(y), button: 'left', buttons: 0, clickCount: 1 });
  }

  async key(key) {
    const codes = { Escape: 27, Enter: 13, Tab: 9 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key] || 0 });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] || 0 });
  }

  async mouseClick(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}
