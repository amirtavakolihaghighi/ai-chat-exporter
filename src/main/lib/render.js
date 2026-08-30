'use strict';

/**
 * Renders a prepared conversation into a standalone HTML document.
 *
 * Used both for the .html export and as the print source for the "clean" PDF,
 * so the stylesheet carries real print rules (page breaks, link expansion)
 * rather than relying on whatever the original site shipped.
 */

const THEMES = {
  light: { bg: '#ffffff', fg: '#1a1a1a', muted: '#6b7280', line: '#e5e7eb', userBg: '#f3f4f6', asstBg: '#ffffff', accent: '#2563eb', codeBg: '#f6f8fa', font: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  dark: { bg: '#0f1115', fg: '#e6e6e6', muted: '#9aa0aa', line: '#262b33', userBg: '#171a20', asstBg: '#0f1115', accent: '#6ea8fe', codeBg: '#161a21', font: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' },
  serif: { bg: '#fdfcf9', fg: '#22201c', muted: '#7a736a', line: '#e6e0d6', userBg: '#f5f1e8', asstBg: '#fdfcf9', accent: '#8a5a2b', codeBg: '#f2eee5', font: 'Georgia, "Iowan Old Style", "Times New Roman", serif' },
};

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stylesheet(theme, opts) {
  const t = THEMES[theme] || THEMES.light;
  return `
:root { color-scheme: ${theme === 'dark' ? 'dark' : 'light'}; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0;
  background: ${t.bg}; color: ${t.fg};
  font-family: ${t.font};
  font-size: ${opts.fontSize || 15}px; line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: ${opts.pageWidth || 820}px; margin: 0 auto; padding: 40px 28px 80px; }
header.doc { border-bottom: 2px solid ${t.line}; padding-bottom: 18px; margin-bottom: 28px; }
header.doc h1 { margin: 0 0 10px; font-size: 1.8em; line-height: 1.25; font-weight: 650; }
.meta { color: ${t.muted}; font-size: .82em; display: flex; flex-wrap: wrap; gap: 6px 16px; }
.meta a { color: ${t.muted}; word-break: break-all; }

.turn { padding: 18px 0; border-bottom: 1px solid ${t.line}; break-inside: avoid-page; }
.turn:last-child { border-bottom: 0; }
.turn.user { background: ${t.userBg}; margin: 0 -16px; padding-left: 16px; padding-right: 16px; border-radius: 8px; }
.role {
  font-size: .72em; font-weight: 700; letter-spacing: .09em; text-transform: uppercase;
  color: ${t.accent}; margin-bottom: 8px; display: flex; gap: 10px; align-items: baseline;
}
.turn.user .role { color: ${t.muted}; }
.role .num { font-weight: 400; opacity: .6; letter-spacing: 0; }

.body > *:first-child { margin-top: 0; }
.body > *:last-child { margin-bottom: 0; }
.body p { margin: 0 0 .85em; }
.body h1, .body h2, .body h3, .body h4 { line-height: 1.3; margin: 1.4em 0 .5em; break-after: avoid-page; }
.body h1 { font-size: 1.45em; } .body h2 { font-size: 1.28em; } .body h3 { font-size: 1.12em; }
.body ul, .body ol { margin: 0 0 .85em; padding-left: 1.5em; }
.body li { margin: .25em 0; }
.body a { color: ${t.accent}; }
.body img { max-width: 100%; height: auto; border-radius: 6px; margin: .5em 0; }
.body blockquote {
  margin: .8em 0; padding: .1em 0 .1em 1em;
  border-left: 3px solid ${t.line}; color: ${t.muted};
}
.body code {
  font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace;
  font-size: .88em; background: ${t.codeBg}; padding: .15em .38em; border-radius: 4px;
}
.body pre {
  background: ${t.codeBg}; border: 1px solid ${t.line}; border-radius: 8px;
  padding: 12px 14px; overflow-x: auto; margin: .8em 0; break-inside: avoid-page;
}
.body pre code { background: none; padding: 0; font-size: .86em; line-height: 1.5; }
.body table { border-collapse: collapse; width: 100%; margin: .8em 0; font-size: .92em; }
.body th, .body td { border: 1px solid ${t.line}; padding: 6px 10px; text-align: left; vertical-align: top; }
.body th { background: ${t.codeBg}; font-weight: 650; }

details.thinking {
  margin: 0 0 12px; border: 1px dashed ${t.line}; border-radius: 8px;
  padding: 8px 12px; background: ${t.codeBg}; font-size: .93em;
}
details.thinking summary {
  cursor: pointer; color: ${t.muted}; font-size: .82em;
  text-transform: uppercase; letter-spacing: .07em; font-weight: 650;
}
details.thinking[open] summary { margin-bottom: 8px; }

footer.doc { margin-top: 40px; padding-top: 16px; border-top: 1px solid ${t.line}; color: ${t.muted}; font-size: .78em; }

@media print {
  body { background: #fff; color: #000; font-size: ${(opts.fontSize || 15) - 1}px; }
  .wrap { max-width: none; padding: 0; }
  .turn.user { background: #f4f4f5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .body pre { background: #f6f8fa !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; white-space: pre-wrap; word-break: break-word; }
  details.thinking { break-inside: avoid-page; }
  details.thinking[open] > summary ~ * { display: block; }
  ${opts.expandLinks ? `.body a[href^="http"]::after { content: " (" attr(href) ")"; font-size: .8em; color: #555; word-break: break-all; }` : ''}
  ${opts.pageBreakPerTurn ? '.turn { break-after: page; }' : ''}
}`.trim();
}

/**
 * @param {object} conversation  output of convert.prepare()
 * @param {object} opts          theme, fontSize, includeMeta, forPrint, …
 */
function renderHtml(conversation, opts = {}) {
  const options = {
    theme: 'light',
    fontSize: 15,
    includeMeta: true,
    includeThinking: true,
    expandLinks: false,
    pageBreakPerTurn: false,
    ...opts,
  };

  const turns = conversation.messages
    .map((m) => {
      const thinking =
        options.includeThinking && m.thinkingHtml
          ? `<details class="thinking" open><summary>Reasoning</summary>${m.thinkingHtml}</details>`
          : '';
      // dir="auto" lets the browser pick direction per block from its first
      // strong character, so a Persian or Arabic conversation lays out
      // right-to-left without forcing that on the whole document — mixed
      // threads (Persian prose, LTR code blocks) come out correct either way.
      return [
        `<section class="turn ${escapeHtml(m.role)}">`,
        `<div class="role">${escapeHtml(m.label)}<span class="num">#${m.index + 1}</span></div>`,
        thinking,
        `<div class="body" dir="auto">${m.html}</div>`,
        '</section>',
      ].join('\n');
    })
    .join('\n');

  const captured = conversation.capturedAt
    ? new Date(conversation.capturedAt).toLocaleString()
    : new Date().toLocaleString();

  const meta = options.includeMeta
    ? `<div class="meta">
    <span>${escapeHtml(conversation.providerName || conversation.host || 'Unknown')}</span>
    <span>${conversation.messages.length} messages</span>
    <span>Exported ${escapeHtml(captured)}</span>
    ${conversation.url ? `<a href="${escapeHtml(conversation.url)}">${escapeHtml(conversation.url)}</a>` : ''}
  </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(conversation.title)}</title>
<meta name="generator" content="AI Chat Extractor">
<style>${stylesheet(options.theme, options)}</style>
</head>
<body>
<div class="wrap">
<header class="doc">
  <h1 dir="auto">${escapeHtml(conversation.title)}</h1>
  ${meta}
</header>
${turns}
<footer class="doc">Exported with AI Chat Extractor${conversation.url ? ` from <a href="${escapeHtml(conversation.url)}">${escapeHtml(conversation.url)}</a>` : ''}.</footer>
</div>
</body>
</html>`;
}

module.exports = { renderHtml, escapeHtml, THEMES };
