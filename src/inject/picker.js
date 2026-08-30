/**
 * Click-to-pick element selector, injected into the guest page.
 *
 * This is the escape hatch for sites whose markup we don't recognise, and for
 * when a provider ships a redesign that breaks its pack. The user clicks one
 * message; we derive a selector that matches all of its siblings and hand it
 * back so it can be saved as a user pack.
 *
 * Resolves to { ok, selector, matches, sampleText } or { ok:false, cancelled }.
 */
function __aceStartPicker() {
  'use strict';

  if (window.__aceCancelPick) window.__aceCancelPick();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'border:2px solid #4f9cf9',
      'background:rgba(79,156,249,.18)',
      'border-radius:4px',
      'transition:all .05s linear',
    ].join(';');

    const hint = document.createElement('div');
    hint.textContent = 'Click a single message to teach the exporter its shape  ·  Esc to cancel';
    hint.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:16px',
      'transform:translateX(-50%)',
      'z-index:2147483647',
      'background:#111827',
      'color:#f9fafb',
      'font:13px/1.4 system-ui,sans-serif',
      'padding:8px 14px',
      'border-radius:999px',
      'box-shadow:0 4px 18px rgba(0,0,0,.4)',
      'pointer-events:none',
    ].join(';');

    document.body.appendChild(overlay);
    document.body.appendChild(hint);

    let current = null;

    /** True for classes that look generated (hashed/atomic) and thus unstable. */
    function unstableClass(c) {
      return (
        !c ||
        c.length > 30 ||
        /^(css|sc|jsx|emotion|svelte|ng|_)[-_]?[0-9a-z]{4,}$/i.test(c) ||
        /^[a-f0-9]{6,}$/i.test(c) ||
        /^(hover|focus|active|md|sm|lg|xl|dark|group|peer):/i.test(c) ||
        /^(flex|grid|block|inline|relative|absolute|w-|h-|p-|m-|px-|py-|mx-|my-|gap-|text-|bg-|border|rounded|shadow|items-|justify-|min-|max-|overflow|z-|top-|left-|right-|bottom-|space-|font-size)/i.test(c)
      );
    }

    /** Prefer attributes a redesign is least likely to churn. */
    function tokenFor(el) {
      if (el.id && !/^[0-9]/.test(el.id) && el.id.length < 40) {
        return `#${CSS.escape(el.id)}`;
      }
      for (const attr of ['data-testid', 'data-message-author-role', 'data-message-role', 'data-content', 'data-role']) {
        const v = el.getAttribute(attr);
        if (v) return `[${attr}="${CSS.escape(v)}"]`;
      }
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).filter((c) => !unstableClass(c));
      if (classes.length) return `${tag}.${classes.slice(0, 2).map((c) => CSS.escape(c)).join('.')}`;
      return tag;
    }

    function selectorFor(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
        const token = tokenFor(node);
        parts.unshift(token);
        // An id or test-id is unique enough to stop climbing.
        if (token.startsWith('#') || token.startsWith('[data-testid')) break;
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    /**
     * Walk outward until the selector picks up sibling messages too — one
     * message alone isn't useful, we need the pattern for the whole thread.
     */
    function generalise(el) {
      let candidate = selectorFor(el);
      let count = safeCount(candidate);
      let node = el;
      for (let i = 0; i < 4 && count < 2 && node.parentElement; i++) {
        node = node.parentElement;
        const loose = tokenFor(node) + ' > ' + tokenFor(el);
        if (safeCount(loose) >= 2) return { selector: loose, matches: safeCount(loose) };
        const bare = tokenFor(el);
        if (safeCount(bare) >= 2) return { selector: bare, matches: safeCount(bare) };
        candidate = selectorFor(node);
        count = safeCount(candidate);
      }
      return { selector: candidate, matches: count };
    }

    function safeCount(sel) {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    }

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === overlay || el === hint) return;
      current = el;
      const r = el.getBoundingClientRect();
      overlay.style.left = r.left + 'px';
      overlay.style.top = r.top + 'px';
      overlay.style.width = r.width + 'px';
      overlay.style.height = r.height + 'px';
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      hint.remove();
      delete window.__aceCancelPick;
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = current || e.target;
      const { selector, matches } = generalise(el);
      cleanup();
      resolve({
        ok: true,
        selector,
        matches,
        sampleText: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 180),
      });
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cleanup();
      resolve({ ok: false, cancelled: true });
    }

    window.__aceCancelPick = () => {
      cleanup();
      resolve({ ok: false, cancelled: true });
    };

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
  });
}

// Same dual-use arrangement as extract.js: importable by the extension,
// injectable as text by the desktop app.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startPicker: __aceStartPicker };
}
