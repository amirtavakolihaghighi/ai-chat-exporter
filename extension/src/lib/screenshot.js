'use strict';

const { api, sendToTab } = require('./browser');

/**
 * Full-page screenshots by scroll-and-stitch.
 *
 * This is the one capability that is genuinely worse than the desktop app.
 * Electron can ask Chromium for a single capture beyond the viewport; an
 * extension only has captureVisibleTab, which returns exactly what is on
 * screen. So the page is scrolled a viewport at a time, each frame captured,
 * and the tiles composited onto a canvas here.
 *
 * Two consequences worth knowing about:
 *  - captureVisibleTab is rate limited to about two calls per second, so a long
 *    conversation takes a while;
 *  - fixed and sticky elements are hidden first by the content script,
 *    otherwise a floating header appears in every single tile.
 */

const MAX_CANVAS_EDGE = 16000; // browsers refuse to allocate much beyond this

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not decode a captured frame'));
    image.src = dataUrl;
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {number} tabId
 * @param {number} windowId
 * @param {object} opts format ('png'|'jpeg'), quality, delayMs, onProgress
 * @returns {Promise<{blobs: Blob[], width: number, height: number, tiles: number}>}
 */
async function captureFullPage(tabId, windowId, opts = {}) {
  const format = opts.format === 'jpeg' ? 'jpeg' : 'png';
  const quality = Math.min(100, Math.max(1, opts.quality || 92)) / 100;
  const delayMs = Math.max(250, opts.delayMs || 550);
  const report = opts.onProgress || (() => {});

  const metrics = await sendToTab(tabId, { type: 'ace:pageMetrics' });
  if (!metrics?.ok) throw new Error('could not measure the page');

  await sendToTab(tabId, { type: 'ace:prepareShot' });

  try {
    const ratio = metrics.devicePixelRatio || 1;
    const step = Math.max(100, metrics.viewportHeight);
    const shots = [];

    for (let y = 0; y < metrics.height; y += step) {
      await sendToTab(tabId, { type: 'ace:scrollTo', y });
      // Chrome throttles captureVisibleTab; going faster silently fails.
      await wait(delayMs);

      const response = await api.runtime.sendMessage({ type: 'ace:captureVisible', windowId });
      if (!response?.ok) throw new Error(response?.error || 'capture failed');

      shots.push({ y, image: await loadImage(response.dataUrl) });
      report(Math.min(1, (y + step) / metrics.height), shots.length);
    }

    // The last scroll usually cannot reach the requested offset because the
    // page has run out of room; trust the image positions rather than the
    // requested ones for the final tile.
    const pageWidth = Math.round(metrics.width * ratio);
    const pageHeight = Math.round(metrics.height * ratio);

    const sliceHeight = Math.min(MAX_CANVAS_EDGE, pageHeight);
    const tiles = Math.max(1, Math.ceil(pageHeight / sliceHeight));
    const blobs = [];

    for (let tile = 0; tile < tiles; tile++) {
      const top = tile * sliceHeight;
      const height = Math.min(sliceHeight, pageHeight - top);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(pageWidth, MAX_CANVAS_EDGE);
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (format === 'jpeg') {
        context.fillStyle = '#ffffff'; // JPEG has no alpha channel
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      for (const shot of shots) {
        const drawY = Math.round(shot.y * ratio) - top;
        if (drawY + shot.image.height < 0 || drawY > height) continue;
        context.drawImage(shot.image, 0, drawY);
      }

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', quality)
      );
      blobs.push(blob);
    }

    return { blobs, width: pageWidth, height: pageHeight, tiles };
  } finally {
    await sendToTab(tabId, { type: 'ace:finishShot' }).catch(() => {});
  }
}

module.exports = { captureFullPage };
