/**
 * Site structure report.
 *
 * Paste this into the browser console while a chat is open, and it prints a
 * compact description of how that site marks up its messages. That is exactly
 * what is needed to write a correct provider pack — and it is not something the
 * exported file reveals, because by then the original structure is gone.
 *
 * Message text is truncated to 40 characters, so the report describes the shape
 * of the page rather than the content of your conversation. Read it before
 * sending it anywhere.
 *
 *   1. Open the chat.
 *   2. Press F12, open the Console tab.
 *   3. Paste this whole file, press Enter.
 *   4. Right-click the result -> Copy object, or copy the printed text.
 */
(() => {
  const short = (s, n = 40) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const attrs = (el) =>
    Array.from(el.attributes)
      .filter((a) => a.name === 'class' || a.name.startsWith('data-') || a.name === 'role')
      .map((a) => `${a.name}="${a.value.slice(0, 90)}"`)
      .join(' ');

  // The selectors the extension itself tries, so the report says which of them
  // this site actually responds to.
  const candidates = [
    '[data-message-author-role]',
    '[data-testid*="message"]',
    '[data-message-id]',
    '[data-role]',
    '[class*="message-row"]',
    '[class*="ChatMessage"]',
    '[class*="chat-message"]',
    '[class*="message-bubble"]',
    '[class*="message-render"]',
    '.chat-user',
    '.chat-assistant',
    '.message',
    '[role="listitem"]',
    '[class*="markdown"]',
    '[class*="prose"]',
  ];

  const selectorHits = {};
  for (const sel of candidates) {
    try {
      const n = document.querySelectorAll(sel).length;
      if (n) selectorHits[sel] = n;
    } catch {
      /* invalid selector on this engine */
    }
  }

  // Find the element that actually scrolls: virtualised lists hang off it.
  let scroller = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll('div, main, section')) {
    const style = getComputedStyle(el);
    if (!/auto|scroll|overlay/.test(style.overflowY)) continue;
    if (el.scrollHeight <= el.clientHeight + 40) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > bestArea) {
      bestArea = r.width * r.height;
      scroller = el;
    }
  }

  // Guess where the messages are: the deepest container with several sizeable
  // children, then describe those children and their ancestors.
  let best = null;
  let bestScore = 0;
  const bodyLen = document.body.textContent.trim().length || 1;
  for (const el of document.querySelectorAll('main, div, section, ul, ol')) {
    const kids = Array.from(el.children).filter((k) => k.textContent.trim().length > 40);
    if (kids.length < 2 || kids.length > 400) continue;
    const share = el.textContent.trim().length / bodyLen;
    if (share < 0.3) continue;
    const score = share * Math.log(1 + kids.length);
    if (score > bestScore) {
      bestScore = score;
      best = { container: el, kids };
    }
  }

  /**
   * A structural skeleton of one element: tags, classes and key attributes,
   * with text reduced to a length. It says how the page is built without
   * carrying what was said in it.
   */
  function skeleton(el, depth = 0) {
    if (depth > 5) return '…';
    const own = `${el.tagName.toLowerCase()}[${attrs(el) || ''}]`;
    const kids = Array.from(el.children).slice(0, 6);
    if (!kids.length) {
      const media = el.matches('img, video, canvas, picture, source, audio');
      const detail = media
        ? ` src=${describeSrc(el)}${el.alt ? ` alt="${short(el.alt, 30)}"` : ''}`
        : ` text=${el.textContent.trim().length}ch`;
      return own + detail;
    }
    return { node: own, children: kids.map((k) => skeleton(k, depth + 1)) };
  }

  /** Reports the kind of a media source, never the signed URL itself. */
  function describeSrc(el) {
    const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
    if (!src) return '(none)';
    if (src.startsWith('data:')) return `data-uri(${src.slice(5, 20)}…, ${src.length}ch)`;
    try {
      return `remote(${new URL(src, location.href).hostname})`;
    } catch {
      return 'remote(unparseable)';
    }
  }

  // Exchanges holding a picture come first: an image reply has no markdown to
  // match on, so its structure is what is needed to handle it.
  const kids = best ? best.kids : [];
  const withMedia = kids.filter((k) => k.querySelector('img, video, canvas, picture'));
  const ordered = [...withMedia, ...kids.filter((k) => !withMedia.includes(k))];

  const sample = ordered.slice(0, 8).map((el, i) => {
    const chain = [];
    let node = el;
    for (let d = 0; d < 3 && node && node !== document.body; d++) {
      chain.push(`${node.tagName.toLowerCase()}[${attrs(node) || 'no class/data attrs'}]`);
      node = node.parentElement;
    }
    const media = Array.from(el.querySelectorAll('img, video, canvas, picture'));
    return {
      i,
      tag: el.tagName.toLowerCase(),
      attrs: attrs(el) || '(none)',
      chars: el.textContent.trim().length,
      preview: short(el.textContent),
      hasMedia: media.length > 0,
      media: media.slice(0, 4).map((m) => ({
        tag: m.tagName.toLowerCase(),
        src: describeSrc(m),
        // What the picture is wrapped in matters: a button or a link around it
        // is chrome that must not be stripped along with the picture.
        wrappedIn: (() => {
          const chain = [];
          let node = m.parentElement;
          for (let d = 0; d < 3 && node && node !== el; d++) {
            chain.push(`${node.tagName.toLowerCase()}[${attrs(node) || ''}]`);
            node = node.parentElement;
          }
          return chain;
        })(),
      })),
      ancestors: chain.slice(1),
      // Full structure for the first picture-bearing exchange only, to keep the
      // report small enough to paste.
      structure: i === 0 && media.length ? skeleton(el) : undefined,
    };
  });

  const report = {
    url: location.href.replace(/\/[0-9a-f-]{8,}/gi, '/<id>'),
    host: location.hostname,
    title: short(document.title, 80),
    scroller: scroller
      ? `${scroller.tagName.toLowerCase()}#${scroller.id || ''}.${(scroller.className || '').toString().slice(0, 60)}`
      : '(the window scrolls)',
    selectorHits,
    exchangesWithMedia: withMedia.length,
    likelyContainer: best
      ? `${best.container.tagName.toLowerCase()}[${attrs(best.container) || 'no class/data attrs'}] with ${best.kids.length} children`
      : '(none found)',
    sample,
  };

  console.log('%c=== AI Chat Extractor site report ===', 'font-weight:bold');
  console.log(JSON.stringify(report, null, 2));
  try {
    copy(JSON.stringify(report, null, 2));
    console.log('%cCopied to your clipboard.', 'color:green');
  } catch {
    console.log('Select the JSON above and copy it.');
  }
  return report;
})();
