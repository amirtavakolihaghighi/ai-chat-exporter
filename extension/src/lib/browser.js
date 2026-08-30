'use strict';

/**
 * One extension API object for both browsers.
 *
 * Firefox exposes `browser` with promise-returning methods; Chrome exposes
 * `chrome`, which since MV3 also returns promises for the APIs used here. So
 * picking whichever global exists is enough — no promise wrapper needed.
 */
const api = typeof globalThis.browser !== 'undefined' ? globalThis.browser : globalThis.chrome;

/** Firefox reports itself so the few behavioural differences can be handled. */
const IS_FIREFOX = typeof globalThis.browser !== 'undefined' && Boolean(globalThis.browser.runtime?.getBrowserInfo);

/**
 * Firefox treats MV3 host permissions as optional: they are listed in the
 * manifest but not granted until the user says so. Chrome grants them at
 * install time. Asking is harmless on Chrome and necessary on Firefox.
 */
async function ensureHostAccess() {
  try {
    const granted = await api.permissions.contains({ origins: ['<all_urls>'] });
    if (granted) return true;
    return await api.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    // Older builds without the permissions API still work for the active tab.
    return true;
  }
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

/** Extension pages cannot be scripted, and neither can browser-internal pages. */
function isScriptableUrl(url) {
  return /^https?:\/\//i.test(url || '') || /^file:\/\//i.test(url || '');
}

/**
 * Injects the content script if it is not already there.
 *
 * Re-injecting is harmless but wasteful, so the content script answers a ping
 * once it is loaded and we only inject when nothing answers.
 */
async function ensureContentScript(tabId) {
  try {
    const pong = await api.tabs.sendMessage(tabId, { type: 'ace:ping' });
    if (pong?.ok) return true;
  } catch {
    // No listener yet — that is the normal path on first use.
  }
  await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  // Give the script a moment to register its message listener.
  await new Promise((resolve) => setTimeout(resolve, 120));
  return true;
}

function sendToTab(tabId, message) {
  return api.tabs.sendMessage(tabId, message);
}

function sendToBackground(message) {
  return api.runtime.sendMessage(message);
}

module.exports = {
  api,
  IS_FIREFOX,
  ensureHostAccess,
  ensureContentScript,
  isScriptableUrl,
  activeTab,
  sendToTab,
  sendToBackground,
};
