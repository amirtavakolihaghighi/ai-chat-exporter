'use strict';

const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const { base64ToBytes } = require('../../shared/bytes');

/* ------------------------------------------------------------- sanitising */

/**
 * Strip anything executable from captured markup before it is written to disk
 * or loaded into an export window. The content came from a page the user chose
 * to open, but exported HTML gets opened later in other contexts, so it must
 * not carry script with it.
 */
function sanitizeHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\s*(script|style|noscript|iframe|object|embed|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|noscript|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src|action)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}

/* --------------------------------------------------------------- markdown */

function makeTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });
  td.use(gfm);

  // Maths: the extractor left the TeX source on a data-tex attribute.
  td.addRule('tex', {
    filter: (node) => node.nodeName === 'SPAN' && node.hasAttribute('data-tex'),
    replacement: (_content, node) => {
      const tex = node.getAttribute('data-tex');
      return node.getAttribute('data-display') === '1' ? `\n\n$$${tex}$$\n\n` : `$${tex}$`;
    },
  });

  // Fenced code with the language label the extractor recovered.
  td.addRule('fencedCode', {
    filter: (node) =>
      node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE',
    replacement: (_content, node) => {
      const code = node.firstChild;
      const match = /(?:language|lang)-(\S+)/.exec(code.className || '');
      const lang = match ? match[1] : '';
      const text = (code.textContent || '').replace(/\n$/, '');
      // Widen the fence if the snippet itself contains backtick runs.
      const longest = (text.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0);
      const fence = '`'.repeat(Math.max(3, longest + 1));
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  });

  td.addRule('dropEmpty', {
    filter: (node) =>
      ['DIV', 'SPAN'].includes(node.nodeName) && !node.textContent.trim() && !node.querySelector('img'),
    replacement: () => '',
  });

  return td;
}

const turndown = makeTurndown();

function htmlToMarkdown(html) {
  if (!html) return '';
  try {
    return turndown
      .turndown(sanitizeHtml(html))
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch (err) {
    return htmlToText(html);
  }
}

/* ------------------------------------------------------------- plain text */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—',
  ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·',
};

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function htmlToText(html) {
  if (!html) return '';
  return decodeEntities(
    sanitizeHtml(html)
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|pre|blockquote)\s*>/gi, '\n')
      .replace(/<\s*li\b[^>]*>/gi, '  • ')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------------ assets */

/**
 * Pull inlined data-URI images back out into real files. Markdown and DOCX want
 * sidecar assets; a single-file HTML export wants them left inline.
 */
function extractDataUriAssets(html, folderName) {
  const assets = [];
  let n = 0;
  const out = String(html || '').replace(
    /src\s*=\s*"data:(image\/([a-z0-9.+-]+));base64,([^"]+)"/gi,
    (_m, mime, subtype, b64) => {
      n += 1;
      const ext = subtype.replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace(/[^a-z0-9]/g, '') || 'png';
      const filename = `image-${String(n).padStart(3, '0')}.${ext}`;
      try {
        // Uint8Array rather than Buffer: fs.writeFile and JSZip both take it,
        // and it is the only representation the browser build can produce.
        assets.push({ filename, bytes: base64ToBytes(b64), mime });
      } catch {
        return `src="data:${mime};base64,${b64}"`;
      }
      return `src="${folderName}/${filename}"`;
    }
  );
  return { html: out, assets };
}

/* ------------------------------------------------------------ conversation */

const ROLE_LABELS = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

function roleLabel(role, conversation) {
  if (role === 'assistant' && conversation?.providerName) return conversation.providerName;
  return ROLE_LABELS[role] || role;
}

/** Apply the user's find/replace redaction rules to a string. */
function redact(str, rules) {
  if (!rules || !rules.length || !str) return str;
  let out = str;
  for (const rule of rules) {
    if (!rule.find) continue;
    try {
      const re = rule.regex
        ? new RegExp(rule.find, 'gi')
        : new RegExp(rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, rule.replace ?? '[redacted]');
    } catch {
      /* an invalid user regex shouldn't kill the export */
    }
  }
  return out;
}

/**
 * Normalise a raw extraction into the shape every exporter consumes: filtered,
 * redacted, with markdown and text alongside the original HTML.
 */
function prepare(conversation, options = {}) {
  const opts = {
    includeThinking: true,
    includeSystem: true,
    redactions: [],
    selection: null,
    ...options,
  };

  // `selection` holds positions in the original capture. Keeping the original
  // position on every message is what lets the UI tick boxes against a stable
  // identity even while filters renumber what is exported.
  const selection = Array.isArray(opts.selection) && opts.selection.length
    ? new Set(opts.selection)
    : null;

  const messages = conversation.messages
    .map((m, originalIndex) => ({ ...m, originalIndex }))
    .filter((m) => !selection || selection.has(m.originalIndex))
    .filter((m) => opts.includeSystem || !['system', 'tool'].includes(m.role))
    .map((m, i) => {
      // Each representation is redacted from its own clean source rather than
      // derived from an already-redacted one. Two reasons: Markdown conversion
      // escapes bracket characters, which would mangle a "[redacted]" marker
      // carried over from HTML; and a secret split across inline tags
      // (sk-<em>KEY</em>) is invisible to an HTML-level match but plain in the
      // converted text.
      const cleanHtml = sanitizeHtml(m.html);
      const cleanThinking = opts.includeThinking && m.thinkingHtml ? sanitizeHtml(m.thinkingHtml) : '';
      return {
        index: i,
        originalIndex: m.originalIndex,
        role: m.role,
        label: roleLabel(m.role, conversation),
        html: redact(cleanHtml, opts.redactions),
        thinkingHtml: redact(cleanThinking, opts.redactions),
        markdown: redact(htmlToMarkdown(cleanHtml), opts.redactions),
        thinkingMarkdown: cleanThinking ? redact(htmlToMarkdown(cleanThinking), opts.redactions) : '',
        text: redact(m.text, opts.redactions),
      };
    });

  return {
    ...conversation,
    title: redact(conversation.title || 'Untitled chat', opts.redactions) || 'Untitled chat',
    messages,
  };
}

module.exports = {
  sanitizeHtml,
  htmlToMarkdown,
  htmlToText,
  extractDataUriAssets,
  prepare,
  redact,
  roleLabel,
};
