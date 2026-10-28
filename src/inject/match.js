/**
 * Decides which elements on a chat page are messages, and who sent each one.
 *
 * Shared by the extractor (src/inject/extract.js), which reads what it finds,
 * and the teach overlay (src/inject/teach.js), which draws it — so the boxes a
 * person sees while teaching are exactly what a read will capture.
 *
 * Dual-use like the other injectable scripts: a plain function declaration
 * that the desktop app places in front of extract.js or teach.js before
 * injecting them, and a CommonJS export for the extension's bundler.
 *
 * @param {(msg: string) => void} [note] receives a line for the read's log
 */
function __aceMatcher(note) {
  'use strict';

  const log = typeof note === 'function' ? note : () => {};

  /* ---------------------------------------------------------------- utils */

  /** null for a selector the browser rejects, so callers can report it. */
  function qsa(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      return null;
    }
  }

  function matches(el, selector) {
    if (!selector || !el || !el.matches) return false;
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  }

  function queryOne(root, selector) {
    try {
      return root.querySelector(selector);
    } catch {
      return null;
    }
  }

  function sortInDocumentOrder(list) {
    return list.sort((a, b) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
  }

  /** Every element any of `selectors` finds, once each, in page order. */
  function queryAll(selectors, root = document) {
    const found = new Set();
    const invalid = [];
    for (const selector of selectors || []) {
      const list = qsa(root, selector);
      if (!list) {
        invalid.push(selector);
        continue;
      }
      for (const el of list) found.add(el);
    }
    return { elements: sortInDocumentOrder([...found]), invalid };
  }

  /** Text or a picture: a reply from an image model has no text at all. */
  function hasContent(el) {
    return el.textContent.trim().length > 0 || Boolean(el.querySelector('img, video, canvas, picture'));
  }

  /**
   * Length of the text a person could actually read.
   *
   * textContent includes the source of inline scripts, and modern pages carry
   * a great deal of it — hydration data, analytics. Counted as text, it swamps
   * the real content and makes every "share of the page" measurement wrong.
   */
  function visibleTextLength(el) {
    let length = el.textContent.length;
    for (const hidden of el.querySelectorAll('script, style, noscript, template')) {
      length -= hidden.textContent.length;
    }
    return Math.max(0, length);
  }

  /* ----------------------------------------------------------- navigation */

  // A list of past chats is a list of similar-sized blocks of text, which is
  // exactly what a conversation looks like to a layout heuristic. These are the
  // landmarks that mark page furniture rather than content.
  const NAVIGATION =
    'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], ' +
    '[role="banner"], [role="contentinfo"], body > header, body > footer';
  const SIDE_PANELS = 'aside, [role="complementary"]';

  /** A side panel counts as navigation only while it is narrow, like a sidebar. */
  function isSidebar(el) {
    const width = el.getBoundingClientRect().width;
    return width > 0 && width < Math.max(window.innerWidth, 1) * 0.45;
  }

  function inNavigation(el) {
    if (!el || !el.closest) return false;
    if (el.closest(NAVIGATION)) return true;
    const panel = el.closest(SIDE_PANELS);
    return Boolean(panel && isSidebar(panel));
  }

  function navigationRoots() {
    const roots = (qsa(document, NAVIGATION) || []).concat(
      (qsa(document, SIDE_PANELS) || []).filter(isSidebar)
    );
    const set = new Set(roots);
    // Outermost only, so nested landmarks are not counted twice.
    return roots.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  /* ---------------------------------------------------------------- rules */

  function selectorsFor(rules, part) {
    const list = rules && rules.parts && rules.parts[part];
    return Array.isArray(list) ? list : [];
  }

  const MESSAGE_PARTS = ['user', 'assistant', 'message'];

  /**
   * Everything the rules say is a message, in page order.
   *
   * Three things are resolved here so that callers never have to:
   *
   *  - The same element claimed by more than one part. A part that names the
   *    speaker beats one that leaves it to be guessed, and between two that
   *    both name it, the narrower rule wins — ".message.mine" over ".message".
   *  - Anything inside a "leave out" area is not a message.
   *  - Messages inside messages. One inside another of the same speaker is
   *    just part of its content. One of a different speaker is read as a
   *    message of its own and cut out of the one containing it — which is how
   *    a site that wraps a question and its answer in one element is read
   *    correctly once both halves have been pointed at.
   *
   * @returns {{messages: {el: Element, role: string|null, part: string, cuts: Element[]}[],
   *            found: Object<string, number>, invalid: string[]}}
   *   `found` counts what each part's selectors matched before any of this.
   */
  function findMessages(rules) {
    const claims = new Map();
    const found = {};
    const invalid = [];

    for (const part of MESSAGE_PARTS) {
      let count = 0;
      for (const selector of selectorsFor(rules, part)) {
        const list = qsa(document, selector);
        if (!list) {
          invalid.push(selector);
          continue;
        }
        for (const el of list) {
          if (!hasContent(el)) continue;
          count++;
          const claim = { role: part === 'message' ? null : part, part, size: list.length };
          const previous = claims.get(el);
          if (!previous || outranks(claim, previous)) claims.set(el, claim);
        }
      }
      found[part] = count;
    }

    const skipped = queryAll(selectorsFor(rules, 'exclude'));
    invalid.push(...skipped.invalid);
    if (skipped.elements.length) {
      for (const el of [...claims.keys()]) {
        if (skipped.elements.some((area) => area === el || area.contains(el))) claims.delete(el);
      }
    }

    const messages = [];
    const kept = new Map();
    for (const el of sortInDocumentOrder([...claims.keys()])) {
      const claim = claims.get(el);
      let owner = null;
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (kept.has(p)) {
          owner = kept.get(p);
          break;
        }
      }
      if (owner) {
        if (claim.role === null || claim.role === owner.role) continue;
        owner.cuts.push(el);
      }
      const message = { el, role: claim.role, part: claim.part, cuts: [] };
      kept.set(el, message);
      messages.push(message);
    }
    return { messages, found, invalid };
  }

  function outranks(a, b) {
    if ((a.role !== null) !== (b.role !== null)) return a.role !== null;
    return a.size < b.size;
  }

  /**
   * How many of each part this page has: messages by the part that found
   * them, the rest by what their selectors match where it matters.
   */
  function partCounts(rules, messages) {
    const counts = { user: 0, assistant: 0, message: 0 };
    for (const m of messages) counts[m.part] = (counts[m.part] || 0) + 1;
    const inside = (part) => {
      const { elements } = queryAll(selectorsFor(rules, part));
      return elements.filter((el) => messages.some((m) => m.el.contains(el))).length;
    };
    counts.thinking = inside('thinking');
    counts.body = inside('body');
    counts.exclude = queryAll(selectorsFor(rules, 'exclude')).elements.length;
    counts.title = selectorsFor(rules, 'title').some((s) => {
      const el = queryOne(document, s);
      return Boolean(el && el.textContent.trim());
    })
      ? 1
      : 0;
    counts.scroll = queryAll(selectorsFor(rules, 'scroll')).elements.length ? 1 : 0;
    counts.expand = queryAll(selectorsFor(rules, 'expand')).elements.length;
    return counts;
  }

  /* -------------------------------------------------------------- speakers */

  /**
   * Who sent a message that no rule labelled.
   *
   * Strongest evidence first: an attribute or marker the rules name, a label
   * for screen readers, the site's own class names, then where the message
   * sits on screen — a bubble pushed to the right is nearly always the person.
   * Only when there is nothing at all does it fall back to assuming the
   * conversation alternates.
   */
  function roleOf(el, index, options) {
    const opts = options || {};
    if (opts.roleAttr) {
      const holder = el.hasAttribute(opts.roleAttr) ? el : queryOne(el, `[${opts.roleAttr}]`);
      const raw = holder && holder.getAttribute(opts.roleAttr);
      if (raw) {
        const mapped = (opts.roleMap && opts.roleMap[raw]) || raw;
        if (/user|human/i.test(mapped)) return 'user';
        if (/assistant|model|bot|ai/i.test(mapped)) return 'assistant';
        if (/system|tool/i.test(mapped)) return mapped.toLowerCase();
      }
    }
    if (opts.userMarker && (matches(el, opts.userMarker) || queryOne(el, opts.userMarker))) return 'user';
    if (opts.assistantMarker && (matches(el, opts.assistantMarker) || queryOne(el, opts.assistantMarker))) {
      return 'assistant';
    }

    const spoken = screenReaderLabel(el);
    if (spoken) return spoken;

    const cls = `${el.className || ''} ${el.parentElement?.className || ''}`;
    if (typeof cls === 'string') {
      if (/\b(justify-end|ml-auto|self-end|user|right-side)\b/i.test(cls)) return 'user';
      if (/\b(assistant|bot|model|response|agent)\b/i.test(cls)) return 'assistant';
    }
    const img = el.querySelector?.('img[alt]');
    if (img) {
      const alt = img.getAttribute('alt').toLowerCase();
      if (/you|user|avatar/.test(alt)) return 'user';
      if (/chatgpt|claude|gemini|assistant|bot|ai/.test(alt)) return 'assistant';
    }
    if (looksRightAligned(el)) return 'user';
    return index % 2 === 0 ? 'user' : 'assistant';
  }

  /** "You said:" / "ChatGPT said:", which some sites write for screen readers. */
  function screenReaderLabel(el) {
    const labels = qsa(el, '.sr-only, .visually-hidden, [class*="screen-reader"]') || [];
    for (const label of labels.slice(0, 3)) {
      const text = label.textContent.trim();
      if (/^you\s+(said|wrote|asked)\b/i.test(text)) return 'user';
      if (/\b(said|wrote|replied|answered)\s*:?\s*$/i.test(text)) return 'assistant';
    }
    return null;
  }

  /**
   * True when the message's visible bubble is pushed to the right.
   *
   * The message element itself is often full width; the bubble is a box
   * further in. So follow the chain of boxes that hold nearly all of the
   * message's text and see whether any of them sits against the right edge
   * with a wide gap on the left.
   */
  function looksRightAligned(el) {
    const outer = el.getBoundingClientRect();
    if (outer.width < 80) return false;
    const total = el.textContent.length || 1;
    let node = el;
    for (let depth = 0; depth < 6 && node; depth++) {
      const box = node.getBoundingClientRect();
      if (
        box.width > 0 &&
        box.width < outer.width * 0.85 &&
        box.left - outer.left > outer.width * 0.15 &&
        outer.right - box.right < outer.width * 0.08
      ) {
        return true;
      }
      node = Array.from(node.children).find((child) => child.textContent.length >= total * 0.9) || null;
    }
    return false;
  }

  /* -------------------------------------------------------------- guessing */

  /** Markers common enough across chat front-ends to try before anything else. */
  const COMMON_MARKERS = [
    '[data-message-author-role]',
    '[data-testid*="message"]',
    '[data-message-id]',
    '[class*="message-row"]',
    '[class*="ChatMessage"]',
    '[class*="chat-message"]',
    '[class*="message-bubble"]',
    '.message',
    '[role="listitem"]',
  ];

  let guessChoice = null;

  function outermost(list) {
    const set = new Set(list);
    return list.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  function usable(list) {
    return list.filter((el) => hasContent(el) && !inNavigation(el));
  }

  function blocksIn(container) {
    return Array.from(container.children).filter(
      (kid) => kid.textContent.trim().length > 20 && !inNavigation(kid)
    );
  }

  /**
   * The messages on a page nobody has written rules for.
   *
   * Decided once and then reused: re-scoring every container in the document
   * on every scroll step was the slowest thing a read did.
   */
  function guessMessages() {
    if (guessChoice) {
      if (guessChoice.selector) {
        const found = outermost(usable(qsa(document, guessChoice.selector) || []));
        if (found.length >= 2) return found;
      } else if (guessChoice.container && document.contains(guessChoice.container)) {
        const kids = blocksIn(guessChoice.container);
        if (kids.length >= 2) return kids;
      }
      guessChoice = null; // the page changed shape; decide again
    }

    for (const selector of COMMON_MARKERS) {
      const found = outermost(usable(qsa(document, selector) || []));
      if (found.length >= 2) {
        log(`Layout guessed from a common message marker: ${selector}`);
        guessChoice = { selector };
        return found;
      }
    }

    const container = bestContainer();
    if (!container) return [];
    const kids = blocksIn(container);
    log(`Layout guessed from how the text is arranged: a list of ${kids.length} blocks.`);
    guessChoice = { container };
    return kids;
  }

  /**
   * The element whose children look most like a conversation: it holds most
   * of the page's readable text, split into several similar-sized blocks.
   *
   * Navigation is taken out first, both as a candidate and from the total. A
   * sidebar of past chats is a list of similar-sized blocks of text too, and
   * against a short conversation it used to win.
   */
  function bestContainer() {
    const roots = navigationRoots();
    const holdsNavigation = new Set();
    for (const root of roots) {
      for (let p = root.parentElement; p; p = p.parentElement) holdsNavigation.add(p);
    }
    let navText = 0;
    for (const root of roots) navText += visibleTextLength(root);
    const total = Math.max(1, visibleTextLength(document.body) - navText);

    let best = null;
    let bestScore = 0;
    for (const el of document.querySelectorAll('main, div, section, article, ul, ol')) {
      // Cheap rejection first: raw text only overstates the readable share.
      if (el.textContent.length / total < 0.35) continue;
      if (holdsNavigation.has(el) || inNavigation(el)) continue;
      const kids = blocksIn(el);
      if (kids.length < 2 || kids.length > 400) continue;
      const length = visibleTextLength(el);
      const share = length / total;
      if (share < 0.35) continue;
      if (linkShare(el, length) > 0.6) continue; // a list of links is navigation, whatever it is called

      // Favour many similarly sized children and a high share of page text.
      const sizes = kids.map((k) => k.textContent.trim().length);
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const variance =
        sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length / (mean * mean || 1);
      const score = share * Math.log(1 + kids.length) * (1 / (1 + variance));
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  function linkShare(el, length) {
    let linked = 0;
    for (const a of el.querySelectorAll('a[href]')) linked += a.textContent.length;
    return linked / Math.max(1, length);
  }

  /** The guessed message holding `el`, for snapping a pointer to a whole message. */
  function guessedMessageFor(el) {
    for (const message of guessMessages()) {
      if (message === el || message.contains(el)) return message;
    }
    return null;
  }

  return {
    findMessages,
    partCounts,
    roleOf,
    guessMessages,
    guessedMessageFor,
    inNavigation,
    queryAll,
    hasContent,
    visibleTextLength,
    sortInDocumentOrder,
  };
}

// Present under a bundler, absent in a plain web page — see extract.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMatcher: __aceMatcher };
}
