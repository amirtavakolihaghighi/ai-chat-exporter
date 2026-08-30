/**
 * End-to-end test. Boots the real application — real main process, real IPC
 * handlers, real preload bridge, real renderer — points the webview at a local
 * fixture, then drives the actual UI controls to produce files on disk.
 *
 * This is the test that would catch a broken wire between the layers, which the
 * unit-level suites cannot see.
 *
 *   npm run test:e2e
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow } = require('electron');

const REPORT = path.join(__dirname, 'e2e-results.txt');
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

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-e2e-'));
const fixture = path.join(__dirname, 'fixtures', 'fixture-chatgpt.html');

app.disableHardwareAcceleration();

// Point the app at a throwaway profile before it boots, so a test run never
// writes settings, saved site rules or library entries into the real one.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-userdata-'));
app.setPath('userData', userDataDir);

// Boot the real app. It registers every IPC handler and creates the window.
require('../src/main/main.js');

/**
 * Clears the results list, clicks Export, then waits for it to repopulate.
 * Clearing has to happen before the click, or a fast export can render into the
 * list and be wiped by the very code waiting for it.
 */
function clickExportAndWait(run, timeoutMs = 120000) {
  return run(`new Promise((resolve) => {
    const results = document.getElementById('results');
    results.innerHTML = '';
    document.getElementById('exportBtn').click();
    const started = Date.now();
    const poll = setInterval(() => {
      const done = !document.getElementById('exportBtn').disabled && results.children.length > 0;
      if (done) { clearInterval(poll); resolve(document.getElementById('status').textContent); }
      else if (Date.now() - started > ${timeoutMs}) { clearInterval(poll); resolve('timed out'); }
    }, 300);
  })`);
}

function windowReady() {
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const [win] = BrowserWindow.getAllWindows();
      if (win && !win.webContents.isLoading()) {
        clearInterval(poll);
        resolve(win);
      }
    }, 200);
  });
}

app.whenReady().then(async () => {
  let win;
  try {
    win = await windowReady();
    await new Promise((r) => setTimeout(r, 800)); // let the renderer finish init

    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/Security Warning/.test(message)) errors.push(message);
    });

    const run = (code) => win.webContents.executeJavaScript(code, true);

    /* ---------------- settings round-trip through real IPC -------------- */
    // Drive the actual controls rather than calling settings.save() directly:
    // the UI fields are the source of truth, and the export path reads them
    // back via collectOptions(), so a direct IPC save would be overwritten.
    const saved = await run(`(async () => {
      document.getElementById('outDir').value = ${JSON.stringify(outDir)};
      document.getElementById('filenameTpl').value = '{provider} - {title}';
      document.getElementById('settleMs').value = '150';
      document.getElementById('optThinking').checked = true;
      document.getElementById('openAfter').checked = false;
      for (const el of ['outDir','filenameTpl','settleMs','optThinking','openAfter']) {
        document.getElementById(el).dispatchEvent(new Event('change', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 600));
      return window.ace.settings.get();
    })()`);
    check('settings: UI changes persisted through IPC', saved.outDir === outDir, saved.outDir);
    check('settings: filename template persisted', saved.filenameTemplate === '{provider} - {title}',
      saved.filenameTemplate);

    /* ---------------- load the fixture into the real webview ------------ */
    const fixtureUrl = 'file:///' + fixture.replace(/\\/g, '/');
    await run(`(() => {
      const v = document.getElementById('view');
      document.getElementById('placeholder').style.display = 'none';
      v.src = ${JSON.stringify(fixtureUrl)};
      return true;
    })()`);

    const loaded = await run(`new Promise((resolve) => {
      const v = document.getElementById('view');
      if (!v.isLoading || !v.isLoading()) { setTimeout(() => resolve('already'), 500); return; }
      const done = () => resolve('loaded');
      v.addEventListener('did-stop-loading', done, { once: true });
      setTimeout(() => resolve('timeout'), 20000);
    })`);
    check('webview: fixture loaded in the embedded browser', loaded !== 'timeout', String(loaded));
    await new Promise((r) => setTimeout(r, 600));

    /* ---------------- click "Read this chat" ---------------------------- */
    await run(`document.getElementById('extractBtn').click()`);
    const extracted = await run(`new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        const status = document.getElementById('extractStatus');
        const ready = !document.getElementById('exportBtn').disabled;
        if (ready || /failed|No messages/i.test(status.textContent)) {
          clearInterval(poll);
          resolve({ ready, status: status.textContent });
        } else if (Date.now() - started > 60000) {
          clearInterval(poll);
          resolve({ ready: false, status: 'timed out: ' + status.textContent });
        }
      }, 300);
    })`);
    check('extract: UI reported a successful read', extracted.ready === true, extracted.status);
    check('extract: message count surfaced to the user',
      /6 messages/.test(extracted.status), extracted.status);

    const preview = await run(`document.querySelectorAll('#previewList .pv').length`);
    check('extract: preview rendered one entry per message', preview === 6, String(preview));

    // Regression guard: the overlay sets display:flex, which outranks the
    // [hidden] attribute, so it once stayed up over the page after finishing.
    const overlay = await run(`getComputedStyle(document.getElementById('busy')).display`);
    check('ui: busy overlay dismissed once reading finished', overlay === 'none', overlay);

    /* ---------------- choose formats and export ------------------------- */
    await run(`(() => {
      for (const input of document.querySelectorAll('#formats input')) {
        input.checked = ['md','html','txt','json','docx','pdf'].includes(input.value);
      }
      document.getElementById('openAfter').checked = false;
      return true;
    })()`);

    await run(`document.getElementById('exportBtn').click()`);
    const exported = await run(`new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        const done = !document.getElementById('exportBtn').disabled
          && document.getElementById('results').children.length > 0;
        if (done) {
          clearInterval(poll);
          resolve(document.getElementById('status').textContent);
        } else if (Date.now() - started > 120000) {
          clearInterval(poll);
          resolve('timed out');
        }
      }, 400);
    })`);
    check('export: completed without error', !/timed out|failed/i.test(exported), exported);

    check('export: wrote to the folder chosen in the UI',
      new RegExp(outDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(exported), exported);

    const files = fs.readdirSync(outDir);
    say(`  files written: ${files.join(', ')}`);
    for (const ext of ['.md', '.html', '.txt', '.json', '.docx', '.pdf']) {
      const match = files.find((f) => f.endsWith(ext));
      check(`export: ${ext} written`, Boolean(match), match || '(missing)');
      if (match) {
        const size = fs.statSync(path.join(outDir, match)).size;
        check(`export: ${ext} is non-trivial`, size > 400, `${size} bytes`);
      }
    }

    // The fixture is served from file://, so no provider pack matches and
    // {provider} resolves to "unknown" — the point here is that the custom
    // template replaced the default, which would have led with a date.
    check('export: custom filename template applied',
      files.length > 0 && files.every((f) => /^unknown - Sorting algorithms\.[a-z]+$/.test(f)),
      files.join(', '));

    const mdFile = files.find((f) => f.endsWith('.md')) || '';
    const mdText = mdFile ? fs.readFileSync(path.join(outDir, mdFile), 'utf8') : '';
    check('export: markdown contains the conversation', mdText.includes('Quicksort'));
    check('export: markdown kept the code fence', mdText.includes('```python'));
    check('export: markdown captured the reasoning', mdText.includes('partitioning first'));

    const jsonFile = files.find((f) => f.endsWith('.json')) || '';
    const parsed = jsonFile ? JSON.parse(fs.readFileSync(path.join(outDir, jsonFile), 'utf8')) : { messages: [] };
    check('export: json has all six messages', parsed.messages.length === 6, String(parsed.messages.length));
    check('export: json recorded the source url', String(parsed.url).includes('fixture-chatgpt'));

    const pdfFile = files.find((f) => f.endsWith('.pdf')) || '';
    const pdfHead = pdfFile ? fs.readFileSync(path.join(outDir, pdfFile)).slice(0, 5).toString() : '';
    check('export: pdf is a real PDF', pdfHead === '%PDF-', pdfHead);

    /* ---------------- the archive format ------------------------------- */
    await run(`(() => {
      for (const input of document.querySelectorAll('#formats input')) input.checked = input.value === 'zip';
      document.getElementById('exportBtn').click();
      return true;
    })()`);
    const zipDone = await run(`new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (!document.getElementById('exportBtn').disabled
            && document.getElementById('results').children.length > 0) {
          clearInterval(poll); resolve(document.getElementById('status').textContent);
        } else if (Date.now() - started > 120000) { clearInterval(poll); resolve('timed out'); }
      }, 400);
    })`);
    check('export: zip archive completed', !/timed out|failed/i.test(zipDone), zipDone);

    const zipFile = fs.readdirSync(outDir).find((f) => f.endsWith('.zip'));
    check('export: zip written', Boolean(zipFile), zipFile || '(missing)');
    if (zipFile) {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(fs.readFileSync(path.join(outDir, zipFile)));
      const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
      check('export: zip bundles every document format',
        ['.html', '.md', '.txt', '.json', '.pdf'].every((ext) => names.some((n) => n.endsWith(ext))),
        names.join(', '));
    }

    /* ---------------- code-block extraction ----------------------------- */
    await run(`(() => {
      document.getElementById('filenameTpl').value = 'codetest';
      document.getElementById('filenameTpl').dispatchEvent(new Event('change', { bubbles: true }));
      for (const input of document.querySelectorAll('#formats input')) input.checked = input.value === 'code';
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    const codeOutcome = await clickExportAndWait(run, 60000);
    check('code: export completed', !/timed out|failed/i.test(codeOutcome), codeOutcome);

    const codeDir = path.join(outDir, 'codetest_code');
    const codeFiles = fs.existsSync(codeDir) ? fs.readdirSync(codeDir) : [];
    check('code: folder created with the snippets', codeFiles.length >= 2, codeFiles.join(', '));
    check('code: python snippet written with a .py extension',
      codeFiles.some((f) => f.endsWith('.py')), codeFiles.join(', '));
    check('code: manifest written', codeFiles.includes('README.md'));
    const pyFile = codeFiles.find((f) => f.endsWith('.py'));
    if (pyFile) {
      check('code: snippet content is the real code',
        fs.readFileSync(path.join(codeDir, pyFile), 'utf8').includes('def qs(a)'));
    }

    /* ---------------- per-message selection ----------------------------- */
    const selectionState = await run(`(async () => {
      document.getElementById('filenameTpl').value = 'selectiontest';
      document.getElementById('filenameTpl').dispatchEvent(new Event('change', { bubbles: true }));
      for (const input of document.querySelectorAll('#formats input')) input.checked = input.value === 'md';
      // Keep only the assistant answers.
      document.querySelector('.selectbar .mini[data-select="assistant"]').click();
      await new Promise((r) => setTimeout(r, 400));
      return document.getElementById('selectionCount').textContent;
    })()`);
    check('selection: preset narrowed the selection', /3 of 6 messages/.test(selectionState), selectionState);

    const selOutcome = await clickExportAndWait(run, 60000);
    check('selection: export completed', !/timed out|failed/i.test(selOutcome), selOutcome);

    const selFile = fs.readdirSync(outDir).find((f) => f.startsWith('selectiontest') && f.endsWith('.md'));
    check('selection: export written', Boolean(selFile), selFile || '(missing)');
    if (selFile) {
      const selText = fs.readFileSync(path.join(outDir, selFile), 'utf8');
      check('selection: unticked user message excluded', !selText.includes('What is quicksort?'), '');
      check('selection: ticked assistant message included', selText.includes('divide and conquer'));
      check('selection: only three messages exported',
        (selText.match(/^## /gm) || []).length === 3, String((selText.match(/^## /gm) || []).length));
    }

    // Put the selection back so later steps see the whole conversation.
    await run(`document.querySelector('.selectbar .mini[data-select="all"]').click()`);

    /* ---------------- library search ------------------------------------ */
    const hits = await run(`window.ace.library.search('quicksort divide')`);
    check('search: found the exported chat by its content', hits.length >= 1, `${hits.length} hit(s)`);
    check('search: result carries a snippet', Boolean(hits[0] && hits[0].snippet), hits[0]?.snippet?.slice(0, 60) || '');
    const noHits = await run(`window.ace.library.search('zzzznotpresentzzzz')`);
    check('search: nonsense query returns nothing', noHits.length === 0);
    const andHits = await run(`window.ace.library.search('quicksort zzzznotpresentzzzz')`);
    check('search: all terms must match', andHits.length === 0);

    /* ---------------- merge with a table of contents --------------------- */
    const mergeOutcome = await run(`(async () => {
      const entries = await window.ace.library.get(10);
      const ids = entries.slice(0, 2).map((e) => e.id);
      const res = await window.ace.merge.run({
        ids,
        externals: [],
        formats: ['md', 'html'],
        options: { outDir: ${JSON.stringify(outDir)}, documentTitle: 'Merged test archive',
                   filenameTemplate: 'mergetest' },
      });
      return { ids: ids.length, res };
    })()`);
    check('merge: ran over two library entries', mergeOutcome.ids === 2, String(mergeOutcome.ids));
    check('merge: reported success', mergeOutcome.res.results[0].ok === true,
      mergeOutcome.res.results[0].error || '');

    const mergedMd = fs.readdirSync(outDir).find((f) => f.startsWith('mergetest') && f.endsWith('.md'));
    check('merge: markdown written', Boolean(mergedMd), mergedMd || '(missing)');
    if (mergedMd) {
      const text = fs.readFileSync(path.join(outDir, mergedMd), 'utf8');
      check('merge: document title used', text.includes('# Merged test archive'));
      check('merge: table of contents present', text.includes('## Contents'));
      check('merge: contents links resolve to anchors',
        /\[.+\]\(#chat-1-[^)]+\)/.test(text) && /<a id="chat-1-/.test(text));
      check('merge: both conversations included',
        (text.match(/^## (?!Contents)/gm) || []).length === 2,
        String((text.match(/^## (?!Contents)/gm) || []).length));
    }

    /* ---------------- layout survives a short window --------------------- */
    // Regression guard: the sidebar used to grow past the bottom of a short
    // window instead of scrolling, hiding the Export button with no way to
    // reach it. Checked at a laptop-sized viewport with a panel full of content.
    // Relax the enforced minimum so the last case is genuinely cramped enough
    // to overflow, rather than only testing sizes the layout comfortably fits.
    win.setMinimumSize(400, 340);
    for (const [w, h] of [[1024, 600], [1280, 720], [900, 540], [820, 420]]) {
      win.setSize(w, h);
      await new Promise((r) => setTimeout(r, 400));
      const layout = await run(`(() => {
        const doc = document.documentElement;
        const panel = document.querySelector('.panel.active');
        const sidebar = document.querySelector('.sidebar');
        panel.scrollTop = 1e6;
        const scrolledTo = panel.scrollTop;
        // "Reachable" means it can be brought into view, not that it happens to
        // be on screen at the very bottom of the scroll range — a button in the
        // middle of a long panel is scrolled off the top there, quite correctly.
        document.getElementById('exportBtn').scrollIntoView({ block: 'center' });
        const exportBtn = document.getElementById('exportBtn').getBoundingClientRect();
        return {
          pageOverflows: doc.scrollHeight > doc.clientHeight + 1,
          sidebarFits: sidebar.getBoundingClientRect().bottom <= doc.clientHeight + 1,
          panelScrolls: panel.scrollHeight > panel.clientHeight,
          scrolledTo,
          exportReachable: exportBtn.bottom <= doc.clientHeight + 1 && exportBtn.top >= 0,
          statusVisible: document.querySelector('.statusbar').getBoundingClientRect().bottom <= doc.clientHeight + 1,
        };
      })()`);
      check(`layout ${w}x${h}: page itself does not overflow`, !layout.pageOverflows, JSON.stringify(layout));
      check(`layout ${w}x${h}: sidebar stays inside the window`, layout.sidebarFits, JSON.stringify(layout));
      check(`layout ${w}x${h}: panel scrolls instead of clipping`, layout.panelScrolls && layout.scrolledTo > 0,
        JSON.stringify(layout));
      check(`layout ${w}x${h}: export button reachable by scrolling`, layout.exportReachable, JSON.stringify(layout));
      check(`layout ${w}x${h}: status bar visible`, layout.statusVisible, JSON.stringify(layout));

      // The welcome panel is a centred flex container. Plain `center` would
      // overflow in both directions on a short window, putting its first line
      // above the scroll origin where nothing can bring it back.
      const welcome = await run(`(() => {
        const el = document.getElementById('placeholder');
        const wasHidden = el.style.display;
        el.style.display = 'flex';
        el.scrollTop = 0;
        const firstTop = el.firstElementChild.getBoundingClientRect().top;
        const boxTop = el.getBoundingClientRect().top;
        el.scrollTop = 1e6;
        const scrolledToEnd = el.scrollTop;
        const lastBottom = el.lastElementChild.getBoundingClientRect().bottom;
        const boxBottom = el.getBoundingClientRect().bottom;
        el.style.display = wasHidden;
        return {
          overflows: el.scrollHeight > el.clientHeight,
          firstLineReachable: firstTop >= boxTop - 1,
          lastLineReachable: lastBottom <= boxBottom + 1,
          scrolledToEnd,
        };
      })()`);
      check(`layout ${w}x${h}: welcome panel top not cut off`, welcome.firstLineReachable, JSON.stringify(welcome));
      check(`layout ${w}x${h}: welcome panel bottom reachable`, welcome.lastLineReachable, JSON.stringify(welcome));
    }

    /* ---------------- library recorded the runs -------------------------- */
    const library = await run(`window.ace.library.get()`);
    check('library: exports were recorded', library.length >= 1 && library[0].messageCount > 0,
      JSON.stringify(library[0] || {}).slice(0, 120));

    check('renderer: no unexpected console errors', errors.length === 0, errors.join(' | '));
  } catch (err) {
    failures++;
    say('FAIL  harness threw — ' + (err.stack || err));
  }

  say(`\nOutput folder: ${outDir}`);
  say(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  app.exit(failures === 0 ? 0 : 1);
});
