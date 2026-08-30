'use strict';

const { BrowserWindow, webContents } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

/** Chromium refuses to allocate a capture surface larger than this on any axis. */
const MAX_TEXTURE = 16000;

const PAGE_SIZES = {
  A4: { label: 'A4' },
  A3: { label: 'A3' },
  Letter: { label: 'Letter' },
  Legal: { label: 'Legal' },
  Tabloid: { label: 'Tabloid' },
};

function headerTemplate() {
  return '<div style="font-size:8px;width:100%;padding:0 12mm;color:#999;"></div>';
}

function footerTemplate(title) {
  const safe = String(title || '').replace(/[<>&]/g, '').slice(0, 90);
  return `<div style="font-size:8px;width:100%;padding:0 12mm;color:#8a8a8a;display:flex;justify-content:space-between;font-family:sans-serif;">
    <span>${safe}</span>
    <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;
}

function pdfOptions(opts = {}, title = '') {
  const margin = typeof opts.marginInches === 'number' ? opts.marginInches : 0.5;
  return {
    printBackground: opts.printBackground !== false,
    landscape: Boolean(opts.landscape),
    pageSize: PAGE_SIZES[opts.pageSize] ? opts.pageSize : 'A4',
    scale: Math.min(2, Math.max(0.1, opts.scale || 1)),
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    displayHeaderFooter: opts.pageNumbers !== false,
    headerTemplate: headerTemplate(),
    footerTemplate: footerTemplate(title),
    preferCSSPageSize: false,
    generateTaggedPDF: opts.taggedPdf !== false,
  };
}

/* --------------------------------------------------- printing a live page */

function contentsById(id) {
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) throw new Error('That webview is no longer available. Reload the chat and try again.');
  return wc;
}

/** PDF of the site exactly as rendered, site chrome and all. */
async function pdfFromWebContents(id, opts, title) {
  return contentsById(id).printToPDF(pdfOptions(opts, title));
}

/* ------------------------------------------------- printing our own HTML */

/**
 * A hidden window is deliberately used rather than an offscreen one. Offscreen
 * rendering needs a compositing path that isn't always available (software
 * rendering, remote sessions, disabled GPU) and can hang the load indefinitely;
 * printToPDF and CDP capture both work fine on a plain hidden window.
 */
function hiddenWindow(width = 1200, height = 1600, allowScripts = false) {
  return new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: {
      javascript: allowScripts, // exported documents are static; nothing needs to run
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // The window is never shown, and Chromium throttles timers and frame
      // production in hidden windows — which would stall rendering here.
      backgroundThrottling: false,
    },
  });
}

/** Never let a wedged page block an export forever. */
async function loadWithTimeout(win, file, ms = 30000) {
  let timer;
  try {
    await Promise.race([
      win.loadFile(file),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out rendering the export document.')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders arbitrary HTML in a hidden window and prints it. Used for the "clean"
 * PDF, where we control typography and page breaks instead of inheriting the
 * chat site's layout.
 */
async function pdfFromHtml(html, opts = {}, title = '') {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-print-'));
  const file = path.join(tmpDir, 'doc.html');
  await fs.writeFile(file, html, 'utf8');

  const win = hiddenWindow();
  try {
    await loadWithTimeout(win, file);
    // Give embedded data-URI images a moment to decode before printing.
    await new Promise((r) => setTimeout(r, opts.settleMs || 400));
    return await win.webContents.printToPDF(pdfOptions(opts, title));
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------ screenshots */

/** Every DevTools-protocol call is bounded; none of them may wedge an export. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function withDebugger(wc, fn) {
  let attached = false;
  try {
    if (!wc.debugger.isAttached()) {
      wc.debugger.attach('1.3');
      attached = true;
    }
    return await fn();
  } finally {
    if (attached && wc.debugger.isAttached()) {
      try {
        wc.debugger.detach();
      } catch {
        /* already gone */
      }
    }
  }
}

/**
 * Full-page screenshot beyond the viewport, via CDP. A whole conversation is
 * usually far taller than the window and often taller than Chromium's texture
 * limit, so oversized captures are sliced into numbered tiles instead of being
 * silently cropped.
 *
 * @returns {Promise<{images: Buffer[], tiled: boolean, width: number, height: number}>}
 */
async function screenshotWebContents(id, opts = {}) {
  const wc = contentsById(id);
  const format = opts.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = format === 'jpeg' ? Math.min(100, Math.max(1, opts.quality || 92)) : undefined;
  // Capturing "from surface" reads the browser compositor's output, which a
  // hidden window may never produce — the call then never returns. Rendering
  // paths that run in a hidden window must ask the renderer directly instead.
  const fromSurface = opts.fromSurface !== false;

  const trace = opts.trace || (() => {});
  return withDebugger(wc, async () => {
    trace('debugger attached');
    // captureBeyondViewport needs the Page domain live; without this the
    // capture call can block indefinitely instead of returning an error.
    await withTimeout(wc.debugger.sendCommand('Page.enable'), 10000, 'Page.enable');
    trace('Page.enable ok');

    const metrics = await withTimeout(
      wc.debugger.sendCommand('Page.getLayoutMetrics'),
      15000,
      'Page.getLayoutMetrics'
    );
    const size = metrics.cssContentSize || metrics.contentSize;
    const width = Math.ceil(size.width);
    const fullHeight = Math.ceil(size.height);
    trace(`layout metrics ${width}x${fullHeight}`);

    // Scale down rather than crop when the page is merely wide.
    let scale = Math.min(opts.scale || 1, MAX_TEXTURE / Math.max(width, 1));
    scale = Math.max(0.1, Math.min(2, scale));

    const sliceHeight = Math.floor(MAX_TEXTURE / scale);
    const slices = Math.max(1, Math.ceil(fullHeight / sliceHeight));
    const images = [];

    for (let i = 0; i < slices; i++) {
      const y = i * sliceHeight;
      const height = Math.min(sliceHeight, fullHeight - y);
      const shot = await withTimeout(
        wc.debugger.sendCommand('Page.captureScreenshot', {
          format,
          quality,
          captureBeyondViewport: true,
          fromSurface,
          clip: { x: 0, y, width, height, scale },
        }),
        60000,
        'Page.captureScreenshot'
      );
      trace(`slice ${i + 1}/${slices} captured`);
      images.push(Buffer.from(shot.data, 'base64'));
    }

    return { images, tiled: slices > 1, width, height: fullHeight };
  });
}

/**
 * Same as above, but over our own rendered document rather than the live site.
 *
 * A screenshot needs a composited frame, and a window that was never shown does
 * not produce one — Page.captureScreenshot simply never returns. So the window
 * is shown, but at zero opacity, without focus and off the taskbar: invisible to
 * the user, real to the compositor.
 */
async function screenshotHtml(html, opts = {}) {
  const trace = opts.trace || (() => {});
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ace-shot-'));
  const file = path.join(tmpDir, `${crypto.randomUUID()}.html`);
  await fs.writeFile(file, html, 'utf8');

  const width = Math.max(400, Math.min(2000, opts.viewportWidth || 900));
  const win = hiddenWindow(width, 1200);
  win.setOpacity(0);
  win.setSkipTaskbar(true);

  try {
    trace('window created');
    await loadWithTimeout(win, file);
    trace('document loaded');
    win.showInactive(); // composite without stealing focus from the app
    await new Promise((r) => setTimeout(r, opts.settleMs || 400));
    trace('window composited');
    return await screenshotWebContents(win.webContents.id, { ...opts, fromSurface: true });
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  pdfFromWebContents,
  pdfFromHtml,
  screenshotWebContents,
  screenshotHtml,
  PAGE_SIZES,
};
