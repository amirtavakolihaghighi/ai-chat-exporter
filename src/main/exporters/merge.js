'use strict';

const { marked } = require('marked');
const docx = require('docx');

const { escapeHtml, THEMES } = require('../lib/render');
const { sanitizeHtml } = require('../lib/convert');
const { markdownToParagraphs, makeContext } = require('./docx');
const { isRtl } = require('../../shared/direction');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, ExternalHyperlink, convertInchesToTwip,
} = docx;

/**
 * Combines several captured chats into one document with a table of contents.
 *
 * Sources are archive records (see lib/store.js) or previously exported
 * ai-chat-extractor JSON files. Both carry Markdown per message, so everything
 * here is rebuilt from Markdown rather than from the original page HTML — which
 * also means a merged document never drags along megabytes of inlined images.
 */

function slugFor(title, index) {
  const base = String(title || 'chat')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `chat-${index + 1}-${base || 'untitled'}`;
}

/** Accepts either an archive record or an exported JSON document. */
function normaliseSource(source, index) {
  const messages = (source.messages || []).map((m, i) => ({
    index: i,
    role: m.role || 'assistant',
    label: m.label || (m.role === 'user' ? 'You' : 'Assistant'),
    markdown: m.markdown || m.text || '',
    text: m.text || m.markdown || '',
  }));
  const title = source.title || 'Untitled chat';
  return {
    title,
    url: source.url || '',
    provider: source.provider?.name || source.provider || source.providerName || '',
    capturedAt: source.capturedAt || source.at || null,
    slug: slugFor(title, index),
    messages,
  };
}

function normaliseAll(sources) {
  return sources.map(normaliseSource);
}

/* ------------------------------------------------------------------ markdown */

function buildMergedMarkdown(sources, opts = {}) {
  const chats = normaliseAll(sources);
  const title = opts.documentTitle || 'Merged AI conversations';
  const out = [];

  if (opts.frontmatter !== false) {
    out.push('---');
    out.push(`title: "${title.replace(/"/g, '\\"')}"`);
    out.push(`chats: ${chats.length}`);
    out.push(`created: "${new Date().toISOString()}"`);
    out.push('tags: [ai-chat, merged]');
    out.push('---', '');
  }

  out.push(`# ${title}`, '');
  out.push(`${chats.length} conversation${chats.length === 1 ? '' : 's'}, ` +
    `${chats.reduce((a, c) => a + c.messages.length, 0)} messages total.`, '');

  out.push('## Contents', '');
  chats.forEach((chat, i) => {
    out.push(`${i + 1}. [${chat.title}](#${chat.slug}) — ${chat.messages.length} messages` +
      (chat.provider ? ` · ${chat.provider}` : ''));
  });
  out.push('');

  for (const chat of chats) {
    out.push('---', '');
    // An explicit anchor keeps the contents links working in Obsidian, GitHub
    // and anything else that renders the Markdown.
    out.push(`<a id="${chat.slug}"></a>`, '');
    out.push(`## ${chat.title}`, '');
    const meta = [chat.provider, chat.url, chat.capturedAt ? new Date(chat.capturedAt).toLocaleString() : '']
      .filter(Boolean);
    if (meta.length) out.push(`*${meta.join(' · ')}*`, '');
    for (const message of chat.messages) {
      out.push(`### ${message.label}`, '');
      out.push(message.markdown || '', '');
    }
  }

  return out.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

/* ---------------------------------------------------------------- plain text */

function buildMergedText(sources, opts = {}) {
  const chats = normaliseAll(sources);
  const title = opts.documentTitle || 'Merged AI conversations';
  const out = [title, '='.repeat(Math.min(title.length, 80)), ''];

  out.push('CONTENTS', '');
  chats.forEach((chat, i) => out.push(`  ${i + 1}. ${chat.title} (${chat.messages.length} messages)`));
  out.push('');

  chats.forEach((chat, i) => {
    out.push('', '='.repeat(72), `${i + 1}. ${chat.title}`, '='.repeat(72), '');
    if (chat.url) out.push(`Source: ${chat.url}`, '');
    for (const message of chat.messages) {
      out.push('-'.repeat(60), `[${message.label}]`, '');
      out.push(message.text || message.markdown || '', '');
    }
  });

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ---------------------------------------------------------------------- html */

function buildMergedHtml(sources, opts = {}) {
  const chats = normaliseAll(sources);
  const theme = THEMES[opts.theme] ? opts.theme : 'light';
  const t = THEMES[theme];
  const title = opts.documentTitle || 'Merged AI conversations';

  const toc = chats
    .map((chat, i) => `<li><a href="#${chat.slug}">${escapeHtml(chat.title)}</a>
      <span class="tocmeta">${chat.messages.length} messages${chat.provider ? ' · ' + escapeHtml(chat.provider) : ''}</span></li>`)
    .join('\n');

  const body = chats
    .map((chat) => {
      const meta = [chat.provider, chat.capturedAt ? new Date(chat.capturedAt).toLocaleString() : '']
        .filter(Boolean)
        .map(escapeHtml)
        .join(' · ');
      const turns = chat.messages
        .map((message) => `
          <section class="turn ${escapeHtml(message.role)}">
            <div class="role">${escapeHtml(message.label)}</div>
            <div class="body" dir="auto">${sanitizeHtml(marked.parse(message.markdown || ''))}</div>
          </section>`)
        .join('\n');
      return `
        <article class="chat" id="${chat.slug}">
          <h2 dir="auto">${escapeHtml(chat.title)}</h2>
          <div class="meta">${meta}${chat.url ? ` · <a href="${escapeHtml(chat.url)}">${escapeHtml(chat.url)}</a>` : ''}</div>
          ${turns}
        </article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="AI Chat Extractor">
<style>
:root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
* { box-sizing: border-box; }
body { margin:0; background:${t.bg}; color:${t.fg}; font-family:${t.font};
  font-size:${opts.fontSize || 15}px; line-height:1.65; }
.wrap { max-width:${opts.pageWidth || 820}px; margin:0 auto; padding:40px 28px 80px; }
h1.doc { font-size:2em; margin:0 0 6px; }
.sub { color:${t.muted}; font-size:.85em; margin-bottom:28px; }
nav.toc { border:1px solid ${t.line}; border-radius:10px; padding:18px 22px; margin-bottom:36px; background:${t.codeBg}; }
nav.toc h2 { margin:0 0 10px; font-size:.8em; text-transform:uppercase; letter-spacing:.09em; color:${t.muted}; }
nav.toc ol { margin:0; padding-left:1.4em; }
nav.toc li { margin:6px 0; }
nav.toc a { color:${t.accent}; text-decoration:none; }
nav.toc a:hover { text-decoration:underline; }
.tocmeta { color:${t.muted}; font-size:.8em; margin-left:8px; }
article.chat { border-top:2px solid ${t.line}; padding-top:26px; margin-top:36px; break-before:page; }
article.chat:first-of-type { break-before:auto; }
article.chat h2 { font-size:1.5em; margin:0 0 6px; }
article.chat > .meta { color:${t.muted}; font-size:.8em; margin-bottom:18px; word-break:break-all; }
.turn { padding:16px 0; border-bottom:1px solid ${t.line}; break-inside:avoid-page; }
.turn.user { background:${t.userBg}; margin:0 -14px; padding-left:14px; padding-right:14px; border-radius:8px; }
.role { font-size:.72em; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:${t.accent}; margin-bottom:7px; }
.turn.user .role { color:${t.muted}; }
.body > *:first-child { margin-top:0; }
.body > *:last-child { margin-bottom:0; }
.body p { margin:0 0 .85em; }
.body pre { background:${t.codeBg}; border:1px solid ${t.line}; border-radius:8px; padding:12px 14px;
  overflow-x:auto; break-inside:avoid-page; }
.body code { font-family:"Cascadia Code",Consolas,monospace; font-size:.88em; background:${t.codeBg};
  padding:.15em .38em; border-radius:4px; }
.body pre code { background:none; padding:0; }
.body table { border-collapse:collapse; width:100%; margin:.8em 0; font-size:.92em; }
.body th, .body td { border:1px solid ${t.line}; padding:6px 10px; text-align:left; }
.body th { background:${t.codeBg}; }
.body blockquote { margin:.8em 0; padding:.1em 0 .1em 1em; border-left:3px solid ${t.line}; color:${t.muted}; }
.body img { max-width:100%; height:auto; }
@media print {
  body { background:#fff; color:#000; }
  .wrap { max-width:none; padding:0; }
  nav.toc { break-after:page; }
  .turn.user { background:#f4f4f5 !important; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .body pre { white-space:pre-wrap; word-break:break-word; }
}
</style>
</head>
<body>
<div class="wrap">
<h1 class="doc">${escapeHtml(title)}</h1>
<div class="sub">${chats.length} conversation${chats.length === 1 ? '' : 's'} ·
  ${chats.reduce((a, c) => a + c.messages.length, 0)} messages ·
  merged ${escapeHtml(new Date().toLocaleString())}</div>
<nav class="toc"><h2>Contents</h2><ol>
${toc}
</ol></nav>
${body}
</div>
</body>
</html>`;
}

/* ---------------------------------------------------------------------- docx */

function buildMergedDocument(sources, opts = {}) {
  const chats = normaliseAll(sources);
  const title = opts.documentTitle || 'Merged AI conversations';

  const children = [
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 40 })],
      spacing: { after: 160 },
    }),
    new Paragraph({
      children: [new TextRun({
        text: `${chats.length} conversation${chats.length === 1 ? '' : 's'} · ` +
          `${chats.reduce((a, c) => a + c.messages.length, 0)} messages · merged ${new Date().toLocaleString()}`,
        color: '6B7280', size: 18,
      })],
      spacing: { after: 260 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'CONTENTS', bold: true, size: 20 })],
      spacing: { after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 6 } },
    }),
  ];

  chats.forEach((chat, i) => {
    const rtl = isRtl(chat.title);
    children.push(new Paragraph({
      children: [new TextRun({
        text: `${i + 1}.  ${chat.title}  —  ${chat.messages.length} messages`,
        rightToLeft: rtl || undefined,
      })],
      spacing: { after: 60 },
      bidirectional: rtl || undefined,
      alignment: rtl ? AlignmentType.RIGHT : undefined,
    }));
  });

  const ctx = makeContext();
  for (const chat of chats) {
    const rtl = isRtl(chat.title);
    children.push(new Paragraph({
      children: [new TextRun({ text: chat.title, bold: true, size: 30, rightToLeft: rtl || undefined })],
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore: true,
      spacing: { after: 100 },
      bidirectional: rtl || undefined,
      alignment: rtl ? AlignmentType.RIGHT : undefined,
    }));
    if (chat.url) {
      children.push(new Paragraph({
        children: [new ExternalHyperlink({
          children: [new TextRun({ text: chat.url, style: 'Hyperlink', size: 16 })],
          link: chat.url,
        })],
        spacing: { after: 200 },
      }));
    }
    for (const message of chat.messages) {
      const msgRtl = isRtl(message.text || message.markdown);
      children.push(new Paragraph({
        children: [new TextRun({
          text: message.label.toUpperCase(),
          bold: true, size: 17, color: message.role === 'user' ? '6B7280' : '2563EB',
        })],
        spacing: { before: 240, after: 90 },
        keepNext: true,
        bidirectional: msgRtl || undefined,
        alignment: msgRtl ? AlignmentType.RIGHT : undefined,
      }));
      children.push(...markdownToParagraphs(message.markdown || message.text || '', ctx));
    }
  }

  return new Document({
    creator: 'AI Chat Extractor',
    title,
    numbering: {
      config: [{
        reference: 'ace-ordered',
        levels: [0, 1, 2, 3].map((level) => ({
          level,
          format: ['decimal', 'lowerLetter', 'lowerRoman', 'decimal'][level],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: { default: { document: { run: { font: opts.font || 'Calibri', size: 22 }, paragraph: { spacing: { line: 280 } } } } },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(0.9), bottom: convertInchesToTwip(0.9), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } },
      },
      children,
    }],
  });
}

/** Node-side convenience: build and pack to a Buffer. */
async function buildMergedDocx(sources, opts = {}) {
  return Packer.toBuffer(buildMergedDocument(sources, opts));
}

module.exports = {
  buildMergedMarkdown,
  buildMergedText,
  buildMergedHtml,
  buildMergedDocx,
  buildMergedDocument,
  normaliseAll,
  slugFor,
};
