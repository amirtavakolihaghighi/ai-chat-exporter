/**
 * Extension tests, run under Electron because the code has to be proved in a
 * real Chromium page — not a Node approximation of one.
 *
 * Covers three things Node-side tests cannot:
 *  1. the manifests are structurally valid for each browser;
 *  2. the *bundled* content script really extracts a conversation from a page;
 *  3. the export pipeline works in a browser context, where there is no Buffer
 *     and docx has to produce a Blob rather than a Node buffer.
 *
 *   npm run test:extension
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const EXT = path.join(__dirname, '..');
const ROOT = path.join(EXT, '..');
const REPORT = path.join(__dirname, 'results.txt');

try {
  fs.unlinkSync(REPORT);
} catch {
  /* no previous report */
}

let failures = 0;
function say(line) {
  console.log(line);
  try {
    fs.appendFileSync(REPORT, line + '\n', 'utf8');
  } catch {
    /* reporting must never break the run */
  }
}
function check(name, cond, extra = '') {
  if (!cond) failures++;
  say(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

/* --------------------------------------------------------------- manifests */

function checkManifests() {
  for (const target of ['chrome', 'firefox']) {
    const file = path.join(EXT, `manifest.${target}.json`);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      check(`${target}: manifest parses`, false, err.message);
      continue;
    }

    check(`${target}: manifest v3`, manifest.manifest_version === 3);
    check(`${target}: has a name and version`, Boolean(manifest.name && manifest.version));
    check(`${target}: declares the permissions it uses`,
      ['scripting', 'downloads', 'storage', 'tabs'].every((p) => manifest.permissions.includes(p)),
      manifest.permissions.join(','));
    check(`${target}: requests host access`, manifest.host_permissions?.includes('<all_urls>'));
    check(`${target}: popup wired up`, manifest.action?.default_popup === 'popup.html');

    // The one structural difference between the two browsers: Chrome runs the
    // background as a service worker, Firefox as an event page.
    if (target === 'chrome') {
      check('chrome: background is a service worker', manifest.background?.service_worker === 'background.js');
      check('chrome: no firefox-only keys', !manifest.browser_specific_settings);
    } else {
      check('firefox: background is an event page', Array.isArray(manifest.background?.scripts));
      check('firefox: no chrome-only service_worker key', !manifest.background?.service_worker);
      check('firefox: has a gecko id', Boolean(manifest.browser_specific_settings?.gecko?.id));
    }

    // Every file the manifest names must actually be produced by the build.
    const dist = path.join(EXT, 'dist', target);
    const referenced = [
      manifest.action.default_popup,
      target === 'chrome' ? manifest.background.service_worker : manifest.background.scripts[0],
      ...Object.values(manifest.icons),
      ...manifest.web_accessible_resources.flatMap((r) => r.resources),
    ];
    const missing = referenced.filter((f) => !fs.existsSync(path.join(dist, f)));
    check(`${target}: every file the manifest names was built`, missing.length === 0, missing.join(', '));

    for (const extra of ['panel.html', 'panel.js', 'panel.css', 'popup.js', 'popup.css', 'content.js', 'print.js']) {
      if (!fs.existsSync(path.join(dist, extra))) {
        check(`${target}: ${extra} built`, false);
      }
    }
  }

  // MV3 forbids remote code, so nothing may be pulled in at runtime, and no
  // Node built-in may survive into a bundle.
  for (const target of ['chrome', 'firefox']) {
    for (const file of ['panel.js', 'content.js', 'background.js']) {
      const full = path.join(EXT, 'dist', target, file);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, 'utf8');
      check(`${target}/${file}: no node built-ins bundled`,
        !/require\(["'](fs|path|os|crypto|node:)/.test(source));
      check(`${target}/${file}: no remote script loading`, !/importScripts\s*\(/.test(source));
    }
  }
}

/* ------------------------------------------------------------------ bundles */

async function bundleTestEntry() {
  const outfile = path.join(__dirname, '.browser-bundle.js');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'browser-entry.js')],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    inject: [path.join(EXT, 'src/lib/node-shim.js')],
  });
  return fs.readFileSync(outfile, 'utf8');
}

/* ------------------------------------------------------------- filenames */

function checkFilenames() {
  const src = fs.readFileSync(path.join(EXT, 'src', 'lib', 'download.js'), 'utf8');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', src)(() => ({ api: {} }), mod, mod.exports);
  const { safeSegment, asciiFallback } = mod.exports;

  const BACKSLASH = String.fromCharCode(92);
  const hostile = [
    ['backslash', 'a' + BACKSLASH + 'b'],
    ['forward slash', 'a/b'],
    ['colon and question mark', 'Sorting: which algo?'],
    ['newline', 'line' + String.fromCharCode(10) + 'break'],
    ['leading dot', '  .hidden  '],
    ['trailing dot', 'report.'],
    ['reserved device name', 'CON'],
    ['blank', '   '],
    ['bidi marks', String.fromCharCode(0x200f) + 'سلام' + String.fromCharCode(0x200e) + ' دنیا'],
    ['zero-width joiner', 'می' + String.fromCharCode(0x200c) + 'شود'],
    ['emoji', 'chat 🎉 log'],
    ['very long', 'x'.repeat(400)],
  ];

  // Exactly the rules the downloads API enforces, and which it reports only as
  // an unhelpful "Invalid filename".
  const codePoints = (name) => [...name].map((c) => c.codePointAt(0));
  const acceptable = (name) =>
    name.length > 0 &&
    [...name].length <= 100 &&
    !codePoints(name).some((c) => c < 32 || c === 127) &&
    ![...'<>:"|?*/'].some((c) => name.includes(c)) &&
    !name.includes(BACKSLASH) &&
    !' .'.includes(name[0]) &&
    !' .'.includes(name[name.length - 1]);

  for (const [label, input] of hostile) {
    check(`filename: ${label}`, acceptable(safeSegment(input)), JSON.stringify(safeSegment(input)));
  }
  check('filename: persian survives intact', safeSegment('سلام دنیا') === 'سلام دنیا');
  const fallback = asciiFallback('سلام دنیا.md');
  check('filename: ascii fallback is pure ascii',
    [...fallback].every((c) => c.codePointAt(0) >= 32 && c.codePointAt(0) <= 126), fallback);
  check('filename: ascii fallback keeps the extension', asciiFallback('سلام.md').endsWith('.md'));
}

app.whenReady().then(async () => {
  try {
    checkManifests();
    checkFilenames();

    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
    });
    const pageErrors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/Security Warning/.test(message)) pageErrors.push(message);
    });

    /* ---------- the bundled content script, against a real page ---------- */
    const contentBundle = fs.readFileSync(path.join(EXT, 'dist', 'chrome', 'content.js'), 'utf8');
    await win.loadFile(path.join(ROOT, 'test', 'fixtures', 'fixture-chatgpt.html'));
    await new Promise((r) => setTimeout(r, 300));

    const captured = await win.webContents.executeJavaScript(`(async () => {
      // Minimal extension API so the bundle can install its listener.
      const listeners = [];
      globalThis.chrome = {
        runtime: {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          sendMessage: async () => ({ ok: false }),
        },
      };
      ${contentBundle}
      if (!listeners.length) return { ok: false, error: 'content script registered no listener' };

      // Drive it exactly as the workspace page would.
      return await new Promise((resolve) => {
        const returned = listeners[0](
          { type: 'ace:capture', settings: { embedImages: false, settleMs: 120 }, userPacks: {} },
          {},
          resolve
        );
        if (returned !== true) resolve({ ok: false, error: 'listener did not signal an async response' });
      });
    })()`, true);

    check('content script: bundle installs and answers', captured?.ok === true, captured?.error || '');
    const result = captured?.result;
    check('content script: extraction succeeded', result?.ok === true, result?.error || '');
    check('content script: found all six messages', result?.messages?.length === 6, String(result?.messages?.length));
    check('content script: roles are right',
      result?.messages?.map((m) => m.role).join(',') === 'user,assistant,user,assistant,user,assistant',
      result?.messages?.map((m) => m.role).join(','));
    check('content script: reasoning captured separately',
      Boolean(result?.messages?.[1]?.thinkingHtml?.includes('partitioning first')));
    check('content script: reports which pack it used', typeof result?.packSource === 'string', result?.packSource);

    /* ---------- describe / ping, used by the popup ---------- */
    const described = await win.webContents.executeJavaScript(`(async () => {
      const listeners = [];
      globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({}) } };
      delete globalThis.__aceContentLoaded;
      ${contentBundle}
      let ping, describe;
      listeners[0]({ type: 'ace:ping' }, {}, (r) => { ping = r; });
      listeners[0]({ type: 'ace:describe', userPacks: {} }, {}, (r) => { describe = r; });
      return { ping, describe };
    })()`, true);
    check('content script: answers ping', described?.ping?.ok === true);
    // A file:// URL has an empty hostname, so identify the page by its URL.
    check('content script: describes the page',
      String(described?.describe?.url || '').includes('fixture-chatgpt'),
      JSON.stringify(described?.describe || {}).slice(0, 120));

    /* ---------- the export pipeline, in a browser context ---------- */
    const testBundle = await bundleTestEntry();
    await win.loadURL('about:blank');
    await win.webContents.executeJavaScript(testBundle, true);

    const exportChecks = await win.webContents.executeJavaScript(`(async () => {
      const { convert, renderHtml, buildDocument, extractCodeBlocks, merge, Packer, JSZip, exporters } = window.ACE;
      const raw = {
        ok: true, url: 'https://chatgpt.com/share/abc', host: 'chatgpt.com',
        providerId: 'chatgpt', providerName: 'ChatGPT', title: 'Browser side test',
        capturedAt: new Date().toISOString(), stats: { messages: 2 },
        messages: [
          { index: 0, role: 'user', html: '<p>Explain quicksort. key sk-SECRET-1</p>', text: 'Explain quicksort', thinkingHtml: '' },
          { index: 1, role: 'assistant',
            html: '<h2>Quicksort</h2><p>It is <strong>fast</strong>.</p>'
              + '<pre><code class="language-python">def qs(a): return a</code></pre>'
              + '<p><img alt="d" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="></p>',
            text: 'Quicksort', thinkingHtml: '' },
        ],
      };
      const prepared = convert.prepare(raw, { redactions: [{ find: 'sk-SECRET-1', replace: '[key]' }] });
      const out = {};

      out.markdown = exporters.buildMarkdown(prepared, { frontmatter: true });
      out.json = exporters.buildJson(prepared);
      out.text = exporters.buildText(prepared, {});
      out.html = renderHtml(prepared, { theme: 'light' });

      // Reported rather than thrown, so a failure here names the step that
      // broke instead of surfacing as an opaque null dereference.
      try {
        const docxBlob = await Packer.toBlob(buildDocument(prepared, {}));
        out.docxSize = docxBlob.size;
        out.docxType = docxBlob.type;
        const docxZip = await JSZip.loadAsync(await docxBlob.arrayBuffer());
        out.docxEntries = Object.keys(docxZip.files).slice(0, 12);
        const entry = docxZip.file('word/document.xml');
        out.docxXml = entry ? await entry.async('string') : '';
        out.docxMedia = Object.keys(docxZip.files).filter((f) => f.startsWith('word/media/') && !docxZip.files[f].dir).length;
      } catch (err) {
        out.docxError = String((err && err.stack) || err);
        out.docxXml = '';
        out.docxSize = 0;
        out.docxMedia = -1;
      }

      out.code = extractCodeBlocks(prepared, {}).files.map((f) => f.filename);

      const zip = new JSZip();
      zip.file('a.md', out.markdown);
      out.zipSize = (await zip.generateAsync({ type: 'blob' })).size;

      const mergedMd = merge.buildMergedMarkdown(
        [{ title: 'One', messages: [{ role: 'user', label: 'You', markdown: 'hello' }] },
         { title: 'Two', messages: [{ role: 'assistant', label: 'AI', markdown: 'world' }] }],
        { documentTitle: 'Archive' }
      );
      out.mergedMd = mergedMd;

      try {
        const persian = convert.prepare({ ...raw, title: 'سلام',
          messages: [{ index: 0, role: 'user', html: '<p>سلام دنیا چطوری</p>', text: 'سلام', thinkingHtml: '' }] }, {});
        const rtlBlob = await Packer.toBlob(buildDocument(persian, {}));
        const rtlZip = await JSZip.loadAsync(await rtlBlob.arrayBuffer());
        const entry = rtlZip.file('word/document.xml');
        out.rtlXml = entry ? await entry.async('string') : '';
      } catch (err) {
        out.rtlError = String((err && err.stack) || err);
        out.rtlXml = '';
      }

      return out;
    })()`, true);

    check('browser export: markdown built', exportChecks.markdown.includes('## ChatGPT'));
    check('browser export: fenced code kept its language', exportChecks.markdown.includes('```python'));
    check('browser export: redaction applied', !exportChecks.markdown.includes('SECRET'));
    check('browser export: json valid', JSON.parse(exportChecks.json).messages.length === 2);
    check('browser export: plain text has no tags', !/<[a-z]/i.test(exportChecks.text));
    check('browser export: html document built', exportChecks.html.startsWith('<!DOCTYPE html>'));

    check('browser export: docx produced as a Blob', exportChecks.docxSize > 5000,
      exportChecks.docxError || `${exportChecks.docxSize} bytes, entries: ${(exportChecks.docxEntries || []).join(',')}`);
    check('browser export: docx contains the text', exportChecks.docxXml.includes('Quicksort'));
    check('browser export: docx embedded the image without Buffer',
      exportChecks.docxMedia === 1, String(exportChecks.docxMedia));
    check('browser export: docx bidi works in the browser too',
      exportChecks.rtlXml.includes('<w:bidi/>') && exportChecks.rtlXml.includes('<w:rtl/>'),
      exportChecks.rtlError || '');

    check('browser export: code blocks extracted', exportChecks.code.length === 1 && exportChecks.code[0].endsWith('.py'),
      exportChecks.code.join(','));
    check('browser export: zip generated as a Blob', exportChecks.zipSize > 50, `${exportChecks.zipSize} bytes`);
    check('browser export: merged document has a table of contents',
      exportChecks.mergedMd.includes('## Contents') && exportChecks.mergedMd.includes('[One](#chat-1-one)'));

    check('browser: no unexpected console errors', pageErrors.length === 0, pageErrors.join(' | '));
    win.destroy();
  } catch (err) {
    failures++;
    say('FAIL  harness threw — ' + (err.stack || err));
  }

  try {
    fs.unlinkSync(path.join(__dirname, '.browser-bundle.js'));
  } catch {
    /* nothing to clean */
  }

  say(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  app.exit(failures === 0 ? 0 : 1);
});
