/**
 * Runs inside the page holding the chat, in two different ways:
 *
 *  - the desktop app injects this file's text into a <webview> and calls
 *    __aceCreateExtractor(config) — see src/main/lib/inject.js;
 *  - the browser extension imports it as a module and calls createExtractor.
 *
 * Hence a plain function declaration plus a guarded CommonJS export: the guard
 * is false inside a web page, so injection stays a no-op there, and true under
 * a bundler, so the extension gets a normal module.
 *
 * Either way the result must be structured-clone-safe, because it crosses a
 * process boundary in both products.
 *
 * Which elements are messages is decided by src/inject/match.js, which the
 * teach overlay shares — this file is about reading them: scrolling, unfolding,
 * cleaning and assembling.
 *
 * CONFIG.rules is the site's rule set (see src/shared/rules.js), or null when
 * the site has none and its layout has to be guessed. With rules, a read never
 * falls back to guessing: rules that find nothing say so, because a guess made
 * behind their back is how a list of past chats once came out as the
 * conversation, reported as a success.
 */
function __aceCreateExtractor(CONFIG) {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const note = (msg) => log.push(msg);

  // Both files share one scope when the desktop app injects them; under a
  // bundler the matcher is an ordinary module.
  const MATCH = (typeof __aceMatcher === 'function' ? __aceMatcher : require('./match.js').createMatcher)(note);

  const RULES = CONFIG.rules || null;
  const OPTIONS = (RULES && RULES.options) || {};
  const partOf = (key) => (RULES && RULES.parts && Array.isArray(RULES.parts[key]) ? RULES.parts[key] : []);

  /* ---------------------------------------------------------------- utils */

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

  /** Cheap stable hash, used to dedupe turns seen on more than one scroll pass. */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  function qsa(root, sel) {
    if (!sel) return [];
    try {
      return Array.from(root.querySelectorAll(sel));
    } catch {
      return [];
    }
  }

  function matches(el, sel) {
    if (!sel || !el) return false;
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  }

  /** Drops any element inside another one in the same list. */
  function outermost(list) {
    const set = new Set(list);
    return list.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
      return true;
    });
  }

  /* ------------------------------------------------------- scroll handling */

  /**
   * Chat UIs scroll either the window or an inner pane. Find whichever one
   * actually owns the overflow, since we have to drive it to force virtualised
   * message lists to render.
   */
  function findScrollEl() {
    for (const selector of partOf('scroll')) {
      const el = qsa(document, selector)[0];
      if (el) return el;
    }
    const docScrolls =
      document.documentElement.scrollHeight > window.innerHeight + 40;
    if (docScrolls) return document.scrollingElement || document.documentElement;

    let best = null;
    let bestArea = 0;
    for (const el of document.querySelectorAll('div, main, section')) {
      const style = getComputedStyle(el);
      const scrolls = /auto|scroll|overlay/.test(style.overflowY);
      if (!scrolls) continue;
      if (el.scrollHeight <= el.clientHeight + 40) continue;
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = el;
        bestArea = area;
      }
    }
    return best || document.scrollingElement || document.documentElement;
  }

  const isWindowScroller = (el) =>
    el === document.scrollingElement || el === document.documentElement || el === document.body;

  function scrollTop(el) {
    return isWindowScroller(el) ? window.scrollY : el.scrollTop;
  }
  function scrollHeight(el) {
    return isWindowScroller(el) ? document.documentElement.scrollHeight : el.scrollHeight;
  }
  function viewport(el) {
    return isWindowScroller(el) ? window.innerHeight : el.clientHeight;
  }
  function scrollTo(el, y) {
    if (isWindowScroller(el)) window.scrollTo(0, y);
    else el.scrollTop = y;
  }

  /** Absolute Y of an element within the scroller, used to re-order turns. */
  function absoluteY(el, scroller) {
    const rect = el.getBoundingClientRect();
    if (isWindowScroller(scroller)) return rect.top + window.scrollY;
    return rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  }

  /* ------------------------------------------------------------- expanding */

  /** The smallest element holding every message on the page now, or null. */
  function conversationArea() {
    const list = currentMessages().map((m) => m.el);
    if (!list.length) return null;
    let area = list[0].parentElement;
    while (area && !list.every((el) => area.contains(el))) area = area.parentElement;
    return area;
  }

  /**
   * Unfold collapsed reasoning blocks, "show more" clamps and <details>.
   * Done repeatedly because expanding one block often reveals another.
   *
   * Buttons are only pressed inside the conversation — the part of the page
   * that holds the messages — and never in a menu or sidebar. Pressed anywhere,
   * the usual unfold buttons also opened the site's own menus, model pickers
   * and sidebar sections, changing the page while it was being read.
   */
  async function expandAll() {
    const selectors = [...partOf('expand'), ...CONFIG.commonExpand];
    let clicked = 0;
    for (let pass = 0; pass < 3; pass++) {
      let clickedThisPass = 0;
      const area = conversationArea();
      if (!area) break;
      for (const sel of selectors) {
        for (const el of qsa(document, sel)) {
          if (!area.contains(el) || MATCH.inNavigation(el)) continue;
          // Never touch anything that would navigate away or submit.
          if (el.closest('a[href]') || matches(el, '[type="submit"]')) continue;
          const label = norm(el.getAttribute('aria-label') || el.textContent).toLowerCase();
          if (/copy|share|delete|edit|regenerate|retry|feedback|report|sign|log ?in/.test(label)) continue;
          try {
            el.click();
            clicked++;
            clickedThisPass++;
          } catch {
            /* ignore */
          }
        }
      }
      if (!clickedThisPass) break;
      // Only pay this when something actually opened.
      await sleep(120);
    }
    // Defeat line-clamp / max-height truncation that has no button.
    for (const el of qsa(document, '[class*="line-clamp"], [class*="truncate"]')) {
      el.style.webkitLineClamp = 'unset';
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
    }
    if (clicked) note(`Expanded ${clicked} collapsed block(s).`);
    return clicked;
  }

  /* ------------------------------------------------------- turn discovery */

  // The most each part found at any point in the read, for the health report:
  // `found` is what its selectors matched, `kept` what became messages.
  const partFound = {};
  const partKept = {};
  const invalidSelectors = new Set();

  /** The messages on the page right now: {el, role, part, cuts}, in page order. */
  function currentMessages() {
    if (!RULES) {
      return MATCH.guessMessages().map((el) => ({ el, role: null, part: 'guess', cuts: [] }));
    }
    const { messages, found, invalid } = MATCH.findMessages(RULES);
    for (const [part, count] of Object.entries(found)) {
      partFound[part] = Math.max(partFound[part] || 0, count);
    }
    const kept = {};
    for (const message of messages) kept[message.part] = (kept[message.part] || 0) + 1;
    for (const [part, count] of Object.entries(kept)) {
      partKept[part] = Math.max(partKept[part] || 0, count);
    }
    for (const selector of invalid) invalidSelectors.add(selector);
    return messages;
  }

  /**
   * Waits for the conversation to appear.
   *
   * A chat opened a moment ago may still be arriving. Deciding there is nothing
   * here — or, with rules, that the rules no longer fit — before it has had the
   * chance to render would be wrong in both cases.
   */
  async function waitForMessages(limitMs) {
    const deadline = Date.now() + Math.max(0, limitMs);
    for (;;) {
      if (currentMessages().length) return true;
      if (Date.now() >= deadline) return false;
      await sleep(250);
    }
  }

  /* ------------------------------------------------------ content cleaning */

  /** Anything that is content in its own right and must survive cleaning. */
  const MEDIA_SELECTOR = 'img, picture, video, audio, canvas, source, figure';

  /** Toolbars that sites put inside or above a code block. */
  const CODE_CHROME_SELECTOR = [
    '[class*="code-header"]',
    '[class*="codeHeader"]',
    '[class*="code-block-header"]',
    '[class*="language-label"]',
    '[class*="languageLabel"]',
    '[class*="code-toolbar"]',
    '[class*="copy-code"]',
  ].join(', ');

  /**
   * Marks elements on the page that must not reach the export: messages of
   * another speaker nested inside this one (they are read on their own), and
   * anything inside a "leave out" area. The marks are put on just before a
   * message is cloned and taken off straight after.
   */
  const DROP_ATTR = 'data-ace-drop';
  const outsideDropped = (node) => !node.closest(`[${DROP_ATTR}]`);

  /**
   * Line breaks and spaces a person typed.
   *
   * A prompt is shown on the site with styling that keeps its line breaks and
   * runs of spaces (white-space: pre-wrap), and that styling does not travel
   * with an export — so a prompt typed over several lines came out as one long
   * line. Elements shown that way are marked before cloning; in the clone their
   * line breaks become real <br> elements and their runs of spaces
   * non-breaking ones, which every format keeps.
   */
  const LINES_ATTR = 'data-ace-lines';

  function whitespaceKept(el) {
    const style = getComputedStyle(el);
    const collapse = style.whiteSpaceCollapse;
    if (collapse) {
      if (collapse === 'preserve' || collapse === 'break-spaces') return 'all';
      return collapse === 'preserve-breaks' ? 'lines' : '';
    }
    if (/^(pre|pre-wrap|break-spaces)$/.test(style.whiteSpace)) return 'all';
    return style.whiteSpace === 'pre-line' ? 'lines' : '';
  }

  function markTypedLines(root) {
    const marked = [];
    const checked = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!/\n| {2}/.test(walker.currentNode.nodeValue)) continue;
      const parent = walker.currentNode.parentElement;
      if (!parent || checked.has(parent)) continue;
      checked.add(parent);
      // Code keeps its layout through its own <pre> handling.
      if (parent.closest('pre, code, textarea, script, style')) continue;
      const kept = whitespaceKept(parent);
      if (!kept) continue;
      parent.setAttribute(LINES_ATTR, kept);
      marked.push(parent);
    }
    return marked;
  }

  function applyTypedLines(clone) {
    const targets = qsa(clone, `[${LINES_ATTR}]`);
    if (clone.hasAttribute && clone.hasAttribute(LINES_ATTR)) targets.unshift(clone);
    for (const el of targets) {
      const spaces = el.getAttribute(LINES_ATTR) === 'all';
      el.removeAttribute(LINES_ATTR);
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || !/\n| {2}/.test(node.nodeValue)) continue;
        const pieces = document.createDocumentFragment();
        node.nodeValue.split('\n').forEach((line, i) => {
          if (i > 0) pieces.appendChild(document.createElement('br'));
          const text = spaces ? line.replace(/ {2,}/g, (run) => '\u00a0'.repeat(run.length - 1) + ' ') : line;
          if (text) pieces.appendChild(document.createTextNode(text));
        });
        node.replaceWith(pieces);
      }
      // A line break at the very end shows nothing on the site; in a file it
      // would add an empty line.
      while (el.lastChild && el.lastChild.nodeName === 'BR') el.lastChild.remove();
    }
  }

  /** Text with line breaks as spaces, so words either side of one stay apart. */
  function textOf(node) {
    let out = '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current.nodeType === Node.TEXT_NODE) out += current.nodeValue;
      else if (current.nodeName === 'BR') out += '\n';
    }
    return out;
  }

  /** Absolutise a URL so exported files still resolve links after the fact. */
  function absUrl(u) {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return u;
    }
  }

  /**
   * Deep-clone a turn's content and strip everything that isn't the message:
   * chrome, handlers, inline styles that assume the site's stylesheet.
   */
  function cleanClone(el) {
    const clone = el.cloneNode(true);
    // Unlike the generic strip list below, these go with any pictures inside
    // them: they were marked because they are not this message at all.
    for (const node of qsa(clone, `[${DROP_ATTR}]`)) node.remove();
    applyTypedLines(clone);

    for (const sel of CONFIG.commonStrip) {
      for (const node of qsa(clone, sel)) {
        // Removing chrome must never remove content along with it. A generated
        // picture is usually wrapped in a button or a link so it can be clicked
        // to enlarge, and stripping the wrapper takes the picture with it —
        // which is how image replies went missing entirely.
        if (node.querySelector(MEDIA_SELECTOR) || matches(node, MEDIA_SELECTOR)) continue;
        node.remove();
      }
    }
    // Keep KaTeX maths: swap the rendered markup for its TeX source so the
    // Markdown/DOCX side can emit real $…$ instead of mangled glyph soup.
    for (const k of qsa(clone, '.katex, .katex-display')) {
      const tex = k.querySelector('annotation[encoding="application/x-tex"]');
      if (!tex) continue;
      const display = k.classList.contains('katex-display');
      const span = document.createElement('span');
      span.setAttribute('data-tex', tex.textContent || '');
      span.setAttribute('data-display', display ? '1' : '0');
      span.textContent = (display ? '$$' : '$') + (tex.textContent || '') + (display ? '$$' : '$');
      k.replaceWith(span);
    }
    // Comment nodes are never message content, but they survive cloning and end
    // up in the exported file - framework markers, build noise, occasionally
    // something the site's authors would rather not publish.
    const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const stale = [];
    while (comments.nextNode()) stale.push(comments.currentNode);
    for (const comment of stale) comment.remove();

    for (const node of qsa(clone, '*')) {
      for (const attr of Array.from(node.attributes)) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) node.removeAttribute(attr.name);
        if (name === 'style') {
          // Two kinds of inline style are actively harmful in an export.
          // Positioning assumes the site's own layout. And inline hiding
          // defeats the whole point of expanding collapsed sections: the
          // content lands in the file but cannot be seen when it is opened.
          let value = attr.value;
          if (/position\s*:\s*(fixed|absolute)/i.test(value)) {
            node.removeAttribute('style');
          } else if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(value)) {
            value = value
              .replace(/display\s*:\s*none\s*;?/gi, '')
              .replace(/visibility\s*:\s*hidden\s*;?/gi, '');
            if (value.trim()) node.setAttribute('style', value);
            else node.removeAttribute('style');
          }
        }
      }
      if (node.tagName === 'A' && node.getAttribute('href')) {
        const href = node.getAttribute('href');
        if (/^javascript:/i.test(href)) node.removeAttribute('href');
        else node.setAttribute('href', absUrl(href));
      }
      if (node.tagName === 'IMG') {
        const src = node.currentSrc || node.getAttribute('src');
        if (src) node.setAttribute('src', absUrl(src));
        node.removeAttribute('srcset');
      }
    }
    // Code blocks usually carry a little toolbar: a language label and a copy
    // button, often *inside* the <pre>. Read the language off it, then remove
    // it — left in place it becomes part of the code, so every snippet ends up
    // prefixed with a stray word like "text" or "python".
    for (const pre of qsa(clone, 'pre')) {
      const code = pre.querySelector('code');
      if (!code) continue;

      const declared = /(?:language|lang)-(\S+)/.exec(code.className || '');
      let language = declared ? declared[1] : '';

      const chrome = qsa(pre, CODE_CHROME_SELECTOR)
        .concat(Array.from(pre.children).filter((child) => child !== code && child.tagName !== 'CODE'));

      for (const node of new Set(chrome)) {
        const label = norm(node.textContent);
        // A toolbar is short. Anything long is content and must not be removed.
        if (label.length > 24) continue;
        if (!language) {
          const candidate = label.split(/\s+/)[0] || '';
          if (candidate && /^[a-z0-9+#.-]{1,20}$/i.test(candidate)) language = candidate;
        }
        node.remove();
      }

      if (language && !declared) code.className = `language-${language.toLowerCase()}`;
    }
    return clone;
  }

  /** Messages whose "message text" part matched, for the health report. */
  const withBody = new WeakSet();
  let bodyCount = 0;

  function contentNodeFor(turn) {
    const selectors = partOf('body');
    if (!selectors.length) return turn;

    const nodes = outermost(MATCH.queryAll(selectors, turn).elements.filter(outsideDropped));
    if (!nodes.length) return turn;
    if (!withBody.has(turn)) {
      withBody.add(turn);
      bodyCount++;
    }

    // A content selector names the text of a message — ".markdown", ".prose"
    // and so on. Attachments do not live inside it: a screenshot added to a
    // question sits in its own element beside the text. Narrowing to the
    // selector alone therefore drops every picture the user attached.
    const loose = qsa(turn, MEDIA_SELECTOR).filter(
      (node) => outsideDropped(node) && !nodes.some((content) => content === node || content.contains(node))
    );
    // Keep only the outermost of any nesting (figure > picture > img).
    const attachments = outermost(loose);

    if (nodes.length === 1 && !attachments.length) return nodes[0];

    // Reassemble in the order they appear on the page, so an image above the
    // text does not end up below it.
    const ordered = MATCH.sortInDocumentOrder([...nodes, ...attachments]);

    const wrap = document.createElement('div');
    for (const node of ordered) wrap.appendChild(node.cloneNode(true));
    return wrap;
  }

  /* ------------------------------------------------------------- harvesting */

  // Hard ceiling on how long reading may take. Every wait below is bounded, but
  // a pathological page could still chain enough of them together to feel like
  // a hang; better to stop and say the read may be short than to never finish.
  const readDeadline = () => startedAt + (CONFIG.maxDurationMs || 60000);
  let startedAt = Date.now();
  let hitDeadline = false;
  function outOfTime() {
    if (Date.now() < readDeadline()) return false;
    hitDeadline = true;
    return true;
  }

  /**
   * Everything read so far, in the order first seen.
   *
   * The same message is seen many times — on every scroll step it stays on
   * screen, and again whenever a virtualised list re-creates it — so each
   * sighting has to be matched to the message it belongs to. Matching on
   * content alone once merged two messages that merely said the same thing:
   * "continue", sent twice, came out once.
   */
  const entries = [];
  const byKey = new Map();
  const entryOf = new WeakMap();
  // Element -> text length when it was last harvested. Cloning and cleaning a
  // turn is the single most expensive thing here, and on the slow path the same
  // turns stay on screen across many scroll steps; skip the ones that have not
  // changed since we read them.
  const harvestedAt = new WeakMap();
  const THINK_ATTR = 'data-ace-thinking';

  /** A cheap fingerprint of what an element shows right now. */
  const showing = (el) => `${el.textContent.length}:${el.textContent.slice(0, 80)}`;

  /**
   * True while an earlier sighting's element is still on the page showing the
   * same thing — proof that a new element with the same content is a second
   * message, not the first one drawn again.
   */
  const stillShowing = (entry) => entry.el.isConnected && showing(entry.el) === entry.sig;

  function rekey(entry, key) {
    const list = byKey.get(entry.key) || [];
    byKey.set(entry.key, list.filter((e) => e !== entry));
    entry.key = key;
    byKey.set(key, [...(byKey.get(key) || []), entry]);
  }

  /**
   * Reasoning blocks are not reliably inside the content selector — on several
   * providers they sit as a sibling of the message body, so searching only the
   * cleaned content silently loses them. Search the whole turn instead.
   */
  function thinkingNodesIn(turn) {
    const selectors = partOf('thinking');
    const found = selectors.length
      ? outermost(MATCH.queryAll(selectors, turn).elements.filter(outsideDropped))
      : [];
    if (found.length) return found;
    return qsa(turn, 'details').filter((d) => {
      if (!outsideDropped(d)) return false;
      const summary = norm(d.querySelector('summary')?.textContent).toLowerCase();
      return /thought|thinking|reason|chain of/.test(summary);
    });
  }

  /**
   * Splits an element that holds a whole exchange into its two halves.
   *
   * Some front-ends — Quasar and Vue apps in particular — wrap the question and
   * the answer in a single element carrying no classes at all, only
   * build-generated scoped-style attributes. Nothing marks who is speaking
   * except that the answer half contains rendered markdown. Read as one turn,
   * the user's own words get swallowed into the assistant's reply; matched on
   * the markdown alone, the user's words disappear entirely.
   *
   * So when a rule set names a marker for the assistant half, walk down to the
   * level where the halves are siblings and group the children around it.
   *
   * @returns {{role: string, nodes: Element[]}[]|null} null when this element is
   *   an ordinary single-speaker turn.
   */
  function splitExchange(turn) {
    const marker = OPTIONS.exchangeAssistant;
    if (!marker) return null;

    let host = turn;
    for (let depth = 0; depth < 8; depth++) {
      const children = Array.from(host.children).filter((c) => c.textContent.trim().length);
      if (!children.length) return null;

      const isAssistant = children.map(
        (child) => matches(child, marker) || Boolean(child.querySelector(marker))
      );

      // A usable split point has both kinds side by side.
      if (isAssistant.some(Boolean) && isAssistant.some((flag) => !flag)) {
        const parts = [];
        let current = null;
        children.forEach((child, index) => {
          const role = isAssistant[index] ? 'assistant' : 'user';
          if (!current || current.role !== role) {
            current = { role, nodes: [child] };
            parts.push(current);
          } else {
            current.nodes.push(child);
          }
        });
        return parts.length > 1 ? parts : null;
      }

      // A single wrapper tells us nothing; go one level deeper and look again.
      if (children.length === 1) {
        host = children[0];
        continue;
      }

      // An image-generation reply contains no markdown at all, so the marker
      // finds nothing and the exchange would be left fused under one guessed
      // speaker. When the only thing here is a picture, fall back to position:
      // in a paired layout the question always precedes the answer.
      if (
        !isAssistant.some(Boolean) &&
        children.length === 2 &&
        host.querySelector(MEDIA_SELECTOR)
      ) {
        return [
          { role: 'user', nodes: [children[0]] },
          { role: 'assistant', nodes: [children[1]] },
        ];
      }
      return null;
    }
    return null;
  }

  /**
   * Where a message with parts cut out of it really starts: its first text
   * that is not inside a cut. Its own top edge would put an answer above the
   * question it was wrapped together with.
   */
  function firstContentElement(turn) {
    const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (parent && outsideDropped(parent)) return parent;
    }
    return turn;
  }

  /** Cleans one message and files it under the message it belongs to. */
  function record(node, role, thinkingHtml, positionEl, scroller) {
    const cleaned = cleanClone(node);
    for (const tagged of qsa(cleaned, `[${THINK_ATTR}]`)) tagged.remove();

    const text = norm(textOf(cleaned));

    // A reply from an image model is entirely a picture and carries no text at
    // all. Requiring text threw those messages away silently — the prompt was
    // exported and the answer simply was not there.
    const media = qsa(cleaned, 'img, video, canvas, audio');
    if (!text && !media.length) return;

    const html = cleaned.innerHTML;
    // Two picture-only replies would otherwise collapse into one, having the
    // same (empty) text, so the sources take part in the identity.
    const mediaKey = media
      .map((node) => (node.getAttribute('src') || node.getAttribute('data-original-src') || '').slice(-100))
      .join('|');
    const key = `${role}:${hash(text.slice(0, 400) + '|' + text.length + '|' + mediaKey)}`;
    const y = absoluteY(positionEl, scroller);

    let entry = entryOf.get(positionEl) || null;
    if (entry && entry.key !== key) {
      // The same element now shows more — a reply still arriving, or a section
      // that unfolded — which is the same message, grown. Anything else means
      // the element has been reused for a different message.
      const grew =
        entry.role === role && text.length >= entry.text.length && text.startsWith(entry.text.slice(0, 200));
      if (grew) rekey(entry, key);
      else entry = null;
    }
    if (!entry) {
      entry = (byKey.get(key) || []).find((e) => e.el === positionEl || !stillShowing(e)) || null;
    }

    if (entry) {
      // A later pass may catch a more fully rendered version of the same turn,
      // or reasoning that had not been unfolded yet the first time.
      if (html.length > entry.html.length) {
        entry.html = html;
        entry.text = text;
      }
      if (thinkingHtml && thinkingHtml.length > (entry.thinkingHtml || '').length) {
        entry.thinkingHtml = thinkingHtml;
      }
      entry.y = y;
      entry.el = positionEl;
      entry.sig = showing(positionEl);
      entryOf.set(positionEl, entry);
      return;
    }

    entry = {
      key,
      role,
      html,
      text,
      thinkingHtml,
      y,
      order: entries.length,
      el: positionEl,
      sig: showing(positionEl),
      inNavigation: MATCH.inNavigation(positionEl),
    };
    entries.push(entry);
    byKey.set(key, [...(byKey.get(key) || []), entry]);
    entryOf.set(positionEl, entry);
  }

  function harvestOnce(scroller) {
    const messages = currentMessages();
    // "Leave out" areas, found once per pass rather than once per message.
    const leaveOut = RULES ? MATCH.queryAll(partOf('exclude')).elements : [];

    messages.forEach((message, i) => {
      const turn = message.el;
      const currentLength = turn.textContent.length;
      if (harvestedAt.get(turn) === currentLength) return;
      harvestedAt.set(turn, currentLength);

      const dropped = [
        ...message.cuts,
        ...leaveOut.filter((area) => area !== turn && turn.contains(area)),
      ];
      for (const node of dropped) node.setAttribute(DROP_ATTR, '1');
      const typed = markTypedLines(turn);
      try {
        // Capture reasoning first and tag the originals, so the content clone
        // taken next can have them removed wherever they happened to live.
        const thinkingNodes = thinkingNodesIn(turn);
        let thinkingHtml = '';
        for (const node of thinkingNodes) {
          const clone = cleanClone(node);
          for (const summary of qsa(clone, 'summary')) summary.remove();
          thinkingHtml += clone.innerHTML;
          node.setAttribute(THINK_ATTR, '1');
        }

        const parts = message.role === null ? splitExchange(turn) : null;
        if (parts) {
          // Reasoning belongs to the answer, not to the question that prompted it.
          const assistantPart = parts.find((part) => part.role === 'assistant');
          for (const part of parts) {
            const wrapper = document.createElement('div');
            for (const node of part.nodes) wrapper.appendChild(node.cloneNode(true));
            record(
              wrapper,
              part.role,
              part === assistantPart ? thinkingHtml : '',
              part.nodes[0],
              scroller
            );
          }
        } else {
          const role = message.role || MATCH.roleOf(turn, i, OPTIONS);
          const position = message.cuts.length ? firstContentElement(turn) : turn;
          record(contentNodeFor(turn), role, thinkingHtml, position, scroller);
        }

        for (const node of thinkingNodes) node.removeAttribute(THINK_ATTR);
      } finally {
        for (const node of dropped) node.removeAttribute(DROP_ATTR);
        for (const node of typed) node.removeAttribute(LINES_ATTR);
      }
    });
  }

  /**
   * Identity of what is currently rendered, used to detect re-renders.
   *
   * Deliberately textContent, never innerText: innerText forces a synchronous
   * reflow, and this is called repeatedly for every scroll step. On a long
   * conversation that single detail dominated the reading time.
   */
  function renderSignature(turns) {
    const list = turns || currentMessages();
    const first = list[0] && list[0].el;
    const last = list.length ? list[list.length - 1].el : null;
    const tag = (el) => (el ? el.textContent.length + ':' + el.textContent.slice(0, 24) : '');
    return `${list.length}|${tag(first)}|${tag(last)}`;
  }

  /**
   * Waits for the page to finish reacting to a scroll.
   *
   * This used to poll on a fixed budget, waiting for the rendered content to
   * *change*. That was slow in the common case for a subtle reason: on a page
   * that renders the whole conversation up front, nothing ever changes, so
   * every single step waited out its entire budget for a change that was never
   * coming. A MutationObserver inverts it — resolve as soon as the DOM goes
   * quiet, and only fall back to the ceiling when the page really is busy.
   */
  /** How long to wait for a re-render that may never come. */
  const changeBudget = () => Math.max(200, Math.min(900, (CONFIG.settleMs || 450) * 1.5));

  function waitForQuiet(scroller, opts = {}) {
    const quietMs = opts.quietMs || 90;
    const maxMs = opts.maxMs || Math.max(400, CONFIG.settleMs || 450);
    // When a re-render is expected — every step of a virtualised scroll — the
    // quiet countdown must not start until something has actually changed.
    // Otherwise this returns during the gap between setting scrollTop and the
    // scroll event being dispatched, and the caller reads a stale DOM.
    const expectChange = Boolean(opts.expectChange);
    const target = isWindowScroller(scroller) ? document.body : scroller;

    return new Promise((resolve) => {
      let quietTimer = null;
      let done = false;
      let observer = null;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(quietTimer);
        clearTimeout(ceiling);
        if (observer) observer.disconnect();
        resolve();
      };
      const bump = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      };

      const ceiling = setTimeout(finish, maxMs);
      try {
        observer = new MutationObserver(bump);
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      } catch {
        finish();
        return;
      }
      if (!expectChange) bump();
    });
  }

  /**
   * Coverage check. After the main pass, look for vertical gaps between the
   * turns we captured that are large enough to hide a message, then go back and
   * re-read those positions. This is what turns "scrolled the page" into
   * "actually got everything" when a virtualiser skipped ahead of us.
   */
  async function fillGaps(scroller) {
    const viewportHeight = viewport(scroller);
    let fruitlessRounds = 0;

    for (let round = 0; round < 6; round++) {
      if (outOfTime()) return;
      const positions = entries.map((r) => r.y).sort((a, b) => a - b);
      if (!positions.length) return;

      // Judge a gap against the typical distance between messages rather than
      // against the viewport. A single missing message is usually shorter than
      // a viewport, so a viewport-sized threshold steps straight over exactly
      // the case worth catching.
      const deltas = [];
      for (let i = 1; i < positions.length; i++) deltas.push(positions[i] - positions[i - 1]);
      deltas.sort((a, b) => a - b);
      const typical = deltas.length ? deltas[Math.floor(deltas.length / 2)] : viewportHeight;
      const threshold = Math.max(120, Math.min(viewportHeight, typical * 1.5));

      const total = scrollHeight(scroller);
      const gaps = [];
      let previous = 0;
      for (const y of positions) {
        if (y - previous > threshold) gaps.push((previous + y) / 2);
        previous = Math.max(previous, y);
      }
      if (total - previous > threshold) gaps.push((previous + total) / 2);
      if (!gaps.length) return;

      const before = entries.length;
      for (const gap of gaps.slice(0, 12)) {
        if (outOfTime()) return;
        scrollTo(scroller, Math.max(0, gap - viewportHeight / 2));
        // Targeted repair, so it is worth waiting considerably longer here than
        // during the main sweep.
        await waitForQuiet(scroller, { expectChange: true, maxMs: Math.max(700, changeBudget()) });
        harvestOnce(scroller);
      }
      if (CONFIG.debug) note(`gap round ${round + 1}: probed ${gaps.length}, seen ${before} -> ${entries.length}`);

      // A gap that yields nothing may be genuine (one very long message), or a
      // virtualiser that simply had not caught up. Give it a second chance
      // before concluding the conversation is fully captured.
      if (entries.length === before) {
        if (++fruitlessRounds >= 2) return;
      } else {
        fruitlessRounds = 0;
      }
    }
  }

  /**
   * Pulls in history that only loads when you scroll back.
   *
   * Infinite-scroll chats hold just the recent part of a conversation and fetch
   * older messages when the top comes into view. Without this the earliest part
   * of a long chat is simply never in the page to be read.
   *
   * The first attempt is cheap, so a page with nothing more to load barely pays
   * for it; the loop only continues while the page actually grows.
   */
  async function loadOlderMessages(scroller) {
    let previousHeight = scrollHeight(scroller);
    for (let attempt = 0; attempt < 15; attempt++) {
      if (outOfTime()) return;
      scrollTo(scroller, 0);
      await waitForQuiet(scroller, { quietMs: 90, maxMs: attempt === 0 ? 250 : changeBudget() });

      const height = scrollHeight(scroller);
      if (height <= previousHeight) {
        if (attempt > 0) note(`Loaded ${attempt} page(s) of older messages.`);
        return;
      }
      previousHeight = height;
      harvestOnce(scroller);
    }
    note('Still loading older messages when the ceiling was reached; the start of the chat may be missing.');
  }

  /**
   * Reads the whole conversation.
   *
   * The expensive strategy — scroll a viewport at a time and harvest at every
   * step — only exists because long chats are *virtualised*: off-screen turns
   * are deleted from the DOM, so a single read sees only a window of the
   * conversation. Plenty of pages do not do that, and for those the scroll pass
   * is pure waste. So probe first, and only pay for the slow path when the page
   * actually recycles content.
   */
  async function scrollAndHarvest() {
    const scroller = findScrollEl();
    // Most of a viewport per step: still overlapping, so a turn straddling a
    // boundary is seen whole at least once, but far fewer steps than half.
    const step = Math.max(200, Math.floor(viewport(scroller) * 0.85));
    if (CONFIG.debug) {
      note(`scroller=${scroller.tagName}#${scroller.id || ''} viewport=${viewport(scroller)} step=${step} height=${scrollHeight(scroller)}`);
    }

    scrollTo(scroller, 0);
    await waitForQuiet(scroller);
    await loadOlderMessages(scroller);
    await expandAll();

    const initial = currentMessages();
    const anchor = initial.length ? initial[0].el : null;
    const initialCount = initial.length;
    const initialLast = initial.length ? initial[initial.length - 1].el.textContent.slice(0, 60) : '';
    harvestOnce(scroller);

    /* ---- probe: does this page recycle its messages? ---- */
    scrollTo(scroller, scrollHeight(scroller));

    // Any of three things proves the page re-rendered: the first turn was
    // dropped, the number of turns changed, or the last turn is different
    // content. Checking all three matters because which one fires depends on
    // how the site virtualises — and polling means a recycling page is spotted
    // the instant it happens, while only a page that truly renders everything
    // pays the whole deadline, once, rather than on every step.
    const rerendered = () => {
      if (anchor && !document.contains(anchor)) return true;
      const now = currentMessages();
      if (now.length !== initialCount) return true;
      const last = now.length ? now[now.length - 1].el.textContent.slice(0, 60) : '';
      return last !== initialLast;
    };

    const deadline = Date.now() + Math.max(1200, (CONFIG.settleMs || 450) * 2);
    let recycles = false;
    while (Date.now() < deadline) {
      if (rerendered()) {
        recycles = true;
        break;
      }
      await sleep(60);
    }
    if (!anchor) recycles = true;
    await waitForQuiet(scroller, { quietMs: 120, maxMs: 400 });
    await expandAll();

    if (!recycles) {
      // Everything is in the page at once, so one harvest gets the lot.
      harvestOnce(scroller);

      // Some pages still append lazily when you reach the end; keep nudging
      // the bottom until nothing new arrives.
      for (let i = 0; i < 5; i++) {
        const before = entries.length;
        scrollTo(scroller, scrollHeight(scroller));
        await waitForQuiet(scroller);
        harvestOnce(scroller);
        if (entries.length === before) break;
        await expandAll();
      }

      // Safety net for a misjudged probe: this looks for vertical gaps between
      // what was captured and re-reads them, so a page that does recycle after
      // all still comes out complete rather than silently short.
      const beforeRepair = entries.length;
      await fillGaps(scroller);

      if (entries.length > beforeRepair) {
        // The probe was wrong: finding more content by jumping around proves
        // the page does recycle after all. Fall through to the full pass rather
        // than trusting a conclusion the evidence has just contradicted.
        note(`Gap check found ${entries.length - beforeRepair} more turn(s); the page does recycle, reading it properly.`);
      } else {
        scrollTo(scroller, 0);
        note(`Page keeps every message in the DOM — read ${entries.length} turns without a full scroll pass.`);
        return scroller;
      }
    }

    /* ---- slow path: the page recycles, so harvest as we go ---- */
    note('Page recycles off-screen messages; scrolling the whole conversation.');
    scrollTo(scroller, 0);
    await waitForQuiet(scroller);
    harvestOnce(scroller);

    let y = 0;
    let guard = 0;
    let lastHeight = -1;
    let stableHeightPasses = 0;

    while (guard++ < CONFIG.maxScrollSteps) {
      if (outOfTime()) break;
      const height = scrollHeight(scroller);
      y = Math.min(y + step, height);
      scrollTo(scroller, y);
      await waitForQuiet(scroller, { expectChange: true, maxMs: changeBudget() });
      harvestOnce(scroller);

      if (CONFIG.debug) {
        note(`step ${guard}: asked y=${y} got ${scrollTop(scroller)} turns=${currentMessages().length} seen=${entries.length}`);
      }

      const atBottom = scrollTop(scroller) + viewport(scroller) >= height - 4;
      if (height === lastHeight) stableHeightPasses++;
      else stableHeightPasses = 0;
      lastHeight = height;

      // Some UIs lazily append on reaching the bottom; give them a few tries.
      if (atBottom && stableHeightPasses >= 2) break;
    }
    if (guard >= CONFIG.maxScrollSteps) {
      note('Hit the scroll-step ceiling; a very long chat may be truncated.');
    }
    if (hitDeadline) {
      note('Reading took too long and was stopped early; some messages may be missing. Raise the time limit or the scroll settle and read again.');
    }

    await expandAll();
    harvestOnce(scroller);
    await fillGaps(scroller);
    scrollTo(scroller, 0);
    note(`Scrolled ${guard} step(s) over ${lastHeight}px; captured ${entries.length} turns.`);
    return scroller;
  }

  /* --------------------------------------------------------- image inlining */

  /**
   * Share links hand out signed CDN URLs that expire, so an export that merely
   * references them rots. Fetch inside the page (where the session cookies are)
   * and inline as data URIs.
   */
  async function inlineImages(messages) {
    if (!CONFIG.embedImages) return { count: 0, bytes: 0, failed: 0 };
    const cache = new Map();
    let bytes = 0;
    let count = 0;
    let failed = 0;

    async function toDataUrl(url) {
      if (cache.has(url)) return cache.get(url);

      // The browser extension supplies its own fetcher: a content script's
      // fetch is bound by the page's CORS rules, so cross-origin CDN images
      // fail there, while the extension background can fetch them under its
      // host permissions. The desktop app has no such restriction and leaves
      // this unset, falling through to a direct fetch.
      if (typeof CONFIG.fetchAsDataUrl === 'function') {
        let external = null;
        try {
          external = await CONFIG.fetchAsDataUrl(url);
        } catch {
          external = null;
        }
        cache.set(url, external);
        if (external) bytes += Math.ceil((external.length * 3) / 4);
        return external;
      }

      let result = null;
      try {
        const res = await fetch(url, { credentials: 'include', mode: 'cors' });
        if (res.ok) {
          const blob = await res.blob();
          if (blob.size <= CONFIG.maxImageBytes && bytes + blob.size <= CONFIG.maxTotalImageBytes) {
            result = await new Promise((resolve, reject) => {
              const fr = new FileReader();
              fr.onload = () => resolve(fr.result);
              fr.onerror = reject;
              fr.readAsDataURL(blob);
            });
            bytes += blob.size;
          }
        }
      } catch {
        result = null;
      }
      cache.set(url, result);
      return result;
    }

    const holder = document.createElement('div');
    for (const msg of messages) {
      holder.innerHTML = msg.html;
      const imgs = Array.from(holder.querySelectorAll('img[src]'));
      for (const img of imgs) {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:')) continue;
        const data = await toDataUrl(src);
        if (data) {
          img.setAttribute('data-original-src', src);
          img.setAttribute('src', data);
          count++;
        } else {
          failed++;
        }
      }
      msg.html = holder.innerHTML;
    }
    if (count || failed) note(`Inlined ${count} image(s), ${failed} could not be fetched.`);
    return { count, bytes, failed };
  }

  /* ------------------------------------------------------------------ title */

  // Product names sites put around a conversation's title in the browser tab.
  const PRODUCT_NAMES = [
    'ChatGPT', 'Claude', 'Gemini', 'Google Gemini', 'DeepSeek', 'Grok', 'Copilot',
    'Microsoft Copilot', 'Perplexity', 'Poe', 'Qwen', 'Le Chat', 'Mistral', 'Kimi', 'GapGPT',
  ];
  let titleFromRules = false;

  function siteNames() {
    const host = location.hostname.replace(/^www\./, '');
    return [...PRODUCT_NAMES, RULES && RULES.name, location.hostname, host].filter(Boolean);
  }

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** "Trip ideas - ChatGPT" and "ChatGPT | Trip ideas" both become "Trip ideas". */
  function withoutSiteName(text) {
    if (!text) return '';
    const names = siteNames().map(escapeRegex).join('|');
    return text
      .replace(new RegExp(`^(?:${names})\\s*[-|–—:·•]\\s*`, 'i'), '')
      .replace(new RegExp(`\\s*[-|–—:·•]\\s*(?:${names})$`, 'i'), '')
      .trim();
  }

  /** A real title: not empty, not huge, and not just the site's own name. */
  function sensibleTitle(text) {
    if (!text || text.length < 2 || text.length > 200) return false;
    const lower = text.toLowerCase();
    if (siteNames().some((name) => name.toLowerCase() === lower)) return false;
    return !/^(new chat|untitled( chat)?|chat|home)$/i.test(text);
  }

  /** An element's words without its buttons, icons and screen-reader labels. */
  function wordsOf(el) {
    const copy = el.cloneNode(true);
    for (const node of qsa(copy, 'button, svg, [aria-hidden="true"], .sr-only')) node.remove();
    return norm(copy.textContent);
  }

  /**
   * The link to this very chat in the site's list of chats. That list shows the
   * name the site gave the conversation — the one you see in its sidebar.
   */
  function titleFromChatList() {
    const here = location.pathname.replace(/\/+$/, '');
    if (!here) return '';
    for (const link of qsa(document, 'a[href]')) {
      let target;
      try {
        target = new URL(link.getAttribute('href'), location.href);
      } catch {
        continue;
      }
      // Scheme and host rather than "origin", which is opaque for some pages.
      if (target.protocol !== location.protocol || target.host !== location.host) continue;
      if (target.pathname.replace(/\/+$/, '') !== here) continue;
      const text = withoutSiteName(wordsOf(link));
      if (sensibleTitle(text)) return text;
    }
    return '';
  }

  /**
   * The conversation's title, as the site named it.
   *
   * In order: what the rules point at; the chat's own entry in the site's list
   * of chats; the browser tab's title without the site's name; a main heading
   * outside the menus; and failing all of those, the opening words of the
   * first message you sent — anything but a meaningless id.
   */
  function findTitle() {
    // Older rules carried a bare "h1" or "title"; those are what the steps
    // below already do, more carefully, so only a specific selector counts.
    for (const selector of partOf('title').filter((s) => !/^\s*(h1|title)\s*$/i.test(s))) {
      for (const el of qsa(document, selector)) {
        const text = withoutSiteName(wordsOf(el));
        if (sensibleTitle(text)) {
          titleFromRules = true;
          return text;
        }
      }
    }
    const listed = titleFromChatList();
    if (listed) return listed;
    const tab = withoutSiteName(norm(document.title));
    if (sensibleTitle(tab)) return tab;
    for (const heading of qsa(document, 'h1')) {
      if (MATCH.inNavigation(heading)) continue;
      const text = withoutSiteName(wordsOf(heading));
      if (sensibleTitle(text)) return text;
    }
    const first = entries
      .slice()
      .sort((a, b) => (a.y - b.y) || (a.order - b.order))
      .find((entry) => entry.role === 'user' && entry.text);
    if (first) {
      const words = first.text.split(/\s+/).slice(0, 10).join(' ');
      return words.length > 80 ? `${words.slice(0, 80).trim()}…` : words;
    }
    return 'Untitled chat';
  }

  /* ----------------------------------------------------------------- health */

  /**
   * How well the rules — or the guess — did on this page.
   *
   * This is what lets a read say "the AI-replies rule found nothing" instead of
   * quietly exporting half a conversation. Errors mean the result should not be
   * trusted; warnings mean it is probably usable but worth a look.
   */
  function assessHealth(messages) {
    const counts = { user: 0, assistant: 0, other: 0, total: messages.length };
    for (const m of messages) {
      if (m.role === 'user') counts.user++;
      else if (m.role === 'assistant') counts.assistant++;
      else counts.other++;
    }

    const problems = [];
    if (RULES) {
      for (const part of ['user', 'assistant', 'message']) {
        if (partOf(part).length && !partFound[part]) {
          problems.push({ code: 'part-empty', part, severity: messages.length ? 'warn' : 'error' });
        }
      }
      if (invalidSelectors.size) problems.push({ code: 'invalid-selector', severity: 'warn' });
    }
    if (!messages.length) {
      problems.push({ code: 'no-messages', severity: 'error' });
    } else if (counts.total >= 2 && (!counts.user || !counts.assistant)) {
      problems.push({ code: 'one-speaker', part: counts.user ? 'assistant' : 'user', severity: 'warn' });
    }
    const navigation = entries.filter((e) => e.inNavigation).length;
    if (messages.length && navigation) {
      problems.push({
        code: 'in-navigation',
        severity: navigation / messages.length >= 0.5 ? 'error' : 'warn',
      });
    }

    const status = problems.some((p) => p.severity === 'error')
      ? 'broken'
      : problems.length
        ? 'warn'
        : 'ok';
    return {
      status,
      counts,
      parts: {
        user: partKept.user || 0,
        assistant: partKept.assistant || 0,
        message: partKept.message || 0,
        thinking: messages.filter((m) => m.thinkingHtml).length,
        body: bodyCount,
        title: titleFromRules ? 1 : 0,
      },
      found: { ...partFound },
      problems,
    };
  }

  /* ------------------------------------------------------------------- main */

  function describe() {
    return {
      url: location.href,
      host: location.hostname,
      source: RULES ? 'rules' : 'guess',
      rules: RULES ? { id: RULES.id, name: RULES.name, origin: RULES.origin } : null,
      providerId: RULES ? RULES.providerId || RULES.id : 'unknown',
      providerName: RULES ? RULES.name : location.hostname,
    };
  }

  async function run() {
    const started = Date.now();
    startedAt = started;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch {
      /* ignore */
    }

    const waitMs = CONFIG.waitForMessagesMs ?? (RULES ? 8000 : 3000);
    const appeared = await waitForMessages(waitMs);
    if (RULES && !appeared) {
      note(`The rules for ${RULES.name} found no messages on this page.`);
      return {
        ok: false,
        reason: 'rules-found-nothing',
        message: `The rules for ${RULES.name} found no messages on this page.`,
        ...describe(),
        health: assessHealth([]),
        messages: [],
        log,
      };
    }

    await scrollAndHarvest();

    const messages = entries
      .slice()
      .sort((a, b) => (a.y - b.y) || (a.order - b.order))
      .map((m, i) => ({
        index: i,
        role: m.role,
        html: m.html,
        text: m.text,
        thinkingHtml: m.thinkingHtml,
      }));

    const images = await inlineImages(messages);
    // Before the health report, which records whether the title rule found it.
    const title = findTitle();
    const health = assessHealth(messages);

    return {
      ok: messages.length > 0,
      ...(messages.length
        ? {}
        : {
          reason: RULES ? 'rules-found-nothing' : 'nothing-found',
          message: RULES
            ? `The rules for ${RULES.name} found no messages on this page.`
            : 'No messages were found on this page.',
        }),
      ...describe(),
      health,
      title,
      capturedAt: new Date().toISOString(),
      messages,
      stats: {
        messages: messages.length,
        characters: messages.reduce((a, m) => a + m.text.length, 0),
        images: images.count,
        imagesFailed: images.failed,
        elapsedMs: Date.now() - started,
        stoppedEarly: hitDeadline,
      },
      log,
    };
  }

  return run().catch((err) => ({
    ok: false,
    error: String((err && err.stack) || err),
    log,
  }));
}

// Present under a bundler, absent in a plain web page — see the header comment.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createExtractor: __aceCreateExtractor };
}
