/**
 * Conversion-pipeline tests. Pure Node — no Electron APIs — so this runs fast
 * and covers the half of the app that turns captured markup into files.
 *
 *   npm test
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const convert = require('../src/main/lib/convert');
const { renderHtml } = require('../src/main/lib/render');
const { toDocx } = require('../src/main/exporters/docx');
const exporters = require('../src/main/exporters');
const { matchProvider, PROVIDERS } = require('../src/shared/providers');
const { imageSize } = require('../src/main/lib/imagesize');

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

// A 1x1 red PNG, to prove image embedding survives all the way into DOCX.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const raw = {
  ok: true,
  url: 'https://chatgpt.com/share/abc123def456',
  host: 'chatgpt.com',
  providerId: 'chatgpt',
  providerName: 'ChatGPT',
  title: 'Testing the exporter',
  capturedAt: new Date().toISOString(),
  stats: { messages: 3, characters: 100 },
  messages: [
    {
      index: 0,
      role: 'user',
      html: '<p>Explain <strong>quicksort</strong> and show code. My key is sk-SECRET-123.</p>',
      text: 'Explain quicksort and show code. My key is sk-SECRET-123.',
      thinkingHtml: '',
    },
    {
      index: 1,
      role: 'assistant',
      html: `<h2>Quicksort</h2>
<p>It is a <em>divide and conquer</em> sort with <code>O(n log n)</code> average time.</p>
<ul><li>Pick a pivot</li><li>Partition<ul><li>left &lt; pivot</li><li>right &ge; pivot</li></ul></li><li>Recurse</li></ul>
<ol><li>First</li><li>Second</li></ol>
<pre><code class="language-python">def qs(a):
    if len(a) &lt;= 1: return a
    return qs([x for x in a[1:] if x &lt; a[0]]) + [a[0]]</code></pre>
<blockquote><p>Worst case is O(n^2).</p></blockquote>
<table><thead><tr><th>Case</th><th>Time</th></tr></thead><tbody><tr><td>Best</td><td>n log n</td></tr><tr><td>Worst</td><td>n^2</td></tr></tbody></table>
<p>Complexity: <span data-tex="O(n \\log n)" data-display="0">$O(n \\log n)$</span></p>
<p><a href="https://example.com/x">reference</a></p>
<p><img alt="diagram" src="data:image/png;base64,${PNG}"></p>
<script>alert('xss')</script>`,
      text: 'Quicksort explanation',
      thinkingHtml: '<p>The user wants an algorithm walkthrough.</p>',
    },
    { index: 2, role: 'system', html: '<p>System note.</p>', text: 'System note.', thinkingHtml: '' },
  ],
};

/* ------------------------------------------------------- provider matching */

check('provider: chatgpt', matchProvider('https://chatgpt.com/share/x', PROVIDERS)?.id === 'chatgpt');
check('provider: claude', matchProvider('https://claude.ai/share/x', PROVIDERS)?.id === 'claude');
check('provider: gapgpt has its own pack, not the generic one',
  matchProvider('https://gapgpt.app/c/1', PROVIDERS)?.id === 'gapgpt',
  matchProvider('https://gapgpt.app/c/1', PROVIDERS)?.id);
check('provider: gapgpt pack knows the exchange holds both speakers',
  Boolean(matchProvider('https://gapgpt.app/c/1', PROVIDERS)?.exchangeAssistantSelector));
check('provider: unknown clone front-ends still use the generic pack',
  matchProvider('https://librechat.example.com/c/1', PROVIDERS)?.id === 'openui-clone');
check('provider: longest host match wins',
  matchProvider('https://chat.mistral.ai/chat/1', PROVIDERS)?.id === 'mistral');
check('provider: unknown host returns null',
  matchProvider('https://totally-unknown-site.xyz/a', PROVIDERS) === null);
check('provider: malformed url returns null', matchProvider('not a url', PROVIDERS) === null);

/* ------------------------------------------------ prepare, filter, redact */

const prepared = convert.prepare(raw, {
  includeThinking: true,
  includeSystem: false,
  redactions: [{ find: 'sk-SECRET-123', replace: '[key]', regex: false }],
});

check('prepare: system messages filtered out', prepared.messages.length === 2);
check('prepare: assistant labelled with the provider name', prepared.messages[1].label === 'ChatGPT');
check('sanitise: script tag stripped', !prepared.messages[1].html.toLowerCase().includes('<script'));
check('redact: secret gone from markdown', !prepared.messages[0].markdown.includes('SECRET'));
check('redact: secret gone from html', !prepared.messages[0].html.includes('SECRET'));
check('redact: secret gone from text', !prepared.messages[0].text.includes('SECRET'));
check('redact: replacement not markdown-escaped', prepared.messages[0].markdown.includes('[key]'),
  prepared.messages[0].markdown);

const badRegex = convert.prepare(raw, { redactions: [{ find: '([unclosed', replace: 'x', regex: true }] });
check('redact: an invalid user regex does not throw', badRegex.messages.length === 3);

/* ----------------------------------------------------------------- markdown */

const md = prepared.messages[1].markdown;
check('markdown: heading', md.includes('## Quicksort'));
check('markdown: fenced code keeps its language', md.includes('```python'));
check('markdown: nested list', md.includes('left < pivot'));
check('markdown: gfm table', md.includes('| Case |'));
check('markdown: blockquote', md.includes('> Worst case'));
check('markdown: katex converted back to TeX', md.includes('$O(n \\log n)$'));
check('markdown: link', md.includes('[reference](https://example.com/x)'));
check('markdown: image', md.includes('![diagram](data:image/png'));
check('markdown: reasoning captured separately',
  prepared.messages[1].thinkingMarkdown.includes('algorithm walkthrough'));

/* --------------------------------------------------------------- plain text */

const txt = convert.htmlToText(prepared.messages[1].html);
check('text: no tags survive', !/<[a-z]/i.test(txt));
check('text: entities decoded', txt.includes('left < pivot'));

/* ------------------------------------------------------------------- html */

const html = renderHtml(prepared, { theme: 'light' });
check('html: doctype', html.startsWith('<!DOCTYPE html>'));
check('html: title', html.includes('<title>Testing the exporter</title>'));
check('html: one section per turn', (html.match(/class="turn /g) || []).length === 2);
check('html: print stylesheet included', html.includes('@media print'));
check('html: reasoning rendered as a details block', html.includes('details class="thinking"'));
check('html: message bodies carry dir="auto" for RTL languages',
  (html.match(/class="body" dir="auto"/g) || []).length === 2);

const rtl = convert.prepare(
  { ...raw, title: 'سلام دنیا', messages: [{ index: 0, role: 'user', html: '<p>سلام، حال شما چطور است؟</p>', text: 'سلام', thinkingHtml: '' }] },
  {}
);
check('rtl: persian title survives rendering', renderHtml(rtl, {}).includes('سلام دنیا'));
check('rtl: persian body survives markdown conversion',
  rtl.messages[0].markdown.includes('حال شما چطور است'), rtl.messages[0].markdown);
for (const theme of ['light', 'dark', 'serif']) {
  check(`html: ${theme} theme renders`, renderHtml(prepared, { theme }).length > 1000);
}

/* -------------------------------------------------------------- filenames */

check('filename: illegal characters removed', exporters.safeName('a/b:c*d?"<>|') === 'a b c d');
check('filename: reserved device name escaped', exporters.safeName('CON') === '_CON');
check('filename: empty falls back', exporters.safeName('   ') === 'chat');
check('filename: trailing dot removed', exporters.safeName('report.') === 'report');
const fname = exporters.formatFilename('{date} - {provider} - {title}', prepared);
check('filename: template expanded',
  /^\d{4}-\d{2}-\d{2} - ChatGPT - Testing the exporter$/.test(fname), fname);
check('filename: {id} pulled from the share url',
  exporters.formatFilename('{id}', prepared) === 'abc123def456',
  exporters.formatFilename('{id}', prepared));

/* ------------------------------------------------------ document builders */

const mdDoc = exporters.buildMarkdown(prepared, { frontmatter: true });
check('markdown doc: frontmatter', mdDoc.startsWith('---\ntitle: "Testing the exporter"'));
check('markdown doc: tags for obsidian', mdDoc.includes('tags: [ai-chat, chatgpt]'));
check('markdown doc: frontmatter can be turned off',
  !exporters.buildMarkdown(prepared, { frontmatter: false }).startsWith('---'));

const jsonDoc = JSON.parse(exporters.buildJson(prepared));
check('json: schema and messages', jsonDoc.schema === 'ai-chat-extractor/v1' && jsonDoc.messages.length === 2);

check('text doc: includes both turns',
  exporters.buildText(prepared, {}).includes('[You]') && exporters.buildText(prepared, {}).includes('[ChatGPT]'));

/* ----------------------------------------------------------- image sizing */

check('imagesize: png dimensions read', JSON.stringify(imageSize(Buffer.from(PNG, 'base64'))) === '{"width":1,"height":1}');
check('imagesize: garbage returns null', imageSize(Buffer.alloc(4)) === null);

/* --------------------------------------------------------------- asset split */

const split = convert.extractDataUriAssets(`<img src="data:image/png;base64,${PNG}">`, 'chat_files');
check('assets: data uri extracted to a file', split.assets.length === 1 && split.assets[0].filename === 'image-001.png');
check('assets: html rewritten to the sidecar path', split.html.includes('src="chat_files/image-001.png"'));

const mdSidecar = exporters.markdownWithSidecarAssets(
  `text\n\n![diagram](data:image/png;base64,${PNG})\n\nmore`,
  'chat_files'
);
check('assets: markdown image extracted', mdSidecar.assets.length === 1);
check('assets: markdown rewritten to the sidecar path',
  mdSidecar.markdown.includes('![diagram](chat_files/image-001.png)'), mdSidecar.markdown.replace(/\n/g, ' '));
check('assets: markdown without images is untouched',
  exporters.markdownWithSidecarAssets('plain **text** only', 'x').markdown === 'plain **text** only');

/* ------------------------------------------------- per-message selection */

const selected = convert.prepare(raw, { selection: [1], includeSystem: true });
check('selection: only the chosen message is kept', selected.messages.length === 1);
check('selection: the right message was kept', selected.messages[0].role === 'assistant');
check('selection: original position retained', selected.messages[0].originalIndex === 1);
check('selection: exported indexes renumber from zero', selected.messages[0].index === 0);
check('selection: empty selection means no filter',
  convert.prepare(raw, { selection: [] }).messages.length === 3);
check('selection: combines with the system-message filter',
  convert.prepare(raw, { selection: [0, 2], includeSystem: false }).messages.length === 1);

/* ------------------------------------------------------ code extraction */

const { extractCodeBlocks, extensionFor } = require('../src/main/exporters/code');

check('code: language maps to extension', extensionFor('python') === 'py' && extensionFor('c++') === 'cpp');
check('code: unknown short language used verbatim', extensionFor('zig') === 'zig');
check('code: empty language falls back to txt', extensionFor('') === 'txt');

const codeResult = extractCodeBlocks(prepared, {});
check('code: found the python block', codeResult.files.length === 1, String(codeResult.files.length));
check('code: correct extension', codeResult.files[0].filename.endsWith('.py'), codeResult.files[0].filename);
check('code: content preserved', codeResult.files[0].content.includes('def qs(a)'));
check('code: manifest lists the file', codeResult.manifest.includes(codeResult.files[0].filename));

const headerNamed = convert.prepare({
  ...raw,
  messages: [{ index: 0, role: 'assistant', html: '<pre><code class="language-python"># src/server.py\nprint(1)</code></pre>', text: '', thinkingHtml: '' }],
}, {});
const headerFiles = extractCodeBlocks(headerNamed, {}).files;
check('code: filename taken from a path comment',
  headerFiles[0].filename.includes('server') && headerFiles[0].filename.endsWith('.py'),
  headerFiles[0].filename);

const multi = convert.prepare({
  ...raw,
  messages: [
    { index: 0, role: 'user', html: '<pre><code class="language-js">1</code></pre>', text: '', thinkingHtml: '' },
    { index: 1, role: 'assistant', html: '<pre><code class="language-js">2</code></pre>', text: '', thinkingHtml: '' },
  ],
}, {});
check('code: assistantOnly skips user snippets',
  extractCodeBlocks(multi, { assistantOnly: true }).files.length === 1);
check('code: filenames are unique across blocks',
  new Set(extractCodeBlocks(multi, {}).files.map((f) => f.filename)).size === 2);

/* ------------------------------------------------------ direction / bidi */

const { detectDirection, isRtl } = require('../src/shared/direction');
check('direction: persian is rtl', detectDirection('سلام دنیا') === 'rtl');
check('direction: arabic is rtl', detectDirection('مرحبا بالعالم') === 'rtl');
check('direction: hebrew is rtl', detectDirection('שלום עולם') === 'rtl');
check('direction: english is ltr', detectDirection('hello world') === 'ltr');
check('direction: digits alone are neutral', detectDirection('12345 -- ...') === 'neutral');
check('direction: a leading latin word does not flip persian text',
  isRtl('ChatGPT به من گفت که این روش بهتر است و باید آن را امتحان کنم'));
check('direction: a persian word does not flip english text',
  !isRtl('The Persian word سلام means hello in everyday conversation here'));

/* ---------------------------------------------------------------- merge */

const mergeMod = require('../src/main/exporters/merge');
const mergeSources = [
  { title: 'First chat', url: 'https://a/1', provider: 'ChatGPT', messages: [{ role: 'user', label: 'You', markdown: '# Q one', text: 'Q one' }] },
  { title: 'Second chat', url: 'https://a/2', provider: 'Claude', messages: [{ role: 'assistant', label: 'Claude', markdown: 'Answer **two**', text: 'Answer two' }] },
];

const mergedMd = mergeMod.buildMergedMarkdown(mergeSources, { documentTitle: 'My archive' });
check('merge md: document title', mergedMd.includes('# My archive'));
check('merge md: contents section', mergedMd.includes('## Contents'));
check('merge md: links each chat', mergedMd.includes('[First chat](#chat-1-first-chat)'));
check('merge md: anchors match the links', mergedMd.includes('<a id="chat-1-first-chat"></a>'));
check('merge md: includes both chats', mergedMd.includes('First chat') && mergedMd.includes('Second chat'));
check('merge md: includes message bodies', mergedMd.includes('Answer **two**'));

const mergedHtml = mergeMod.buildMergedHtml(mergeSources, { documentTitle: 'My archive' });
check('merge html: doctype', mergedHtml.startsWith('<!DOCTYPE html>'));
check('merge html: toc anchors resolve to article ids',
  mergedHtml.includes('href="#chat-2-second-chat"') && mergedHtml.includes('id="chat-2-second-chat"'));
check('merge html: markdown rendered to html', mergedHtml.includes('<strong>two</strong>'));
check('merge html: page break between chats', mergedHtml.includes('break-before:page'));

const mergedTxt = mergeMod.buildMergedText(mergeSources, { documentTitle: 'My archive' });
check('merge txt: contents listing', mergedTxt.includes('CONTENTS') && mergedTxt.includes('1. First chat'));
check('merge txt: no markup leaks', !/<[a-z]/i.test(mergedTxt));

check('merge: slugs are unique per position',
  mergeMod.slugFor('Same', 0) !== mergeMod.slugFor('Same', 1));
check('merge: non-latin titles still produce a usable slug',
  /^chat-1-/.test(mergeMod.slugFor('سلام دنیا', 0)), mergeMod.slugFor('سلام دنیا', 0));

/* ---------------------------------------------------------------------- docx */

(async () => {
  const buf = await toDocx(prepared, {});
  check('docx: produced', Buffer.isBuffer(buf) && buf.length > 5000, `${buf.length} bytes`);
  check('docx: is a zip', buf[0] === 0x50 && buf[1] === 0x4b);

  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  check('docx: heading text present', xml.includes('Quicksort'));
  check('docx: code text present', xml.includes('def qs(a)'));
  check('docx: table present', xml.includes('<w:tbl>'));
  check('docx: numbered list present', xml.includes('w:numPr'));
  check('docx: hyperlink present', xml.includes('Hyperlink'));
  const media = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !zip.files[f].dir);
  check('docx: image embedded', media.length === 1, media.join(','));
  check('docx: latin text is not marked right-to-left', !xml.includes('<w:bidi/>'));

  // --- bidi
  const persian = convert.prepare({
    ...raw,
    title: 'الگوریتم مرتب‌سازی',
    messages: [
      { index: 0, role: 'user', html: '<p>لطفاً الگوریتم مرتب‌سازی سریع را توضیح دهید.</p>', text: 'لطفاً الگوریتم', thinkingHtml: '' },
      { index: 1, role: 'assistant', html: '<p>این یک الگوریتم تقسیم و حل است.</p><ul><li>یک محور انتخاب کنید</li></ul><pre><code class="language-python">def qs(a): return a</code></pre>', text: 'این یک الگوریتم', thinkingHtml: '' },
    ],
  }, {});
  const rtlBuf = await toDocx(persian, {});
  const rtlZip = await JSZip.loadAsync(rtlBuf);
  const rtlXml = await rtlZip.file('word/document.xml').async('string');
  check('docx bidi: paragraphs marked right-to-left', rtlXml.includes('<w:bidi/>'));
  check('docx bidi: runs marked right-to-left', rtlXml.includes('<w:rtl/>'));
  check('docx bidi: paragraphs right-aligned', rtlXml.includes('w:val="right"'));
  check('docx bidi: persian text present', rtlXml.includes('الگوریتم'));
  check('docx bidi: code block still readable', rtlXml.includes('def qs(a)'));

  const mergedDocx = await mergeMod.buildMergedDocx(mergeSources, { documentTitle: 'My archive' });
  const mergedZip = await JSZip.loadAsync(mergedDocx);
  const mergedXml = await mergedZip.file('word/document.xml').async('string');
  check('merge docx: produced', Buffer.isBuffer(mergedDocx) && mergedDocx.length > 5000);
  check('merge docx: contents heading', mergedXml.includes('CONTENTS'));
  check('merge docx: lists both chats', mergedXml.includes('First chat') && mergedXml.includes('Second chat'));
  check('merge docx: page break before each chat', mergedXml.includes('w:pageBreakBefore'));

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-pipeline-'));
  fs.writeFileSync(path.join(outDir, 'sample.docx'), buf);
  fs.writeFileSync(path.join(outDir, 'sample.html'), html);
  fs.writeFileSync(path.join(outDir, 'sample.md'), mdDoc);
  console.log(`\nSample output written to ${outDir}`);
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
