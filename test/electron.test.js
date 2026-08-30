/**
 * Electron-side tests: runs the real injected extractor against DOM fixtures
 * that reproduce the failure modes worth caring about (virtualised message
 * lists, collapsed reasoning, clamped text, unrecognised markup), then
 * exercises the PDF and screenshot capture paths and boots the real UI.
 *
 *   npm run test:electron
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { PROVIDERS, COMMON_STRIP, COMMON_EXPAND } = require('../src/shared/providers');
const capture = require('../src/main/lib/capture');
const inject = require('../src/main/lib/inject');
const convert = require('../src/main/lib/convert');
const { renderHtml } = require('../src/main/lib/render');

// Electron builds for Windows are GUI-subsystem binaries and have no console
// attached, so results are written to a file the runner prints afterwards.
const REPORT = path.join(__dirname, 'results.txt');
const lines = [];
let failures = 0;
try {
  fs.unlinkSync(REPORT);
} catch {
  /* no previous report */
}

// Flushed line by line: if a check wedges the run, the report still shows
// exactly how far it got.
function say(line) {
  lines.push(line);
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

function buildSource(pack) {
  return inject.buildExtractorSource({
    pack: pack || {},
    commonStrip: COMMON_STRIP,
    commonExpand: COMMON_EXPAND,
    embedImages: true,
    debug: true,
    settleMs: 120,
    maxScrollSteps: 400,
    maxImageBytes: 12 * 1024 * 1024,
    maxTotalImageBytes: 150 * 1024 * 1024,
  });
}

// One window is reused for every fixture. Creating and tearing down a window
// per fixture proved unstable on this machine's GPU stack.
let fixtureWin = null;
function getFixtureWindow() {
  if (fixtureWin && !fixtureWin.isDestroyed()) return fixtureWin;
  fixtureWin = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Matches the real webview: without this, a hidden window throttles the
      // fixture's scroll listener and the virtualiser lags behind the harvester.
      backgroundThrottling: false,
    },
  });
  fixtureWin.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Security Warning/.test(message)) say(`    [page console] ${message}`);
  });
  return fixtureWin;
}

async function runExtractor(fixture, pack) {
  const win = getFixtureWindow();
  await win.loadFile(path.join(__dirname, 'fixtures', fixture));
  await new Promise((r) => setTimeout(r, 300));

  // executeJavaScript reports any throw as a generic "Script failed to execute",
  // so wrap the injection to surface the actual stack.
  const body = (await buildSource(pack)).trim().replace(/;\s*$/, '');
  const wrapped = `(async () => { try { return await (${body}); } catch (e) { return { ok:false, error: String((e && e.stack) || e) }; } })()`;
  let result;
  try {
    result = await win.webContents.executeJavaScript(wrapped, true);
  } catch (err) {
    result = { ok: false, error: `executeJavaScript rejected: ${err.message}` };
  }
  return result;
}

// Headless CI-ish runs on flaky GPU drivers crash during window churn.
app.disableHardwareAcceleration();

// Without a listener here, Electron quits the moment the last test window is
// destroyed — which would abort the run before the capture checks and before
// the report is written.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const outDir = path.join(app.getPath('temp'), 'ace-test-output');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    /* --------------- fixture 1: ChatGPT-shaped, pack-driven -------------- */
    const chatgpt = PROVIDERS.find((p) => p.id === 'chatgpt');
    const r1 = await runExtractor('fixture-chatgpt.html', chatgpt);

    check('chatgpt: extraction succeeded', r1.ok === true, r1.error || '');
    check('chatgpt: 6 messages', r1.messages.length === 6, `got ${r1.messages.length}`);
    check('chatgpt: roles alternate correctly',
      r1.messages.map((m) => m.role).join(',') === 'user,assistant,user,assistant,user,assistant',
      r1.messages.map((m) => m.role).join(','));
    check('chatgpt: document order preserved',
      r1.messages[0].text.includes('What is quicksort') && r1.messages[5].text.includes('You are welcome'));
    check('chatgpt: provider suffix trimmed from title', r1.title === 'Sorting algorithms', r1.title);
    check('chatgpt: UI buttons stripped from content',
      !r1.messages.some((m) => /Regenerate|Copy/.test(m.text)));
    check('chatgpt: svg stripped', !r1.messages.some((m) => m.html.includes('<svg')));
    check('chatgpt: code block kept with its language',
      r1.messages[1].html.includes('language-python') && r1.messages[1].html.includes('def qs'));
    check('chatgpt: collapsed <details> reasoning expanded and captured',
      r1.messages[1].thinkingHtml.includes('partitioning first'), r1.messages[1].thinkingHtml.slice(0, 80));
    check('chatgpt: reasoning kept out of the message body',
      !r1.messages[1].text.includes('partitioning first'), r1.messages[1].text.slice(0, 80));
    check('chatgpt: reasoning summary label dropped',
      !r1.messages[1].thinkingHtml.includes('Thought for 4 seconds'));
    check('chatgpt: line-clamped text captured in full',
      r1.messages[3].text.includes('naive first-element pivot'), r1.messages[3].text.slice(0, 80));
    check('chatgpt: inline image preserved', r1.messages[1].html.includes('data:image/png;base64'));

    /* --------------- fixture 2: virtualised list ------------------------- */
    const r2 = await runExtractor('fixture-virtual.html', chatgpt);
    check('virtualised: extraction succeeded', r2.ok === true, r2.error || '');
    check('virtualised: all 24 messages harvested across the scroll',
      r2.messages.length === 24, `got ${r2.messages.length}`);
    const seq = r2.messages.map((m) => {
      const match = /zulu-(\d+)-alpha/.exec(m.text);
      return match ? Number(match[1]) : -1;
    });
    check('virtualised: reassembled in document order', seq.every((n, i) => n === i + 1), seq.join(','));
    check('virtualised: no duplicated turns', new Set(seq).size === seq.length);
    if (r2.messages.length !== 24) for (const l of r2.log) say(`    [scroll] ${l}`);

    /* --------------- fixture 3: unknown site, heuristic ------------------ */
    const r3 = await runExtractor('fixture-unknown.html', {});
    check('unknown site: extraction succeeded', r3.ok === true, r3.error || '');
    check('unknown site: heuristic found all 6 turns',
      r3.messages.length === 6, `got ${r3.messages.length} :: ${(r3.log || []).join(' / ')}`);
    check('unknown site: nav and footer excluded',
      !r3.messages.some((m) => /Logout|Some AI company/.test(m.text)),
      r3.messages.map((m) => m.text.slice(0, 20)).join(' | '));
    check('unknown site: roles inferred from styling',
      r3.messages[0].role === 'user' && r3.messages[1].role === 'assistant',
      r3.messages.map((m) => m.role).join(','));

    /* --------------- code-block toolbars ------------------------------- */
    // Several front-ends put a language label and copy button inside the <pre>.
    // Left there they become part of the code itself.
    const r4 = await runExtractor('fixture-codeblock.html', chatgpt);
    check('code toolbar: extraction succeeded', r4.ok === true, r4.error || '');
    const answer = r4.messages?.[1]?.html || '';
    check('code toolbar: header markup removed from the code block',
      !/code-header|language-label/.test(answer), answer.slice(0, 160));
    check('code toolbar: label text not prepended to the code',
      /<code[^>]*>1: 92/.test(answer), answer.slice(0, 300));
    check('code toolbar: language recovered from the label',
      /language-python/.test(answer), (answer.match(/language-[a-z]+/g) || []).join(','));
    check('code toolbar: an already-labelled block keeps its language',
      /language-js/.test(answer));
    check('code toolbar: code content itself is intact',
      answer.includes('def roll()') && answer.includes('const x = 1;'));

    /* --------------- one element holding both speakers ----------------- */
    // GapGPT-style: each match is a whole exchange with no classes to tell the
    // two halves apart, only the fact that the answer is rendered markdown.
    const gap = PROVIDERS.find((p) => p.id === 'gapgpt');
    const r5 = await runExtractor('fixture-exchange.html', gap);
    check('exchange: extraction succeeded', r5.ok === true, r5.error || '');
    check('exchange: both speakers recovered, not merged',
      r5.messages?.length === 8, `got ${r5.messages?.length}`);
    check('exchange: roles alternate question then answer',
      r5.messages?.map((m) => m.role).join(',') ===
        'user,assistant,user,assistant,user,assistant,user,assistant',
      r5.messages?.map((m) => m.role).join(','));
    check('exchange: the user question is present on its own',
      r5.messages?.[0]?.text.includes('تنظیمات پیشنهادی من'), r5.messages?.[0]?.text.slice(0, 50));
    check('exchange: the answer is present on its own',
      r5.messages?.[1]?.text.includes('قابل اجرا'), r5.messages?.[1]?.text.slice(0, 50));
    check('exchange: question and answer are not fused',
      !r5.messages?.[0]?.text.includes('قابل اجرا'), r5.messages?.[0]?.text.slice(0, 60));
    check('exchange: code survives inside the answer',
      r5.messages?.[3]?.html.includes('def roll()'));
    check('exchange: code toolbar stripped here too',
      !/code-header|language-label/.test(r5.messages?.[3]?.html || ''));

    const lastAnswer = r5.messages?.[5]?.html || '';
    check('collapsed block: the disclosure header is not treated as content',
      !/expandable-header|toggle-icon/.test(lastAnswer) &&
      !(r5.messages?.[5]?.text || '').includes('مشاهده مراحل استنتاج'),
      (r5.messages?.[5]?.text || '').slice(0, 70));
    check('collapsed block: content hidden by the site is still captured',
      lastAnswer.includes('Planning the explanation'));
    // Capturing collapsed content is pointless if it stays hidden in the file.
    check('collapsed block: inline display:none removed so it is visible',
      !/display:\s*none/i.test(lastAnswer),
      (lastAnswer.match(/style="[^"]*"/g) || []).join(' '));
    check('collapsed block: the answer itself is intact',
      lastAnswer.includes('explanation in English'));

    // An image-generation reply has no markdown at all, and the picture sits
    // inside a button so it can be clicked to enlarge. Stripping buttons as
    // chrome used to take the picture with it and lose the whole reply.
    const imageReply = r5.messages?.[7]?.html || '';
    check('image reply: the exchange was still split',
      r5.messages?.length === 8, `got ${r5.messages?.length}`);
    check('image reply: the prompt is its own user message',
      (r5.messages?.[6]?.text || '').includes('یک تصویر'), (r5.messages?.[6]?.text || '').slice(0, 40));
    check('image reply: the picture survived the strip list',
      imageReply.includes('<img') && imageReply.includes('data:image/png'),
      imageReply.slice(0, 120));
    check('image reply: the alt text came with it', imageReply.includes('a generated cat'));
    check('image reply: action buttons with no content still stripped',
      !/Download|Regenerate/.test(imageReply), imageReply.slice(0, 160));

    /* --------------- attachments beside the text ----------------------- */
    // A screenshot attached to a question sits outside the pack's content
    // selector, so narrowing the turn to that selector used to drop it.
    const r6 = await runExtractor('fixture-attachment.html', chatgpt);
    check('attachment: extraction succeeded', r6.ok === true, r6.error || '');
    check('attachment: all four turns read', r6.messages?.length === 4, `got ${r6.messages?.length}`);
    check('attachment: the attached picture is kept',
      (r6.messages?.[0]?.html || '').includes('<img'), (r6.messages?.[0]?.html || '').slice(0, 130));
    check('attachment: its alt text came with it',
      (r6.messages?.[0]?.html || '').includes('Screenshot of the settings window'));
    check('attachment: the question text is still there',
      (r6.messages?.[0]?.text || '').includes('dialog'), (r6.messages?.[0]?.text || '').slice(0, 60));
    check('attachment: a picture below the text is kept too',
      (r6.messages?.[2]?.html || '').includes('Second screenshot'));
    check('attachment: document order preserved when text comes first',
      (r6.messages?.[2]?.html || '').indexOf('And this one') <
        (r6.messages?.[2]?.html || '').indexOf('<img'));
    check('attachment: replies without attachments are unaffected',
      (r6.messages?.[1]?.text || '').includes('confirm before continuing'));

    if (fixtureWin && !fixtureWin.isDestroyed()) fixtureWin.destroy();

    /* --------------- capture paths --------------------------------------- */
    const prepared = convert.prepare({ ...r1, providerName: 'ChatGPT' },
      { includeThinking: true, includeSystem: true, redactions: [] });
    const html = renderHtml(prepared, { theme: 'light' });

    const pdf = await capture.pdfFromHtml(html, { pageSize: 'A4', marginInches: 0.5, pageNumbers: true }, prepared.title);
    check('pdf: produced a real PDF', Buffer.isBuffer(pdf) && pdf.slice(0, 5).toString() === '%PDF-', `${pdf.length} bytes`);
    fs.writeFileSync(path.join(outDir, 'sample.pdf'), pdf);

    say('  … starting png capture');
    const shot = await capture.screenshotHtml(html, {
      format: 'png',
      viewportWidth: 900,
      trace: (m) => say(`    [capture] ${m}`),
    });
    say('  … png capture returned');
    check('png: produced a real PNG', shot.images[0].slice(1, 4).toString() === 'PNG', `${shot.images[0].length} bytes`);
    check('png: captured beyond the viewport', shot.height > 700, `full height ${shot.height}px`);
    fs.writeFileSync(path.join(outDir, 'sample.png'), shot.images[0]);

    const jpg = await capture.screenshotHtml(html, { format: 'jpeg', quality: 85, viewportWidth: 900 });
    check('jpeg: produced a real JPEG', jpg.images[0][0] === 0xff && jpg.images[0][1] === 0xd8);

    /* --------------- the real UI boots ----------------------------------- */
    const appErrors = [];
    const win = new BrowserWindow({
      show: false, width: 1500, height: 950,
      webPreferences: {
        preload: path.join(ROOT, 'src', 'preload', 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false, webviewTag: true,
      },
    });
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) appErrors.push(message);
    });
    win.webContents.on('preload-error', (_e, _p, err) => appErrors.push(`preload: ${err.message}`));
    await win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 1200));
    const ui = await win.webContents.executeJavaScript(`(() => ({
      hasApi: typeof window.ace === 'object',
      tabs: document.querySelectorAll('.tab').length,
      formats: document.querySelectorAll('#formats input').length,
      webviewPresent: !!document.getElementById('view'),
    }))()`);
    check('ui: preload bridge exposed', ui.hasApi === true);
    check('ui: all five tabs rendered', ui.tabs === 5, String(ui.tabs));
    check('ui: ten formats offered', ui.formats === 10, String(ui.formats));
    check('ui: webview element present', ui.webviewPresent === true);
    // Two expected messages are filtered out:
    //  - settings:get rejects because this harness skips main.js, so none of
    //    the IPC handlers it registers exist;
    //  - the allowpopups notice is a development-only warning about a setting
    //    the app needs deliberately, so third-party sign-in popups work.
    const unexpected = appErrors.filter(
      (m) => !/No handler registered|settings:get|Security Warning \(allowpopups\)/.test(m)
    );
    check('ui: no unexpected console errors', unexpected.length === 0, unexpected.join(' | '));
    win.destroy();

    say(`\nSample output written to ${outDir}`);
  } catch (err) {
    failures++;
    say('FAIL  harness threw — ' + (err.stack || err));
  }

  say(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  app.exit(failures === 0 ? 0 : 1);
});
