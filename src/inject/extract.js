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
 */
function __aceCreateExtractor(CONFIG) {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];
  const note = (msg) => log.push(msg);

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

  /* ------------------------------------------------------- scroll handling */

  /**
   * Chat UIs scroll either the window or an inner pane. Find whichever one
   * actually owns the overflow, since we have to drive it to force virtualised
   * message lists to render.
   */
  function findScrollEl() {
    if (CONFIG.pack.scrollSelector) {
      const el = document.querySelector(CONFIG.pack.scrollSelector);
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

  /**
   * Unfold collapsed reasoning blocks, "show more" clamps and <details>.
   * Done repeatedly because expanding one block often reveals another.
   */
  async function expandAll() {
    const selectors = [...(CONFIG.pack.expandSelectors || []), ...CONFIG.commonExpand];
    let clicked = 0;
    for (let pass = 0; pass < 3; pass++) {
      let clickedThisPass = 0;
      for (const sel of selectors) {
        for (const el of qsa(document, sel)) {
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

  /**
   * Fallback for sites we have no pack for: score candidate containers and pick
   * the one whose children look most like a message list.
   */
  let heuristicChoice = null;

  function heuristicTurns() {
    // Re-deriving this on every call meant re-scoring every container in the
    // document for each scroll step. Decide once, then reuse the decision.
    if (heuristicChoice) {
      if (heuristicChoice.selector) {
        const found = qsa(document, heuristicChoice.selector).filter((el) => el.textContent.trim().length > 1);
        if (found.length >= 2) return found;
      } else if (heuristicChoice.container && document.contains(heuristicChoice.container)) {
        const kids = Array.from(heuristicChoice.container.children)
          .filter((k) => k.textContent.trim().length > 20);
        if (kids.length >= 2) return kids;
      }
      heuristicChoice = null; // the page changed shape; decide again
    }

    const generic = [
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
    for (const sel of generic) {
      const found = qsa(document, sel).filter((el) => el.textContent.trim().length > 1);
      if (found.length >= 2) {
        note(`Heuristic matched generic selector: ${sel}`);
        heuristicChoice = { selector: sel };
        return found;
      }
    }

    // Nothing recognisable — find the container holding most of the page text
    // whose direct children split that text into several sizeable chunks.
    let best = null;
    let bestContainer = null;
    let bestScore = 0;
    const bodyLen = document.body.textContent.trim().length || 1;
    for (const el of document.querySelectorAll('main, div, section, article, ul, ol')) {
      const kids = Array.from(el.children).filter((k) => k.textContent.trim().length > 20);
      if (kids.length < 2 || kids.length > 400) continue;
      const len = el.textContent.trim().length;
      const share = len / bodyLen;
      if (share < 0.35) continue;
      // Favour many similarly sized children and a high share of page text.
      const sizes = kids.map((k) => k.textContent.trim().length);
      const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const variance =
        sizes.reduce((a, b) => a + (b - mean) ** 2, 0) / sizes.length / (mean * mean || 1);
      const score = share * Math.log(1 + kids.length) * (1 / (1 + variance));
      if (score > bestScore) {
        bestScore = score;
        best = kids;
        bestContainer = el;
      }
    }
    if (best) {
      note(`Heuristic picked a ${best.length}-child container by text layout.`);
      heuristicChoice = { container: bestContainer };
    }
    return best || [];
  }

  function findTurns() {
    const sel = CONFIG.pack.turnSelector;
    if (sel) {
      const found = qsa(document, sel).filter((el) => el.textContent.trim().length > 0);
      // Drop turns nested inside another turn so we don't emit duplicates.
      const top = found.filter((el) => !found.some((o) => o !== el && o.contains(el)));
      if (top.length) return top;
      note('Pack selector matched nothing; falling back to heuristic.');
    }
    return heuristicTurns();
  }

  /* -------------------------------------------------------- role detection */

  function roleOf(el, index) {
    const pack = CONFIG.pack;
    if (pack.roleAttr) {
      const raw = el.getAttribute(pack.roleAttr) || el.querySelector?.(`[${pack.roleAttr}]`)?.getAttribute(pack.roleAttr);
      if (raw) {
        const mapped = (pack.roleMap && pack.roleMap[raw]) || raw;
        if (/user|human/i.test(mapped)) return 'user';
        if (/assistant|model|bot|ai/i.test(mapped)) return 'assistant';
        if (/system|tool/i.test(mapped)) return mapped.toLowerCase();
      }
    }
    if (matches(el, pack.userSelector)) return 'user';
    if (matches(el, pack.assistantSelector)) return 'assistant';
    if (el.querySelector && pack.userSelector && el.querySelector(pack.userSelector)) return 'user';
    if (el.querySelector && pack.assistantSelector && el.querySelector(pack.assistantSelector))
      return 'assistant';

    // Structural tells: user turns are usually right-aligned or bubbled.
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
    // Last resort: chats alternate, and turn 0 is nearly always the human.
    return index % 2 === 0 ? 'user' : 'assistant';
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
    const strip = [...(CONFIG.pack.stripSelectors || []), ...CONFIG.commonStrip];
    for (const sel of strip) {
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

  function contentNodeFor(turn) {
    const sel = CONFIG.pack.contentSelector;
    if (!sel) return turn;

    const nodes = qsa(turn, sel);
    if (!nodes.length) return turn;

    // A content selector names the text of a message — ".markdown", ".prose"
    // and so on. Attachments do not live inside it: a screenshot added to a
    // question sits in its own element beside the text. Narrowing to the
    // selector alone therefore drops every picture the user attached.
    const loose = qsa(turn, MEDIA_SELECTOR).filter(
      (node) => !nodes.some((content) => content === node || content.contains(node))
    );
    // Keep only the outermost of any nesting (figure > picture > img).
    const attachments = loose.filter(
      (node) => !loose.some((other) => other !== node && other.contains(node))
    );

    if (nodes.length === 1 && !attachments.length) return nodes[0];

    // Reassemble in the order they appear on the page, so an image above the
    // text does not end up below it.
    const ordered = [...nodes, ...attachments].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );

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

  const seen = new Map();
  // Element -> text length when it was last harvested. Cloning and cleaning a
  // turn is the single most expensive thing here, and on the slow path the same
  // turns stay on screen across many scroll steps; skip the ones that have not
  // changed since we read them.
  const harvestedAt = new WeakMap();
  const THINK_ATTR = 'data-ace-thinking';

  /**
   * Reasoning blocks are not reliably inside the content selector — on several
   * providers they sit as a sibling of the message body, so searching only the
   * cleaned content silently loses them. Search the whole turn instead.
   */
  function thinkingNodesIn(turn) {
    const sel = CONFIG.pack.thinkingSelector;
    const found = sel ? qsa(turn, sel) : [];
    if (found.length) return found;
    return qsa(turn, 'details').filter((d) => {
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
   * So when a pack names a marker for the assistant half, walk down to the level
   * where the halves are siblings and group the children around it.
   *
   * @returns {{role: string, nodes: Element[]}[]|null} null when this element is
   *   an ordinary single-speaker turn.
   */
  function splitExchange(turn) {
    const marker = CONFIG.pack.exchangeAssistantSelector;
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

  /** Cleans one message and files it, deduping against what is already seen. */
  function record(node, role, thinkingHtml, positionEl, scroller) {
    const cleaned = cleanClone(node);
    for (const tagged of qsa(cleaned, `[${THINK_ATTR}]`)) tagged.remove();

    const text = norm(cleaned.innerText || cleaned.textContent);

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
    const entry = {
      role,
      html,
      text,
      thinkingHtml,
      y: absoluteY(positionEl, scroller),
      order: seen.size,
    };
    const previous = seen.get(key);
    // A later pass may catch a more fully rendered version of the same turn.
    if (!previous || html.length > previous.html.length) {
      seen.set(key, previous ? { ...entry, order: previous.order } : entry);
    }
  }

  function harvestOnce(scroller) {
    const turns = findTurns();
    turns.forEach((turn, i) => {
      const currentLength = turn.textContent.length;
      if (harvestedAt.get(turn) === currentLength) return;
      harvestedAt.set(turn, currentLength);

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

      const parts = splitExchange(turn);
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
        record(contentNodeFor(turn), roleOf(turn, i), thinkingHtml, turn, scroller);
      }

      for (const node of thinkingNodes) node.removeAttribute(THINK_ATTR);
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
    const list = turns || findTurns();
    const first = list[0];
    const last = list[list.length - 1];
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
      const positions = Array.from(seen.values()).map((r) => r.y).sort((a, b) => a - b);
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

      const before = seen.size;
      for (const gap of gaps.slice(0, 12)) {
        if (outOfTime()) return;
        const signature = renderSignature();
        scrollTo(scroller, Math.max(0, gap - viewportHeight / 2));
        // Targeted repair, so it is worth waiting considerably longer here than
        // during the main sweep.
        await waitForQuiet(scroller, { expectChange: true, maxMs: Math.max(700, changeBudget()) });
        harvestOnce(scroller);
      }
      if (CONFIG.debug) note(`gap round ${round + 1}: probed ${gaps.length}, seen ${before} -> ${seen.size}`);

      // A gap that yields nothing may be genuine (one very long message), or a
      // virtualiser that simply had not caught up. Give it a second chance
      // before concluding the conversation is fully captured.
      if (seen.size === before) {
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

    const initial = findTurns();
    const anchor = initial[0] || null;
    const initialCount = initial.length;
    const initialLast = initial.length ? initial[initial.length - 1].textContent.slice(0, 60) : '';
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
      const now = findTurns();
      if (now.length !== initialCount) return true;
      const last = now.length ? now[now.length - 1].textContent.slice(0, 60) : '';
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
        const before = seen.size;
        scrollTo(scroller, scrollHeight(scroller));
        await waitForQuiet(scroller);
        harvestOnce(scroller);
        if (seen.size === before) break;
        await expandAll();
      }

      // Safety net for a misjudged probe: this looks for vertical gaps between
      // what was captured and re-reads them, so a page that does recycle after
      // all still comes out complete rather than silently short.
      const beforeRepair = seen.size;
      await fillGaps(scroller);

      if (seen.size > beforeRepair) {
        // The probe was wrong: finding more content by jumping around proves
        // the page does recycle after all. Fall through to the full pass rather
        // than trusting a conclusion the evidence has just contradicted.
        note(`Gap check found ${seen.size - beforeRepair} more turn(s); the page does recycle, reading it properly.`);
      } else {
        scrollTo(scroller, 0);
        note(`Page keeps every message in the DOM — read ${seen.size} turns without a full scroll pass.`);
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
        note(`step ${guard}: asked y=${y} got ${scrollTop(scroller)} turns=${findTurns().length} seen=${seen.size}`);
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
    note(`Scrolled ${guard} step(s) over ${lastHeight}px; captured ${seen.size} turns.`);
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

  function findTitle() {
    for (const sel of (CONFIG.pack.titleSelector || 'h1, title').split(',')) {
      const el = document.querySelector(sel.trim());
      const t = norm(el?.textContent);
      if (t && t.length > 1 && t.length < 200) {
        return t.replace(/\s*[|\-–]\s*(ChatGPT|Claude|Gemini|DeepSeek|Grok|Poe|Perplexity).*$/i, '').trim() || t;
      }
    }
    return norm(document.title) || 'Untitled chat';
  }

  /* ------------------------------------------------------------------- main */

  async function run() {
    const started = Date.now();
    startedAt = started;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
    } catch {
      /* ignore */
    }

    await scrollAndHarvest();

    const messages = Array.from(seen.values())
      .sort((a, b) => (a.y - b.y) || (a.order - b.order))
      .map((m, i) => ({
        index: i,
        role: m.role,
        html: m.html,
        text: m.text,
        thinkingHtml: m.thinkingHtml,
      }));

    const images = await inlineImages(messages);

    return {
      ok: messages.length > 0,
      url: location.href,
      host: location.hostname,
      providerId: CONFIG.pack.id || 'unknown',
      providerName: CONFIG.pack.name || location.hostname,
      usedPack: Boolean(CONFIG.pack.turnSelector),
      title: findTitle(),
      capturedAt: new Date().toISOString(),
      messages,
      stats: {
        messages: messages.length,
        characters: messages.reduce((a, m) => a + m.text.length, 0),
        images: images.count,
        imagesFailed: images.failed,
        elapsedMs: Date.now() - started,
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
