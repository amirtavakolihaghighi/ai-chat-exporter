'use strict';

/**
 * Background script — a service worker in Chrome, an event page in Firefox.
 *
 * It stays deliberately thin. Manifest V3 terminates the service worker after
 * roughly thirty seconds of inactivity, so nothing long-running may live here:
 * reading a chat happens in the content script (which lives as long as the
 * page) and exporting happens in the workspace tab (which lives as long as the
 * user leaves it open). What remains here is short request/response work.
 */

const { api } = require('../lib/browser');
const { pruneCaptures } = require('../lib/storage');

/**
 * Fetches an image and returns it as a data URI.
 *
 * This exists because a content script's fetch is subject to the page's CORS
 * rules, so images served from a separate CDN — which is most of them — cannot
 * be read there. The background runs under the extension's host permissions and
 * has no such restriction.
 */
async function fetchImageAsDataUrl(url) {
  // Cookies are required, not optional. Attachments and generated pictures are
  // served from signed, authenticated CDN URLs; without credentials the fetch
  // comes back 403 and the export silently keeps the remote link instead of the
  // picture. That link then works when opened in a tab — where the browser does
  // send cookies — and shows as a broken image inside the exported file, which
  // makes the failure look like a rendering problem rather than a fetch one.
  let response = await fetch(url, { credentials: 'include' });
  if (response.status === 401 || response.status === 403) {
    // Some hosts reject credentialed cross-origin requests outright; for those
    // an anonymous fetch is the one that works.
    response = await fetch(url, { credentials: 'omit' });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const blob = await response.blob();
  if (blob.size > 12 * 1024 * 1024) throw new Error('image too large');

  // FileReader is unavailable in a Chrome service worker, so encode by hand.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  const mime = blob.type || 'image/png';
  return `data:${mime};base64,${btoa(binary)}`;
}

api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return undefined;

  switch (message.type) {
    case 'ace:fetchImage':
      fetchImageAsDataUrl(message.url)
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
      return true;

    case 'ace:captureVisible':
      // Only the background may call captureVisibleTab.
      api.tabs
        .captureVisibleTab(message.windowId, { format: 'png' })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
      return true;

    case 'ace:openWorkspace':
      api.tabs
        .create({ url: api.runtime.getURL(`panel.html${message.query || ''}`) })
        .then((tab) => sendResponse({ ok: true, tabId: tab.id }))
        .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
      return true;

    default:
      return undefined;
  }
});

// Scratch captures are only needed between reading and exporting; clear out
// anything a previous session abandoned.
api.runtime.onStartup?.addListener(() => {
  pruneCaptures().catch(() => {});
});
api.runtime.onInstalled.addListener(() => {
  pruneCaptures().catch(() => {});
});
