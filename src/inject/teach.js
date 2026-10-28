/**
 * The teach overlay: a person shows the app which parts of a chat page are
 * which, by pointing at them — no knowledge of how web pages are built needed.
 *
 * Everything the rules find is drawn on the page as coloured, labelled boxes
 * ("You 1", "AI 2"), in the same colours the apps use (src/shared/parts.js).
 * A floating panel lists the parts with live counts, a preview of what a read
 * would produce, and anything that looks wrong. Picking is: choose a part,
 * click it on the page, make the box bigger or smaller until it is right, add.
 *
 * Two modes:
 *   show   draws the current rules and changes nothing
 *   teach  lets the rules be changed, then saves or cancels
 *
 * Resolves with one of:
 *   { ok: true, action: 'save', parts, options, pathPrefix, counts, summary,
 *     saveAs: 'update' | 'new', name, makeDefault }
 *   { ok: true, action: 'close', counts, summary }          (show mode)
 *   { ok: false, cancelled: true }
 *
 * Injected like the extractor — the desktop app places match.js in front of it;
 * the extension imports it as a module. It builds its UI from elements, never
 * from HTML strings: some sites enforce Trusted Types, under which assigning
 * markup throws.
 */
function __aceTeach(OPTIONS) {
  'use strict';

  const M = (typeof __aceMatcher === 'function' ? __aceMatcher : require('./match.js').createMatcher)();
  if (typeof window.__aceTeachClose === 'function') window.__aceTeachClose();

  /* ---------------------------------------------------------------- setup */

  const PARTS = (OPTIONS && OPTIONS.parts) || [];
  const PART = {};
  for (const p of PARTS) PART[p.key] = p;
  const MESSAGE_KEYS = PARTS.filter((p) => p.group === 'message').map((p) => p.key);
  const MAIN_KEYS = PARTS.filter((p) => p.main).map((p) => p.key);
  const MORE_KEYS = PARTS.filter((p) => !p.main).map((p) => p.key);

  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  const original = (OPTIONS && OPTIONS.rules) || null;
  const work = { parts: clone(original && original.parts), options: clone(original && original.options) };
  const siteName = (OPTIONS && OPTIONS.siteName) || location.hostname || 'this page';
  const segments = location.pathname.split('/').filter(Boolean);
  // Narrowing rules to part of a site only makes sense for real web addresses.
  const pagePrefix = /^https?:$/.test(location.protocol) && segments.length >= 2 ? `/${segments[0]}/` : '';

  let mode = OPTIONS && OPTIONS.mode === 'show' ? 'show' : 'teach';
  let pending = null;
  let paused = false;
  let changed = false;
  let guessedNow = false;
  let repairing = false;
  let showMore = MORE_KEYS.some((k) => (work.parts[k] || []).length && k !== 'message');
  let showCss = false;
  let confirmingClose = false;
  let confirmingSave = false;
  let scope = original && original.pathPrefix ? 'page' : 'site';
  // How it is saved, as the app allows: over the person's own rule set this
  // started from, or as a new one; and whether the site is read with it.
  const SAVING = (OPTIONS && OPTIONS.saving) || {};
  let saveAs = SAVING.canUpdate ? 'update' : 'new';
  let newName = SAVING.suggestedName || '';
  let makeDefault = SAVING.makeDefault !== false;
  let focusWay = null;
  let flashText = '';
  let flashTimer = null;
  const history = [];
  let model = { messages: [], items: [], counts: {}, problems: [], found: {}, invalid: [] };

  const ways = (key) => (Array.isArray(work.parts[key]) ? work.parts[key] : []);
  const hasMessageWays = () => MESSAGE_KEYS.some((k) => ways(k).length);
  let active = (OPTIONS && OPTIONS.focus && PART[OPTIONS.focus] && OPTIONS.focus) || 'user';

  /* --------------------------------------------------------------- styles */

  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer { position: fixed; inset: 0; pointer-events: none; }
    .box {
      position: fixed; left: 0; top: 0; pointer-events: none;
      border: 2px solid var(--c); border-radius: 5px; background: var(--fill);
    }
    .box.inside { border-style: dashed; }
    .box.page { border-style: dotted; border-width: 3px; }
    .box.skip { background: repeating-linear-gradient(135deg, var(--fill) 0 7px, transparent 7px 14px); }
    .box.pending { border-width: 3px; animation: ace-pulse 1.1s ease-in-out infinite; }
    .box.hover { border-style: dashed; background: transparent; }
    .box.dim { opacity: .18; }
    .box.focus { border-width: 3px; }
    @keyframes ace-pulse { 50% { box-shadow: 0 0 0 4px var(--fill); } }
    .tag {
      position: absolute; left: -2px; bottom: 100%; margin-bottom: 1px;
      background: var(--c); color: #fff; white-space: nowrap;
      font: 600 11px/18px "Segoe UI", system-ui, sans-serif; padding: 0 6px;
      border-radius: 4px 4px 4px 0; text-shadow: 0 1px 1px rgba(0,0,0,.35);
    }
    .tag.in { bottom: auto; top: 0; margin: 0; border-radius: 0 0 4px 0; }
    /* A part inside a message is labelled at its right, so the speaker's label stays readable. */
    .tag.right { left: auto; right: -2px; border-radius: 4px 4px 0 4px; }
    .tag.in.right { border-radius: 0 0 0 4px; }
    .tag:empty { display: none; }

    .panel {
      position: fixed; right: 16px; bottom: 16px; width: 348px;
      max-height: calc(100vh - 32px); overflow-y: auto; pointer-events: auto;
      background: #151920; color: #e7eaf0; border: 1px solid #2c3442; border-radius: 14px;
      box-shadow: 0 16px 48px rgba(0,0,0,.5);
      font: 13px/1.45 "Segoe UI", system-ui, -apple-system, sans-serif;
    }
    .head {
      display: flex; align-items: center; gap: 8px; padding: 11px 12px 9px 14px;
      border-bottom: 1px solid #262c37; cursor: move; user-select: none;
    }
    .logo { width: 22px; height: 22px; border-radius: 6px; flex: none;
      background: linear-gradient(135deg, #4f9cf9, #8b5cf6); display: grid; place-items: center;
      color: #fff; font: 800 9px/1 system-ui; }
    .title { flex: 1; min-width: 0; }
    .title b { display: block; font-size: 13px; }
    .title small { display: block; color: #98a1b0; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .body { padding: 10px 14px 12px; }
    button { font: inherit; color: inherit; cursor: pointer; }
    .icon { background: none; border: 1px solid transparent; border-radius: 7px; color: #98a1b0;
      width: 28px; height: 28px; display: grid; place-items: center; font-size: 15px; }
    .icon:hover { background: #222833; color: #fff; }
    .chip { background: #1e2430; border: 1px solid #2c3442; border-radius: 999px; padding: 3px 10px; font-size: 11.5px; }
    .chip:hover { border-color: #4a5466; }
    .chip.on { background: #2b2410; border-color: #f59e0b; color: #fcd34d; }

    .say { margin: 0 0 10px; color: #cfd5df; font-size: 12.5px; }
    .say.guess { background: #13261b; border: 1px solid #1f5f3a; border-radius: 9px; padding: 8px 10px; color: #c9f0d6; }
    .say.pause { background: #2b2410; border: 1px solid #6b5313; border-radius: 9px; padding: 8px 10px; color: #fde68a; }
    .flash { margin: 0 0 10px; background: #1c2a44; border: 1px solid #2f4a7a; border-radius: 9px; padding: 7px 10px; font-size: 12px; }

    .parts { display: flex; flex-direction: column; gap: 5px; }
    .part {
      display: flex; align-items: center; gap: 9px; width: 100%; text-align: left;
      background: #1b2029; border: 1px solid #262c37; border-left: 4px solid var(--c);
      border-radius: 9px; padding: 7px 10px;
    }
    .part:hover { border-color: #3a4352; border-left-color: var(--c); }
    .part.active { background: #212836; border-color: var(--c); box-shadow: 0 0 0 1px var(--c) inset; }
    .swatch { width: 14px; height: 14px; border-radius: 4px; background: var(--c); flex: none; }
    .part .name { flex: 1; min-width: 0; }
    .part .name small { display: block; color: #98a1b0; font-size: 11px; }
    .count { font-weight: 700; font-variant-numeric: tabular-nums; }
    .count.zero { color: #f87171; }
    .count.unset { color: #6b7483; font-weight: 400; }
    .more { margin: 7px 0 0; background: none; border: none; color: #8fb8ff; padding: 4px 0; font-size: 12px; }

    .card { margin-top: 10px; background: #11151b; border: 1px solid #262c37; border-radius: 10px; padding: 9px 10px; }
    .card h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: #98a1b0; }
    .card.pending { border-color: var(--c); }
    .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .btn { background: #222833; border: 1px solid #333c4a; border-radius: 8px; padding: 6px 11px; font-size: 12.5px; }
    .btn:hover { background: #2a3240; }
    .btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; font-weight: 600; }
    .btn.primary:hover { background: #1d4ed8; }
    .btn.good { background: #15803d; border-color: #15803d; color: #fff; font-weight: 600; }
    .btn.danger { color: #fca5a5; border-color: #7f1d1d; }
    .btn:disabled { opacity: .45; cursor: default; }
    .way { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 7px; }
    .way:hover { background: #1b2130; }
    .way .n { flex: 1; font-size: 12px; }
    .way code { display: block; color: #9fb3c8; font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
    .mini { background: none; border: none; color: #8fb8ff; font-size: 11.5px; padding: 2px 4px; }
    .mini.x { color: #f87171; font-size: 14px; }
    .hint { color: #98a1b0; font-size: 11.5px; margin: 6px 0 0; }
    .keys { color: #6b7483; font-size: 11px; margin-top: 6px; }
    kbd { background: #222833; border: 1px solid #333c4a; border-bottom-width: 2px; border-radius: 4px; padding: 0 4px; font: 10.5px/1.5 Consolas, monospace; }

    .preview .line { display: flex; gap: 7px; align-items: baseline; font-size: 12px; padding: 2px 0; }
    .preview .who { flex: none; width: 52px; font-weight: 700; color: var(--c); font-size: 11px; }
    .preview .txt { color: #cfd5df; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .summary { font-size: 12.5px; margin-bottom: 4px; }
    .summary b { font-variant-numeric: tabular-nums; }

    .problems { margin-top: 10px; display: flex; flex-direction: column; gap: 5px; }
    .problem { font-size: 12px; border-radius: 8px; padding: 6px 9px; background: #2a1d0b; border: 1px solid #6b4a10; color: #fde68a; }
    .problem.err { background: #2a1111; border-color: #7f1d1d; color: #fecaca; }

    .scope, .saving { margin-top: 10px; font-size: 12px; color: #cfd5df; }
    .scope label, .saving label { display: flex; gap: 7px; align-items: center; padding: 2px 0; cursor: pointer; }
    .saving input[type="text"] {
      width: 100%; box-sizing: border-box; margin: 3px 0 4px; background: #0f1115; color: #e7eaf0;
      border: 1px solid #333c4a; border-radius: 7px; padding: 5px 8px; font: inherit; font-size: 12.5px;
    }
    .saving input[type="text"]:focus { outline: none; border-color: #4f9cf9; }
    .foot { display: flex; gap: 6px; align-items: center; padding: 10px 14px 12px; border-top: 1px solid #262c37; }
    .foot .grow { flex: 1; }
  `;

  /* ---------------------------------------------------------------- ui kit */

  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }

  function button(label, cls, onClick, title) {
    const el = h('button', cls, label);
    el.type = 'button';
    if (title) el.title = title;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      onClick(e);
    });
    return el;
  }

  function colourOf(key) {
    return (PART[key] && PART[key].color) || '#94a3b8';
  }

  function fill(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function paint(el, key, alpha = 0.13) {
    const colour = colourOf(key);
    el.style.setProperty('--c', colour);
    el.style.setProperty('--fill', fill(colour, alpha));
  }

  /* ------------------------------------------------------------ the host */

  const host = document.createElement('div');
  host.id = '__ace_teach__';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'open' });
  try {
    // A constructed stylesheet is not inline style as far as a page's Content
    // Security Policy is concerned, so it works on strict sites too.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(STYLES);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    shadow.appendChild(h('style', '', STYLES));
  }
  const layer = h('div', 'layer');
  const hoverBox = h('div', 'box hover');
  hoverBox.appendChild(h('span', 'tag'));
  hoverBox.style.display = 'none';
  const panel = h('div', 'panel');
  shadow.append(layer, hoverBox, panel);
  document.documentElement.appendChild(host);

  const inOverlay = (e) => typeof e.composedPath === 'function' && e.composedPath().includes(host);

  /* ------------------------------------------------------ choosing selectors */

  /** Attributes that describe one particular element, or its current state. */
  const IGNORED_ATTRIBUTE = new RegExp(
    '^(class|style|id|href|src|srcset|sizes|alt|title|width|height|tabindex|dir|lang|type|name|value|' +
      'placeholder|draggable|contenteditable|spellcheck|translate|autocomplete|autocapitalize|for|target|' +
      'rel|loading|decoding|fetchpriority|crossorigin|referrerpolicy|nonce|integrity|xmlns(:.*)?|on.*|' +
      'aria-(label|labelledby|describedby|description|controls|owns|activedescendant|valuetext|valuenow|' +
      'valuemin|valuemax|placeholder|keyshortcuts|posinset|setsize|level|rowindex|colindex|rowcount|' +
      'colcount|errormessage|details|flowto|expanded|selected|pressed|checked|hidden|busy|current|disabled|' +
      'invalid|modal|haspopup)|data-state|data-headlessui-state|data-v-[0-9a-f]+|data-reactid|data-react.*|' +
      'jsaction|jscontroller|jsmodel|jsname|jslog|jsdata|jsshadow|jsowner|jsrenderer|_ngcontent.*|' +
      '_nghost.*|ng-.*|data-ng-.*|data-ace-.*)$',
    'i'
  );

  /** Utility classes describe how something looks today, not what it is. */
  const UTILITY_CLASS = new RegExp(
    '^(-?(m|p)[trblxyse]?-|w-|h-|min-|max-|size-|gap-|space-|inset-|top-|left-|right-|bottom-|start-|end-|' +
      'z-|order-|col-|row-|basis-|grow|shrink|flex|grid|text-|font-|leading-|tracking-|bg-|from-|via-|to-|' +
      'border|rounded|shadow|opacity-|ring|outline|divide-|translate-|scale-|rotate-|skew-|origin-|' +
      'transition|duration-|ease-|delay-|animate-|cursor-|select-|overflow|overscroll|object-|fill-|' +
      'stroke-|decoration-|underline|line-clamp|truncate|whitespace-|break-|align-|justify-|items-|' +
      'content-|self-|place-|float-|clear|isolate|visible|invisible|static|fixed|absolute|relative|' +
      'sticky|block|inline|hidden|contents|table|list-|aspect-|columns-|box-|container|sr-only|' +
      'not-sr-only|group|peer|dark|light|prose-|d-|clearfix|pull-|hover|focus|active|disabled)',
    'i'
  );

  function stableClass(name) {
    if (!name || name.length > 40) return false;
    if (/[:[\]/!@%.#=()]/.test(name) || /^-?\d/.test(name)) return false;
    if (UTILITY_CLASS.test(name)) return false;
    if (/\d/.test(name) && /^_?[a-z0-9]{5,9}$/i.test(name)) return false; // short hashes
    if (/[a-f0-9]{6,}/i.test(name) && /\d/.test(name)) return false; // hex runs
    if (/^(css|sc|jsx|emotion|svelte|astro|tw|chakra|mui|ng-tns|ng-star)-/i.test(name) && /\d/.test(name)) return false;
    return true;
  }

  const quote = (value) => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

  function matchesCss(el, css) {
    try {
      return el.matches(css);
    } catch {
      return false;
    }
  }

  function valueKind(value) {
    if (value === '') return 'presence';
    if (value.length > 48 || /[{}<>\\]/.test(value)) return 'opaque';
    if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value) || /[0-9a-f]{10,}/i.test(value) || /\d{4,}/.test(value)) return 'opaque';
    if (/^\d+$/.test(value)) return 'opaque';
    if (/^[a-z][\w-]*?[-_:]?\d{1,3}$/i.test(value) && /\d$/.test(value)) return 'numbered';
    if (/\s/.test(value) && value.split(/\s+/).length > 3) return 'text';
    return 'enum';
  }

  /** The stable ways of describing one element, strongest first. */
  function tokensOf(el) {
    const tokens = [];
    const tag = el.localName;
    if (tag.includes('-')) tokens.push({ css: tag, weight: 95 });
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (IGNORED_ATTRIBUTE.test(name) || !/^[a-z][a-z0-9_.:-]*$/i.test(name)) continue;
      const value = attr.value.trim();
      const kind = valueKind(value);
      const speakerish = /role|author|sender|speaker|turn|from|who|kind|type|content/i.test(name);
      if (kind === 'enum') tokens.push({ css: `[${name}=${quote(value)}]`, weight: name === 'role' ? 72 : speakerish ? 104 : 100 });
      else if (kind === 'numbered') {
        const prefix = value.replace(/\d+$/, '');
        if (prefix.length >= 3) tokens.push({ css: `[${name}^=${quote(prefix)}]`, weight: 82 });
        else tokens.push({ css: `[${name}]`, weight: 58 });
      } else if (kind === 'presence' || kind === 'opaque') {
        tokens.push({ css: `[${name}]`, weight: 58 });
      }
    }
    for (const name of Array.from(el.classList)) {
      const module = /^([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9-]+?)__[A-Za-z0-9_-]{4,}$/.exec(name);
      if (module) tokens.push({ css: `[class*=${quote(module[1])}]`, weight: 66 });
      else if (stableClass(name)) tokens.push({ css: `.${CSS.escape(name)}`, weight: 70 });
    }
    return tokens.sort((a, b) => b.weight - a.weight);
  }

  function bestToken(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    if (el.id && /^[A-Za-z][\w-]{2,39}$/.test(el.id) && !/\d{3,}/.test(el.id)) return `#${CSS.escape(el.id)}`;
    const token = tokensOf(el)[0];
    if (!token) return null;
    const tag = el.localName;
    return token.css.startsWith(tag) || tag === 'div' || tag === 'span' ? token.css : tag + token.css;
  }

  /** Every reasonable selector that finds `el`, with how much to trust each. */
  function candidatesFor(el) {
    const tag = el.localName;
    const own = tokensOf(el).slice(0, 8);
    const out = [];
    const seen = new Set();
    const add = (css, weight) => {
      if (!seen.has(css)) {
        seen.add(css);
        out.push({ css, weight });
      }
    };
    const plain = tag === 'div' || tag === 'span';
    for (const t of own) {
      add(t.css, t.weight);
      if (!plain && !t.css.startsWith(tag)) add(tag + t.css, t.weight + 2);
    }
    for (let i = 0; i < Math.min(own.length, 4); i++) {
      for (let j = i + 1; j < Math.min(own.length, 4); j++) {
        add(own[i].css + own[j].css, Math.min(own[i].weight, own[j].weight) + 4);
      }
    }
    const parent = bestToken(el.parentElement);
    if (parent) {
      add(`${parent} > ${tag}`, plain ? 30 : 40);
      for (const t of own.slice(0, 3)) add(`${parent} > ${t.css}`, t.weight - 2);
    }
    let anchorEl = el.parentElement && el.parentElement.parentElement;
    for (let depth = 0; anchorEl && depth < 6; depth++, anchorEl = anchorEl.parentElement) {
      const anchor = bestToken(anchorEl);
      if (!anchor) continue;
      for (const t of own.slice(0, 3)) add(`${anchor} ${t.css}`, t.weight - 4);
      if (!own.length) add(`${anchor} ${tag}`, 18);
      break;
    }
    if (!out.length) add(tag, plain ? 5 : 20);
    return out;
  }

  function query(css) {
    try {
      return Array.from(document.querySelectorAll(css));
    } catch {
      return null;
    }
  }

  function hasNesting(list) {
    const set = new Set(list);
    return list.some((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return true;
      return false;
    });
  }

  const related = (a, b) => a === b || a.contains(b) || b.contains(a);
  function overlapsAny(el, others) {
    if (others.has(el)) return true;
    for (const other of others) if (related(el, other)) return true;
    return false;
  }

  const USER_WORDS = /\b(user|human|you|me|mine|self|query|question|prompt|request|sender|outgoing)\b/i;
  const AI_WORDS = /\b(assistant|bot|ai|model|gpt|claude|gemini|answer|response|reply|incoming)\b/i;

  /** Positive when a selector names the right speaker for the part, negative for the wrong one. */
  function speakerHint(css, key) {
    // Whatever a selector excludes says nothing about what it is: ".b:not(.me)"
    // is the AI's messages precisely because it rules out "me".
    const named = css.replace(/:not\([^)]*\)/g, '');
    const mine = USER_WORDS.test(named);
    const theirs = AI_WORDS.test(named);
    if (key === 'user') return mine && !theirs ? 30 : theirs && !mine ? -45 : 0;
    if (key === 'assistant') return theirs && !mine ? 30 : mine && !theirs ? -45 : 0;
    if (key === 'message') return mine || theirs ? -10 : 0;
    return 0;
  }

  /** Elements other message parts already claim, which a new way should avoid. */
  function claimedByOthers(key) {
    const set = new Set();
    if (PART[key] && PART[key].group === 'message') {
      for (const m of model.messages) if (m.part !== key) set.add(m.el);
    }
    return set;
  }

  function score(candidate, found, key, others) {
    let s = candidate.weight;
    const n = found.length;
    const group = PART[key] ? PART[key].group : '';
    if (n === 1) s -= 20;
    if (n > 300) s -= 40;
    if (hasNesting(found)) s -= 30;
    // Messages and what is inside them never live in a menu. A "leave out"
    // area very often does: leaving out the sidebar is what it is for.
    if (group === 'message' || group === 'inside') {
      const navigation = found.filter((el) => M.inNavigation(el)).length;
      if (navigation) s -= (60 * navigation) / n;
    }
    if (group === 'message') {
      if (others.size) s -= (90 * found.filter((el) => overlapsAny(el, others)).length) / n;
      s += speakerHint(candidate.css, key);
    }
    if (key === 'title' && n > 1) s -= 15;
    return s;
  }

  /**
   * The best selector for `el` as a new way of finding `key`.
   *
   * When the best one also catches boxes another part already has — "your
   * messages" also finding the AI's — try narrowing it with whatever those
   * other boxes carry and this one does not.
   */
  function chooseSelector(el, key) {
    const others = claimedByOthers(key);
    const message = PART[key] && PART[key].group === 'message';
    let best = null;
    const consider = (candidate) => {
      const all = query(candidate.css);
      if (!all || !all.includes(el)) return;
      const found = message ? all.filter((x) => M.hasContent(x)) : all;
      const s = score(candidate, found, key, others);
      if (!best || s > best.score) best = { css: candidate.css, weight: candidate.weight, found, score: s };
    };
    for (const candidate of candidatesFor(el)) consider(candidate);

    if (best && message && others.size) {
      const clash = best.found.filter((x) => overlapsAny(x, others));
      if (clash.length) {
        // Trusted as much as the selector it narrows, less a little for being
        // longer; the clash penalty it no longer pays is what makes it win.
        const base = best;
        const theirs = tokensOf(clash[0]).filter((t) => !matchesCss(el, t.css));
        for (const t of theirs.slice(0, 6)) consider({ css: `${base.css}:not(${t.css})`, weight: base.weight - 3 });
      }
    }
    return best;
  }

  /** The boxes between `el` and the clicked spot, outermost first. */
  function levelsBetween(el, origin, limit) {
    const chain = [];
    for (let node = origin; node && node !== el && chain.length < 12; node = node.parentElement) chain.unshift(node);
    return [el, ...chain.filter((node) => el.contains(node))].slice(0, limit);
  }

  function blockOf(el) {
    let node = el;
    while (
      node && node.parentElement && node !== document.body &&
      /^inline/.test(getComputedStyle(node).display)
    ) {
      node = node.parentElement;
    }
    return node;
  }

  function scrollableAncestor(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/auto|scroll|overlay/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 20) return node;
    }
    return null;
  }

  /** What a click at `target` most likely means, for the part being taught. */
  function snap(target, key) {
    const group = PART[key] ? PART[key].group : 'inside';
    if (group === 'message') {
      const guessed = M.guessedMessageFor(target);
      if (guessed && !M.inNavigation(guessed)) return guessed;
      return blockOf(target);
    }
    if (key === 'scroll') return scrollableAncestor(target) || blockOf(target);
    if (key === 'expand') return target.closest('button, [role="button"], summary, a') || blockOf(target);
    return blockOf(target);
  }

  /* -------------------------------------------------------------- picking */

  function setPending(key, el, origin, levels) {
    let best = null;
    for (const level of levels) {
      const choice = chooseSelector(level, key);
      if (!choice) continue;
      // A small preference for the box the person actually pointed at.
      const s = choice.score + (level === levels[0] ? 4 : 0);
      if (!best || s > best.rank) best = { ...choice, el: level, rank: s };
    }
    if (!best) {
      say('That spot could not be described. Try clicking a little further inside the message.');
      return;
    }
    pending = { part: key, el: best.el, origin, choice: best };
    refreshPanel();
    scheduleDraw();
  }

  function pickAt(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target || target === host || host.contains(target)) return;
    const el = snap(target, active);
    const message = PART[active] && PART[active].group === 'message';
    setPending(active, el, target, message ? levelsBetween(el, target, 6) : [el]);
  }

  function bigger() {
    if (!pending) return;
    const parent = pending.el.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      say('That is already the biggest box.');
      return;
    }
    setPending(pending.part, parent, pending.origin, [parent]);
  }

  function smaller() {
    if (!pending) return;
    const { el, origin } = pending;
    if (el === origin || !el.contains(origin)) {
      say('That is already the smallest box at that spot.');
      return;
    }
    let child = origin;
    while (child.parentElement && child.parentElement !== el) child = child.parentElement;
    setPending(pending.part, child, origin, [child]);
  }

  function acceptPending() {
    if (!pending) return;
    const { part, choice } = pending;
    remember();
    const list = ways(part).slice();
    if (PART[part] && PART[part].single) list.length = 0;
    if (!list.includes(choice.css)) list.push(choice.css);
    work.parts[part] = list;
    pending = null;
    changed = true;
    guessedNow = false;
    // Having taught your messages, the natural next step is the AI's replies.
    if (part === 'user' && !ways('assistant').length) active = 'assistant';
    else if (part === 'assistant' && !ways('user').length) active = 'user';
    refresh();
  }

  function cancelPending() {
    pending = null;
    refreshPanel();
    scheduleDraw();
  }

  function remember() {
    history.push(JSON.stringify(work.parts));
    if (history.length > 50) history.shift();
  }

  function undo() {
    if (!history.length) return;
    work.parts = JSON.parse(history.pop());
    pending = null;
    changed = true;
    refresh();
  }

  function removeWay(key, css) {
    remember();
    work.parts[key] = ways(key).filter((w) => w !== css);
    if (!work.parts[key].length) delete work.parts[key];
    focusWay = null;
    changed = true;
    refresh();
  }

  function clearPart(key) {
    if (!ways(key).length) return;
    remember();
    delete work.parts[key];
    changed = true;
    refresh();
  }

  /* --------------------------------------------------- the app's first guess */

  /** The chain of boxes holding nearly all of an element's text, going inwards. */
  function holdersBelow(el, limit) {
    const out = [];
    const total = el.textContent.length || 1;
    let node = el;
    while (out.length < limit) {
      node = Array.from(node.children).find((c) => c.textContent.length >= total * 0.9) || null;
      if (!node) break;
      out.push(node);
    }
    return out;
  }

  /** Up to three selectors that between them find all of `group` and none of `others`. */
  function coverGroup(group, others, key) {
    const found = [];
    let remaining = group.slice();
    const touches = (list, el) => list.some((x) => related(x, el));
    for (let round = 0; round < 3 && remaining.length; round++) {
      let best = null;
      const target = remaining[0];
      for (const level of [target, ...holdersBelow(target, 3)]) {
        const candidates = candidatesFor(level);
        for (const candidate of candidates) {
          const all = query(candidate.css);
          if (!all || !all.includes(level)) continue;
          const matched = all.filter((x) => M.hasContent(x));
          const covered = remaining.filter((g) => touches(matched, g));
          const hits = others.filter((o) => touches(matched, o)).length;
          const stray = matched.filter((x) => !touches(group, x) && !touches(others, x)).length;
          let s = candidate.weight + (80 * covered.length) / remaining.length;
          s -= others.length ? (140 * hits) / others.length : 0;
          s -= matched.length ? (25 * stray) / matched.length : 0;
          if (hasNesting(matched)) s -= 30;
          s += speakerHint(candidate.css, key);
          if (!best || s > best.score) best = { css: candidate.css, score: s, covered, hits };
        }
        if (best && best.hits) {
          const clash = others.find((o) => touches(query(best.css) || [], o));
          const theirs = clash ? tokensOf(clash).filter((t) => !matchesCss(level, t.css)) : [];
          for (const t of theirs.slice(0, 4)) {
            const css = `${best.css}:not(${t.css})`;
            const all = query(css);
            if (!all || !all.includes(level)) continue;
            const covered = remaining.filter((g) => touches(all, g));
            const hits = others.filter((o) => touches(all, o)).length;
            if (hits < best.hits && covered.length >= best.covered.length) {
              best = { css, score: best.score + 20, covered, hits };
            }
          }
        }
      }
      if (!best || !best.covered.length || best.score < 40) break;
      found.push(best.css);
      remaining = remaining.filter((g) => !best.covered.includes(g));
    }
    return found;
  }

  /** Proposes rules for this page: what it thinks your messages and the AI's are. */
  function guessRules() {
    const messages = M.guessMessages();
    if (!messages.length) {
      say('I could not find the messages on my own. Point at them instead: click one of your messages.');
      return false;
    }
    const speakers = messages.map((el, i) => M.roleOf(el, i, work.options));
    const mine = messages.filter((_, i) => speakers[i] === 'user');
    const theirs = messages.filter((_, i) => speakers[i] === 'assistant');
    const proposal = {};
    const user = coverGroup(mine, theirs, 'user');
    const assistant = coverGroup(theirs, mine, 'assistant');
    if (user.length) proposal.user = user;
    if (assistant.length) proposal.assistant = assistant;
    if (!user.length && !assistant.length) {
      const any = coverGroup(messages, [], 'message');
      if (any.length) proposal.message = any;
    }
    if (!Object.keys(proposal).length) {
      say('I could not describe the messages on my own. Point at them instead: click one of your messages.');
      return false;
    }
    remember();
    for (const key of MESSAGE_KEYS) delete work.parts[key];
    Object.assign(work.parts, proposal);
    guessedNow = true;
    changed = true;
    active = proposal.user && proposal.assistant ? 'user' : proposal.user ? 'assistant' : 'user';
    refresh();
    return true;
  }

  /**
   * A site with no rules yet starts from the app's own guess, so that most of
   * the time teaching is a matter of checking the colours and saving. So do
   * rules that find nothing at all on this page — after a redesign, fixing them
   * should be just as quick. The old rules stay one Undo away.
   */
  function guessIfNeeded() {
    if (mode !== 'teach' || (OPTIONS && OPTIONS.guess === false)) return;
    const nothingFound = hasMessageWays() && !MESSAGE_KEYS.some((k) => model.found[k]);
    if (hasMessageWays() && !nothingFound) return;
    repairing = nothingFound;
    try {
      guessRules();
    } catch {
      say('I could not make a guess on this page. Point at the messages instead: click one of your messages.');
    }
  }

  /* ---------------------------------------------------------------- model */

  const speakerOf = (m) => (m.speaker === 'user' ? 'user' : m.speaker === 'assistant' ? 'assistant' : 'other');

  function refresh() {
    const rules = { parts: work.parts, options: work.options };
    const result = hasMessageWays() ? M.findMessages(rules) : { messages: [], found: {}, invalid: [] };
    const messages = result.messages.map((m, i) => ({ ...m, speaker: m.role || M.roleOf(m.el, i, work.options) }));

    const items = [];
    const numbers = { user: 0, assistant: 0, other: 0 };
    for (const m of messages) {
      const who = speakerOf(m);
      numbers[who]++;
      const label =
        m.part === 'message'
          ? `${PART.message ? PART.message.short : 'Message'} · ${who === 'user' ? 'you?' : who === 'assistant' ? 'AI?' : m.speaker + '?'}`
          : `${PART[m.part].short} ${numbers[who]}`;
      items.push({ el: m.el, key: m.part, label, kind: 'message' });
    }
    const insideMessages = (el) => messages.some((m) => m.el !== el && m.el.contains(el));
    for (const key of ['thinking', 'body']) {
      for (const el of M.queryAll(ways(key)).elements) {
        if (insideMessages(el)) items.push({ el, key, label: PART[key].short, kind: 'inside' });
      }
    }
    for (const el of M.queryAll(ways('exclude')).elements) {
      items.push({ el, key: 'exclude', label: PART.exclude.short, kind: 'skip' });
    }
    const title = ways('title').map((s) => query(s) || []).flat().find((el) => el.textContent.trim());
    if (title) items.push({ el: title, key: 'title', label: PART.title.short, kind: 'page' });
    const scroller = M.queryAll(ways('scroll')).elements[0];
    if (scroller) items.push({ el: scroller, key: 'scroll', label: PART.scroll.short, kind: 'page' });
    for (const el of M.queryAll(ways('expand')).elements.slice(0, 40)) {
      items.push({ el, key: 'expand', label: PART.expand.short, kind: 'page' });
    }

    const counts = M.partCounts(rules, messages);
    const invalid = [...new Set(result.invalid.concat(['thinking', 'body', 'exclude', 'title', 'scroll', 'expand']
      .flatMap((k) => M.queryAll(ways(k)).invalid)))];
    model = { messages, items, counts, found: result.found, invalid, problems: problemsWith(messages, result, invalid) };
    refreshPanel();
    scheduleDraw();
  }

  function problemsWith(messages, result, invalid) {
    const out = [];
    for (const key of MESSAGE_KEYS) {
      if (ways(key).length && !result.found[key]) {
        out.push({ err: true, text: `“${PART[key].label}” finds nothing on this page. If the site has changed, remove the old way and point at them again.` });
      }
    }
    const mine = messages.filter((m) => speakerOf(m) === 'user').length;
    const theirs = messages.filter((m) => speakerOf(m) === 'assistant').length;
    if (messages.length >= 2 && (!mine || !theirs)) {
      out.push({
        text: mine
          ? 'Only your messages are found. Point at one of the AI’s replies too.'
          : 'Only the AI’s replies are found. Point at one of your messages too.',
      });
    }
    const navigation = messages.filter((m) => M.inNavigation(m.el)).length;
    if (navigation) {
      out.push({
        err: navigation >= messages.length / 2,
        text: `${navigation} of the boxes are in the site’s menu or sidebar, not the chat. Use “Leave out” on the menu, or point again.`,
      });
    }
    if (invalid.length) out.push({ text: `${invalid.length} way(s) are not valid and are ignored. Remove them and point again.` });
    return out;
  }

  /* --------------------------------------------------------------- drawing */

  const MAX_BOXES = 400;
  const pool = [];
  let drawQueued = false;

  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    // Animation frames keep the boxes in step with scrolling. A page that is
    // not being painted produces none at all, so a timer stands in.
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      draw();
    });
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      draw();
    }, 150);
  }

  function makeBox() {
    const box = h('div', 'box');
    box.appendChild(h('span', 'tag'));
    layer.appendChild(box);
    return box;
  }

  function placeBox(box, rect, cls, key, label, alpha) {
    box.className = `box ${cls}`;
    paint(box, key, alpha);
    box.style.display = 'block';
    box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    box.style.width = `${Math.max(4, Math.round(rect.width))}px`;
    box.style.height = `${Math.max(4, Math.round(rect.height))}px`;
    const tag = box.firstChild;
    tag.textContent = label || '';
    tag.className = `tag${rect.top < 20 ? ' in' : ''}${cls.split(' ').includes('inside') ? ' right' : ''}`;
  }

  function draw() {
    drawQueued = false;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const visible = (r) => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.top < height && r.right > 0 && r.left < width;

    const items = model.items.slice();
    if (pending) {
      for (const el of pending.choice.found) {
        items.push({ el, key: pending.part, label: el === pending.el ? 'New ✓?' : '', kind: 'pending' });
      }
    }
    const focused = focusWay ? new Set(query(focusWay.css) || []) : null;

    let used = 0;
    for (const item of items) {
      if (used >= MAX_BOXES) break;
      const rect = item.el.getBoundingClientRect();
      if (!visible(rect)) continue;
      let cls = item.kind;
      if (focused) cls += item.key === focusWay.key && focused.has(item.el) ? ' focus' : ' dim';
      const box = pool[used] || (pool[used] = makeBox());
      placeBox(box, rect, cls, item.key, item.label, item.kind === 'pending' ? 0.22 : 0.12);
      used++;
    }
    for (let i = used; i < pool.length; i++) pool[i].style.display = 'none';
    drawHover();
  }

  let hover = null;

  function drawHover() {
    if (!hover || mode !== 'teach' || paused || !hover.el.isConnected) {
      hoverBox.style.display = 'none';
      return;
    }
    const rect = hover.el.getBoundingClientRect();
    placeBox(hoverBox, rect, 'hover', active, `Click → ${PART[active] ? PART[active].label : ''}`, 0.1);
  }

  /* ----------------------------------------------------------------- panel */

  function say(text) {
    flashText = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashText = '';
      refreshPanel();
    }, 6000);
    refreshPanel();
  }

  function countLabel(key) {
    if (!ways(key).length) return { text: '—', cls: 'unset', title: 'Not set' };
    const n = model.counts[key] || 0;
    if (n) return { text: String(n), cls: '', title: `${n} found on this page` };
    // Only a message part finding nothing at all is a problem. Optional parts
    // are often simply absent — a chat with no reasoning in it — and a message
    // part whose boxes were all claimed by a more specific part is working.
    const message = PART[key] && PART[key].group === 'message';
    if (message && !model.found[key]) return { text: '0 ⚠', cls: 'zero', title: 'None found on this page' };
    if (message) return { text: '0', cls: 'unset', title: 'Everything it finds is already covered by another part' };
    return { text: '0', cls: 'unset', title: 'None on this page — that is fine if this chat has none' };
  }

  function partRow(key) {
    const part = PART[key];
    const row = button('', `part${active === key && mode === 'teach' ? ' active' : ''}`, () => {
      if (mode !== 'teach') return;
      active = key;
      pending = pending && pending.part === key ? pending : null;
      refreshPanel();
      scheduleDraw();
    }, part.help);
    paint(row, key);
    const name = h('span', 'name', part.label);
    if (active === key && mode === 'teach' && !pending) name.appendChild(h('small', '', part.pick));
    const count = countLabel(key);
    const badge = h('span', `count ${count.cls}`, count.text);
    badge.title = count.title;
    row.append(h('span', 'swatch'), name, badge);
    return row;
  }

  function waysCard(key) {
    const card = h('div', 'card');
    const list = ways(key);
    card.appendChild(h('h4', '', `Ways to find “${PART[key].label}”`));
    if (!list.length) {
      card.appendChild(h('p', 'hint', `None yet. ${PART[key].pick}`));
      return card;
    }
    list.forEach((css, i) => {
      const found = (query(css) || []).length;
      const row = h('div', 'way');
      const n = h('span', 'n', `Way ${i + 1} · ${found} box${found === 1 ? '' : 'es'} on this page`);
      if (showCss) n.appendChild(h('code', '', css));
      row.addEventListener('mouseenter', () => {
        focusWay = { key, css };
        scheduleDraw();
      });
      row.addEventListener('mouseleave', () => {
        focusWay = null;
        scheduleDraw();
      });
      row.append(n, button('×', 'mini x', () => removeWay(key, css), 'Remove this way'));
      card.appendChild(row);
    });
    const tools = h('div', 'row');
    tools.append(
      button(showCss ? 'Hide technical details' : 'Show technical details', 'mini', () => {
        showCss = !showCss;
        refreshPanel();
      }),
      button('Clear this part', 'mini', () => clearPart(key))
    );
    card.appendChild(tools);
    card.appendChild(h('p', 'hint', 'Missing some? Click one that has no box — it is added as another way.'));
    return card;
  }

  function pendingCard() {
    const { part, choice } = pending;
    const card = h('div', 'card pending');
    paint(card, part);
    const n = choice.found.length;
    card.appendChild(h('h4', '', `New way for “${PART[part].label}”`));
    card.appendChild(h('div', 'summary', `${n} box${n === 1 ? '' : 'es'} found like this. Is the flashing box the whole ${PART[part].group === 'message' ? 'message' : 'thing'}?`));
    const sizes = h('div', 'row');
    sizes.append(
      button('▲ Bigger', 'btn', bigger, 'Make the box bigger (↑)'),
      button('▼ Smaller', 'btn', smaller, 'Make the box smaller (↓)'),
      h('span', 'grow'),
      button('✕', 'btn', cancelPending, 'Forget this pick (Esc)'),
      button('✓ Add', 'btn good', acceptPending, 'Add this way (Enter)')
    );
    card.appendChild(sizes);

    const notes = [];
    if (n === 1) notes.push('Only one found like this. If there are more on the page that look different, add them one at a time.');
    const others = claimedByOthers(part);
    const clash = others.size ? choice.found.filter((el) => overlapsAny(el, others)).length : 0;
    if (clash) notes.push(`${clash} of these are already another part. Try ▼ Smaller, or click a different spot.`);
    if (choice.found.some((el) => M.inNavigation(el))) notes.push('Some of these are in the site’s menu or sidebar.');
    const opposite = part === 'user' ? 'assistant' : part === 'assistant' ? 'user' : null;
    if (opposite && speakerHint(choice.css, part) < 0) {
      const wrong = h('div', 'problem');
      wrong.append(
        h('span', '', `This looks like ${opposite === 'assistant' ? 'one of the AI’s replies' : 'one of your messages'}. `),
        button(`Add it to “${PART[opposite].label}” instead`, 'mini', () => {
          pending.part = opposite;
          active = opposite;
          acceptPending();
        })
      );
      card.appendChild(wrong);
    }
    for (const text of notes) card.appendChild(h('p', 'hint', text));
    card.appendChild(keysHint());
    return card;
  }

  function keysHint() {
    const keys = h('div', 'keys');
    for (const [k, label] of [['↑', 'bigger'], ['↓', 'smaller'], ['Enter', 'add'], ['Esc', 'cancel']]) {
      keys.append(h('kbd', '', k), document.createTextNode(` ${label}  `));
    }
    return keys;
  }

  function previewCard() {
    const card = h('div', 'card preview');
    const mine = model.messages.filter((m) => speakerOf(m) === 'user').length;
    const theirs = model.messages.filter((m) => speakerOf(m) === 'assistant').length;
    card.appendChild(h('h4', '', 'Reading this page would give'));
    const summary = h('div', 'summary');
    summary.append(
      h('b', '', String(model.messages.length)),
      document.createTextNode(` message${model.messages.length === 1 ? '' : 's'} — `),
      h('b', '', String(mine)),
      document.createTextNode(' yours · '),
      h('b', '', String(theirs)),
      document.createTextNode(' from the AI')
    );
    card.appendChild(summary);
    for (const m of model.messages.slice(0, 6)) {
      const who = speakerOf(m);
      const line = h('div', 'line');
      paint(line, who === 'other' ? 'message' : who);
      line.append(
        h('span', 'who', who === 'user' ? 'You' : who === 'assistant' ? 'AI' : m.speaker),
        h('span', 'txt', readableText(m))
      );
      card.appendChild(line);
    }
    if (model.messages.length > 6) card.appendChild(h('div', 'hint', `…and ${model.messages.length - 6} more on this page.`));
    if (!model.messages.length) card.appendChild(h('div', 'hint', 'Nothing yet.'));
    return card;
  }

  /** Roughly what an export would say: buttons, icons and screen-reader labels left out. */
  function readableText(message) {
    const copy = message.el.cloneNode(true);
    const noise = 'button, svg, script, style, .sr-only, [aria-hidden="true"], [role="toolbar"]';
    for (const node of Array.from(copy.querySelectorAll(noise))) node.remove();
    for (const sel of ways('exclude')) {
      try {
        for (const node of Array.from(copy.querySelectorAll(sel))) node.remove();
      } catch {
        /* an invalid way is reported elsewhere */
      }
    }
    return copy.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) || '(a picture)';
  }

  function problemsList() {
    const box = h('div', 'problems');
    for (const p of model.problems) box.appendChild(h('div', `problem${p.err ? ' err' : ''}`, p.text));
    return box;
  }

  function instruction() {
    if (paused) return h('p', 'say pause', 'Picking is paused — use the page as normal. Press “Resume picking” when you are ready.');
    if (guessedNow && repairing) {
      return h('p', 'say guess',
        'The old rules find nothing on this page — the site has probably changed. I made a new guess: ' +
        'blue boxes are your messages, green boxes are the AI’s. If the colours are right, press “Save rules”. ' +
        '(Undo brings the old rules back.)');
    }
    if (guessedNow) {
      return h('p', 'say guess',
        'I made a first guess: blue boxes are your messages, green boxes are the AI’s. ' +
        'If the colours are right, press “Save rules”. If not, choose a part below and click the right thing on the page.');
    }
    if (pending) return h('p', 'say', 'Check the flashing boxes. Make them bigger or smaller until each one covers a whole message, then add.');
    if (!hasMessageWays()) return h('p', 'say', `${PART[active] ? PART[active].pick : ''} Each kind of thing gets its own colour.`);
    return h('p', 'say', `Choose a part, then click it on the page. Now adding to “${PART[active] ? PART[active].label : ''}”.`);
  }

  function header() {
    const head = h('div', 'head');
    const title = h('div', 'title');
    title.append(
      h('b', '', mode === 'teach' ? `Teach: ${siteName}` : `Rules for ${original && original.name ? original.name : siteName}`),
      h('small', '', mode === 'teach' ? 'Show the app which part of the page is which' : 'Every box is something a read will capture')
    );
    head.append(h('span', 'logo', 'AI'), title);
    if (mode === 'teach') {
      head.appendChild(button(paused ? '▶' : '✋', 'icon', () => {
        paused = !paused;
        hover = null;
        refreshPanel();
        scheduleDraw();
      }, paused ? 'Resume picking' : 'Pause picking, to use the page normally'));
    }
    head.appendChild(button('✕', 'icon', requestClose, mode === 'teach' ? 'Cancel' : 'Close'));
    makeDraggable(head);
    return head;
  }

  function closeConfirm() {
    const card = h('div', 'card');
    card.appendChild(h('div', 'summary', 'Throw away the changes you made here?'));
    const row = h('div', 'row');
    row.append(
      button('Keep editing', 'btn', () => {
        confirmingClose = false;
        refreshPanel();
      }),
      button('Discard', 'btn danger', () => finish({ ok: false, cancelled: true }))
    );
    card.appendChild(row);
    return card;
  }

  function scopeChooser() {
    const box = h('div', 'scope');
    const option = (value, text) => {
      const label = h('label');
      const input = h('input');
      input.type = 'radio';
      input.name = 'ace-scope';
      input.checked = scope === value;
      input.addEventListener('change', () => {
        scope = value;
      });
      label.append(input, h('span', '', text));
      return label;
    };
    box.append(
      h('div', 'hint', 'Where on the site:'),
      option('site', `all of ${location.hostname || siteName}`),
      option('page', `only pages under ${location.hostname || siteName}${pagePrefix}…`)
    );
    return box;
  }

  /**
   * The last step of saving, at the top of the panel where it cannot be
   * missed: over the rule set this started from or as a new one, its name,
   * where on the site it applies, and whether the site is read with it.
   */
  function saveCard() {
    const box = h('div', 'card saving');
    box.appendChild(h('h4', '', 'Save these rules'));
    const choice = (value, text) => {
      const label = h('label');
      const input = h('input');
      input.type = 'radio';
      input.name = 'ace-save-as';
      input.checked = saveAs === value;
      input.addEventListener('change', () => {
        saveAs = value;
        refreshPanel();
      });
      label.append(input, h('span', '', text));
      return label;
    };
    if (SAVING.canUpdate) {
      box.append(
        h('div', 'hint', 'Save as:'),
        choice('update', `changes to “${SAVING.currentName}”`),
        choice('new', 'a new rule set, keeping that one as it is')
      );
    }
    if (saveAs === 'new') {
      if (!SAVING.canUpdate) box.appendChild(h('div', 'hint', 'Name for these rules:'));
      const name = h('input');
      name.type = 'text';
      name.value = newName;
      name.placeholder = SAVING.suggestedName || 'My rules';
      name.dataset.field = 'name';
      name.addEventListener('input', () => {
        newName = name.value;
      });
      // Typing here is not for the page: some sites send any key press to their own message box.
      for (const type of ['keydown', 'keypress', 'keyup']) {
        name.addEventListener(type, (e) => {
          e.stopPropagation();
          if (type === 'keydown' && e.key === 'Enter') finishSave();
        });
      }
      box.appendChild(name);
    }
    const tick = h('label');
    const use = h('input');
    use.type = 'checkbox';
    use.checked = makeDefault;
    use.addEventListener('change', () => {
      makeDefault = use.checked;
    });
    tick.append(use, h('span', '', `Use them for ${location.hostname || siteName} from now on`));
    if (pagePrefix) box.appendChild(scopeChooser());
    box.appendChild(tick);
    const row = h('div', 'row');
    row.style.marginTop = '8px';
    row.append(
      button('✓ Save these rules', 'btn good', finishSave),
      button('Back', 'btn', closeSaveStep)
    );
    box.appendChild(row);
    return box;
  }

  function refreshPanel() {
    const scrollTop = panel.scrollTop;
    // The panel is rebuilt as the page changes; someone typing a name keeps their place.
    const typing = shadow.activeElement && shadow.activeElement.dataset && shadow.activeElement.dataset.field;
    const caret = typing ? [shadow.activeElement.selectionStart, shadow.activeElement.selectionEnd] : null;
    panel.textContent = '';
    panel.appendChild(header());
    const body = h('div', 'body');
    panel.appendChild(body);

    if (flashText) body.appendChild(h('div', 'flash', flashText));
    if (confirmingClose) body.appendChild(closeConfirm());
    if (confirmingSave && mode === 'teach') body.appendChild(saveCard());

    if (mode === 'show') {
      const keys = PARTS.map((p) => p.key).filter((k) => ways(k).length);
      const list = h('div', 'parts');
      for (const key of keys) list.appendChild(partRow(key));
      if (!keys.length) body.appendChild(h('p', 'say', 'There are no rules for this site yet.'));
      body.append(list, problemsList(), previewCard());
      const foot = h('div', 'foot');
      foot.append(
        button('✎ Fix these rules', 'btn primary', () => {
          mode = 'teach';
          const broken = MESSAGE_KEYS.find((k) => ways(k).length && !model.found[k]);
          active = broken || 'user';
          refresh();
          guessIfNeeded();
        }),
        h('span', 'grow'),
        button('Close', 'btn', requestClose)
      );
      panel.appendChild(foot);
      panel.scrollTop = scrollTop;
      return;
    }

    body.appendChild(instruction());
    const list = h('div', 'parts');
    for (const key of MAIN_KEYS) list.appendChild(partRow(key));
    body.appendChild(list);
    body.appendChild(button(showMore ? '▾ Fewer parts' : `▸ More parts (reasoning, leave out, title…)`, 'more', () => {
      showMore = !showMore;
      refreshPanel();
    }));
    if (showMore) {
      const more = h('div', 'parts');
      for (const key of MORE_KEYS) more.appendChild(partRow(key));
      body.appendChild(more);
    }

    body.appendChild(pending ? pendingCard() : waysCard(active));
    if (model.problems.length) body.appendChild(problemsList());
    body.appendChild(previewCard());

    const foot = h('div', 'foot');
    const undoButton = button('↶ Undo', 'btn', undo, 'Undo the last change (Ctrl+Z)');
    undoButton.disabled = !history.length;
    foot.append(
      undoButton,
      button('✦ Guess for me', 'btn', guessRules, 'Let the app propose rules for this page'),
      h('span', 'grow'),
      button('Save rules', 'btn primary', save, 'Save these rules for this site')
    );
    panel.appendChild(foot);
    panel.scrollTop = scrollTop;
    if (typing) {
      const field = panel.querySelector(`[data-field="${typing}"]`);
      if (field) {
        field.focus();
        field.setSelectionRange(caret[0], caret[1]);
      }
    }
  }

  function makeDraggable(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest && e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      const dx = e.clientX - rect.left;
      const dy = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const left = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width);
        const top = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 60);
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  /* ---------------------------------------------------------- page events */

  const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

  function onBlocked(e) {
    if (mode !== 'teach' || paused || inOverlay(e)) return;
    // While picking, the page must not react to clicks: no links followed, no
    // menus opened, nothing focused. The click is ours.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type === 'click' && e.button === 0) pickAt(e.clientX, e.clientY);
  }

  function onMove(e) {
    if (mode !== 'teach' || paused || inOverlay(e)) {
      if (hover) {
        hover = null;
        drawHover();
      }
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === host || host.contains(target)) return;
    if (hover && hover.origin === target) return;
    hover = { origin: target, el: snap(target, active) };
    drawHover();
  }

  function onKey(e) {
    if (inOverlay(e) && /^(INPUT|TEXTAREA|SELECT)$/.test((e.composedPath()[0] || {}).tagName || '')) return;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Escape') {
      handled();
      if (pending) cancelPending();
      else if (confirmingSave) closeSaveStep();
      else requestClose();
    } else if (pending && e.key === 'ArrowUp') {
      handled();
      bigger();
    } else if (pending && e.key === 'ArrowDown') {
      handled();
      smaller();
    } else if (pending && e.key === 'Enter') {
      handled();
      acceptPending();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && mode === 'teach') {
      handled();
      undo();
    }
  }

  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(refresh, 450);
  });

  /* ----------------------------------------------------------- finishing */

  let resolveResult = null;
  let finished = false;

  function summary() {
    return {
      messages: model.messages.length,
      user: model.messages.filter((m) => speakerOf(m) === 'user').length,
      assistant: model.messages.filter((m) => speakerOf(m) === 'assistant').length,
    };
  }

  /** The rules as they stand, or null when no message part has a way yet. */
  function partsToSave() {
    const parts = {};
    for (const [key, list] of Object.entries(work.parts)) {
      if (Array.isArray(list) && list.length) parts[key] = list.slice();
    }
    return MESSAGE_KEYS.some((k) => parts[k]) ? parts : null;
  }

  /** "Save rules": opens the last step, or completes it when it is open. */
  function save() {
    if (!partsToSave()) {
      say('Point at your messages and the AI’s replies first, so the app knows where the conversation is.');
      return;
    }
    if (confirmingSave) {
      finishSave();
      return;
    }
    confirmingSave = true;
    refreshPanel();
    panel.scrollTop = 0;
    const name = panel.querySelector('[data-field="name"]');
    if (name) {
      name.focus();
      name.select();
    }
  }

  function closeSaveStep() {
    confirmingSave = false;
    refreshPanel();
  }

  function finishSave() {
    const parts = partsToSave();
    if (!parts) return;
    finish({
      ok: true,
      action: 'save',
      parts,
      options: work.options,
      pathPrefix: scope === 'page' ? pagePrefix : '',
      counts: model.counts,
      found: model.found,
      summary: summary(),
      saveAs,
      name: saveAs === 'new' ? newName.trim() || SAVING.suggestedName || '' : '',
      makeDefault,
    });
  }

  function requestClose() {
    if (mode === 'show') {
      finish({ ok: true, action: 'close', counts: model.counts, found: model.found, summary: summary() });
      return;
    }
    if (changed && !confirmingClose) {
      confirmingClose = true;
      refreshPanel();
      return;
    }
    finish({ ok: false, cancelled: true });
  }

  function finish(result) {
    if (finished) return;
    finished = true;
    for (const type of BLOCKED) window.removeEventListener(type, onBlocked, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', scheduleDraw, true);
    window.removeEventListener('resize', scheduleDraw);
    observer.disconnect();
    clearTimeout(mutationTimer);
    clearTimeout(flashTimer);
    host.remove();
    if (window.__aceTeachClose === close) delete window.__aceTeachClose;
    resolveResult(result);
  }

  const close = () => finish({ ok: false, cancelled: true });
  window.__aceTeachClose = close;

  return new Promise((resolve) => {
    resolveResult = resolve;
    for (const type of BLOCKED) window.addEventListener(type, onBlocked, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', scheduleDraw, true);
    window.addEventListener('resize', scheduleDraw);
    if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    try {
      refresh();
    } catch (err) {
      // An overlay that cannot draw must not be left stuck over the page.
      finish({ ok: false, error: String((err && err.stack) || err) });
      return;
    }
    guessIfNeeded();
  });
}

// Same dual-use arrangement as extract.js: importable by the extension,
// injectable as text by the desktop app.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { startTeach: __aceTeach };
}
