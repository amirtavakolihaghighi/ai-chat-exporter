'use strict';

/**
 * Content script. Runs inside the chat page, in the extension's isolated world:
 * full DOM access, none of the page's own JavaScript.
 *
 * This is where the extension has a real advantage over the desktop app — the
 * page is already loaded in the user's own session, so private conversations
 * need no share link and no second sign-in.
 *
 * The heavy lifting is the same extractor the desktop app injects, imported
 * here as a module rather than pasted in as text.
 */

const { createExtractor } = require('../../../src/inject/extract.js');
const { startPicker } = require('../../../src/inject/picker.js');
const { PROVIDERS, COMMON_STRIP, COMMON_EXPAND, matchProvider } = require('../../../src/shared/providers.js');

const api = typeof globalThis.browser !== 'undefined' ? globalThis.browser : globalThis.chrome;

// Injected more than once (a second capture, a reload race) would register
// duplicate listeners and answer every message twice.
if (globalThis.__aceContentLoaded) {
  // already installed
} else {
  globalThis.__aceContentLoaded = true;

  /** Asks the background to fetch an image, which is not bound by page CORS. */
  function fetchAsDataUrl(url) {
    return api.runtime
      .sendMessage({ type: 'ace:fetchImage', url })
      .then((res) => (res && res.ok ? res.dataUrl : null))
      .catch(() => null);
  }

  function resolvePack(userPacks) {
    const builtin = matchProvider(location.href, PROVIDERS) || {};
    const host = location.hostname.toLowerCase();
    const user = (userPacks || {})[host] || {};
    const merged = { ...builtin, ...user };
    if (builtin.genericName && !user.name) merged.name = host || builtin.name;
    if (user.turnSelector) merged.name = user.name || merged.name || host;
    return {
      pack: merged,
      source: user.turnSelector ? 'user' : builtin.id ? 'builtin' : 'heuristic',
    };
  }

  async function capture(request) {
    const { pack, source } = resolvePack(request.userPacks);
    const settings = request.settings || {};

    const config = {
      pack,
      commonStrip: COMMON_STRIP,
      commonExpand: COMMON_EXPAND,
      embedImages: settings.embedImages !== false,
      settleMs: Math.max(100, settings.settleMs || 450),
      maxScrollSteps: Math.max(20, settings.maxScrollSteps || 400),
      maxImageBytes: 12 * 1024 * 1024,
      maxTotalImageBytes: 150 * 1024 * 1024,
      maxDurationMs: Math.max(15000, (settings.maxReadSeconds || 90) * 1000),
      fetchAsDataUrl: settings.embedImages === false ? null : fetchAsDataUrl,
    };

    const result = await createExtractor(config);
    return { ...result, packSource: source, packName: pack.name || location.hostname };
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return undefined;

    switch (message.type) {
      case 'ace:ping':
        sendResponse({ ok: true });
        return undefined;

      case 'ace:describe': {
        const { pack, source } = resolvePack(message.userPacks);
        sendResponse({
          ok: true,
          url: location.href,
          host: location.hostname,
          title: document.title,
          providerName: pack.name || location.hostname,
          packSource: source,
        });
        return undefined;
      }

      case 'ace:capture':
        capture(message)
          .then((result) => sendResponse({ ok: true, result }))
          .catch((err) => sendResponse({ ok: false, error: String((err && err.stack) || err) }));
        return true; // response is async

      case 'ace:pick':
        startPicker()
          .then((result) => sendResponse({ ok: true, result }))
          .catch((err) => sendResponse({ ok: false, error: String(err) }));
        return true;

      /* ---- the scroll-and-stitch screenshot needs the page driven by us ---- */

      case 'ace:pageMetrics': {
        const el = document.scrollingElement || document.documentElement;
        sendResponse({
          ok: true,
          width: Math.max(el.scrollWidth, window.innerWidth),
          height: el.scrollHeight,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        });
        return undefined;
      }

      case 'ace:prepareShot': {
        // Fixed and sticky elements would otherwise be repeated in every tile.
        const hidden = [];
        for (const el of document.querySelectorAll('body *')) {
          const style = getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'sticky') {
            hidden.push([el, el.style.visibility]);
            el.style.visibility = 'hidden';
          }
        }
        globalThis.__aceHiddenForShot = hidden;
        globalThis.__aceScrollRestore = window.scrollY;
        sendResponse({ ok: true, hidden: hidden.length });
        return undefined;
      }

      case 'ace:scrollTo': {
        window.scrollTo(0, message.y);
        // Two frames is normally enough for the scroll to be painted. But a
        // background tab produces no frames at all, so requestAnimationFrame
        // would never fire and this message would never be answered — the
        // caller would wait forever. Race it against a timer so the reply
        // always arrives.
        let answered = false;
        const reply = () => {
          if (answered) return;
          answered = true;
          sendResponse({ ok: true, y: window.scrollY, visible: document.visibilityState === 'visible' });
        };
        requestAnimationFrame(() => requestAnimationFrame(reply));
        setTimeout(reply, 400);
        return true;
      }

      case 'ace:finishShot': {
        for (const [el, visibility] of globalThis.__aceHiddenForShot || []) {
          el.style.visibility = visibility;
        }
        globalThis.__aceHiddenForShot = null;
        window.scrollTo(0, globalThis.__aceScrollRestore || 0);
        sendResponse({ ok: true });
        return undefined;
      }

      default:
        return undefined;
    }
  });
}
