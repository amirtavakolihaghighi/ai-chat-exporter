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
const { app, BrowserWindow, session } = require('electron');

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

// Point the app at a throwaway profile and data folder before it boots, so a
// test run never reads or writes the real settings, site rules or library —
// which, run from the project, would otherwise be its data folder.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-userdata-'));
app.setPath('userData', userDataDir);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-data-'));
process.env.ACE_DATA_DIR = dataDir;
const rulesFile = path.join(dataDir, 'rules', 'site-rules.json');

// What an older version left in the profile folder, to be copied in on first start.
fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify({
  outDir: path.join(app.getPath('documents'), 'AI Chat Exports'),
  theme: 'dark',
  fontSize: 15,
  pageSize: 'A4',
}), 'utf8');
fs.writeFileSync(path.join(userDataDir, 'library.json'), JSON.stringify([
  { id: 'old-1', at: '2025-01-01T00:00:00.000Z', title: 'An old export', url: 'https://example.com/c/1', messages: [] },
]), 'utf8');

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

/**
 * Fixtures served at real chat-site addresses inside the app's browser pane, so
 * the built-in rules for those sites apply exactly as they would for real. Only
 * the guest session is intercepted, and nothing leaves the machine.
 */
const SERVED = {
  'chatgpt.com/c/classic': 'fixture-chatgpt.html',
  'chatgpt.com/c/redesign': 'fixture-redesign.html',
  'unknown-chat.example/c/1': 'fixture-unknown.html',
};

function serveFixtures() {
  session.fromPartition('persist:aichats').protocol.handle('https', (request) => {
    const url = new URL(request.url);
    const file = SERVED[url.hostname + url.pathname];
    if (!file) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(path.join(__dirname, 'fixtures', file)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });
}

app.whenReady().then(async () => {
  let win;
  try {
    serveFixtures();
    win = await windowReady();
    await new Promise((r) => setTimeout(r, 800)); // let the renderer finish init

    const errors = [];
    win.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/Security Warning/.test(message)) errors.push(message);
    });

    const run = (code) => win.webContents.executeJavaScript(code, true);

    /* ---------------- the data folder ----------------------------------- */
    const firstSettings = await run(`window.ace.settings.get()`);
    check('data: options from an older version are carried over', firstSettings.theme === 'dark', firstSettings.theme);
    check('data: the old default output folder is not; exports go to the data folder',
      firstSettings.outDir === path.join(dataDir, 'exports'), firstSettings.outDir);
    const copiedSettings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings', 'settings.json'), 'utf8'));
    check('data: the settings file holds only what was changed', JSON.stringify(copiedSettings) === '{"theme":"dark"}',
      JSON.stringify(copiedSettings));
    check('data: the old files are copied, never moved',
      fs.existsSync(path.join(userDataDir, 'settings.json')) && fs.existsSync(path.join(userDataDir, 'library.json')) &&
      fs.existsSync(path.join(dataDir, 'library', 'library.json')));
    check('data: one folder for each kind of file, and a note saying which is which',
      ['settings', 'rules', 'library', 'exports'].every((f) => fs.statSync(path.join(dataDir, f)).isDirectory()) &&
      fs.existsSync(path.join(dataDir, 'README.txt')));
    await run(`document.querySelector('.tab[data-tab="options"]').click(); true`);
    await new Promise((r) => setTimeout(r, 400));
    const dataCard = await run(`({
      dir: document.getElementById('dataDir').textContent,
      rows: Array.from(document.querySelectorAll('#dataFolders .datafolder-item strong')).map((s) => s.textContent),
      changeLocked: document.getElementById('dataChangeBtn').disabled,
    })`);
    check('data: Options shows the folder and its parts', dataCard.dir === dataDir &&
      dataCard.rows.join() === 'settings,rules,library,exports' && dataCard.changeLocked, JSON.stringify(dataCard));
    await run(`document.querySelector('.tab[data-tab="export"]').click(); true`);

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
    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings', 'settings.json'), 'utf8'));
    check('settings: only the changed options are written, in the data folder',
      onDisk.filenameTemplate === '{provider} - {title}' && onDisk.settleMs === 150 && onDisk.theme === 'dark' &&
      !('includeThinking' in onDisk) && !('pageSize' in onDisk) && !('selection' in onDisk), JSON.stringify(onDisk));

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

    /* ---------------- site rules: a site the app knows ------------------- */
    const waitFor = (expr, ms = 30000) => run(`new Promise((resolve) => {
      const started = Date.now();
      const poll = setInterval(() => {
        let value;
        try { value = (${expr}); } catch { value = false; }
        if (value || Date.now() - started > ${ms}) { clearInterval(poll); resolve(Boolean(value)); }
      }, 200);
    })`);
    const openChat = async (address) => {
      await run(`document.getElementById('urlInput').value = ${JSON.stringify(address)};
        document.getElementById('urlForm').requestSubmit(); true`);
      await new Promise((r) => setTimeout(r, 400));
      await waitFor(`!document.getElementById('extractBtn').disabled && !document.getElementById('view').isLoading()`);
      await new Promise((r) => setTimeout(r, 500));
    };
    const inPage = (code) => run(`document.getElementById('view').executeJavaScript(${JSON.stringify(code)}, true)`);
    const readNow = async (expectClass) => {
      await run(`document.getElementById('extractStatus').className = 'extract-status';
        document.getElementById('extractBtn').click(); true`);
      await waitFor(`document.getElementById('extractStatus').classList.contains(${JSON.stringify(expectClass)})`, 45000);
      return run(`document.getElementById('extractStatus').innerText`);
    };

    await openChat('https://chatgpt.com/c/classic');
    const badge = await run(`document.getElementById('providerBadge').textContent`);
    check('rules: a known site shows its built-in rules', /ChatGPT · built-in rules/.test(badge), badge);
    const classic = await readNow('ok');
    check('rules: the read says which rules it used', /6 messages/.test(classic) && /built-in rules for ChatGPT/.test(classic),
      classic.replace(/\s+/g, ' '));
    await waitFor(`/Worked on/.test(document.getElementById('siteSub').textContent)`, 5000);
    const card = await run(`document.getElementById('siteCard').innerText`);
    check('rules: the site card shows what each colour found', /You\s*3/.test(card) && /AI\s*3/.test(card) && /Worked on/.test(card),
      card.replace(/\s+/g, ' '));

    /* ---------------- site rules: the site redesigns -------------------- */
    await openChat('https://chatgpt.com/c/redesign');
    const broken = await readNow('err');
    check('repair: rules that no longer fit say so instead of guessing',
      /found no messages/.test(broken) && /Fix the rules/.test(broken) && /Read once by guessing/.test(broken),
      broken.replace(/\s+/g, ' '));
    const noSidebar = await run(`document.getElementById('previewBox').hidden`);
    check('repair: nothing from the sidebar is offered for export', noSidebar === true);

    await run(`Array.from(document.querySelectorAll('#extractStatus button')).find((b) => /Fix the rules/.test(b.textContent)).click(); true`);
    const panelOpen = await waitFor(`document.getElementById('siteNote').textContent.includes('panel is open')`, 10000);
    check('repair: the teach panel opens on the page', panelOpen);
    await new Promise((r) => setTimeout(r, 800));
    const proposal = await inPage(`document.getElementById('__ace_teach__')?.shadowRoot?.querySelector('.panel')?.innerText || ''`);
    check('repair: the panel offers a guess for the new layout', /old rules find nothing/.test(proposal) && /4\s+messages/.test(proposal),
      proposal.replace(/\s+/g, ' ').slice(0, 160));
    await inPage(`Array.from(document.getElementById('__ace_teach__').shadowRoot.querySelectorAll('button')).find((b) => b.textContent.includes('Save rules')).click(); true`);
    const saving = await inPage(`(() => {
      const root = document.getElementById('__ace_teach__').shadowRoot;
      const name = root.querySelector('.saving input[type=text]');
      const use = root.querySelector('.saving input[type=checkbox]');
      return { name: name && name.value, use: use && use.checked, update: Boolean(root.querySelector('input[name=ace-save-as]')) };
    })()`);
    check('repair: saving offers a rule set of your own, named, and used from now on',
      saving.name === 'My ChatGPT' && saving.use === true && !saving.update, JSON.stringify(saving));
    await inPage(`Array.from(document.getElementById('__ace_teach__').shadowRoot.querySelectorAll('button')).find((b) => b.textContent.includes('Save these rules')).click(); true`);
    await waitFor(`document.getElementById('extractStatus').classList.contains('ok')`, 45000);
    const fixed = await run(`document.getElementById('extractStatus').innerText`);
    check('repair: saving re-reads the chat with the new rules', /4 messages/.test(fixed) && /your rules “My ChatGPT”/.test(fixed),
      fixed.replace(/\s+/g, ' '));
    const savedRules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    check('repair: saved as your own copy of the built-in rules, in the data folder',
      savedRules.sets.length === 1 && savedRules.sets[0].basedOn === 'chatgpt', JSON.stringify(savedRules.sets.map((s) => s.name)));

    /* ---------------- the rule manager ----------------------------------- */
    await run(`document.querySelector('.tab[data-tab="rules"]').click(); true`);
    await waitFor(`document.querySelectorAll('#userRules .sitegroup').length > 0`, 5000);
    const manager = await run(`({
      user: document.querySelectorAll('#userRules .sitegroup').length,
      builtins: document.querySelectorAll('#builtinRules .sitegroup').length,
      legend: document.querySelectorAll('#rulesLegend .item').length,
      rows: Array.from(document.querySelectorAll('#userRules .sitegroup .setrow')).map((r) => r.innerText),
      inUse: document.querySelector('#userRules .setrow.inuse')?.innerText || '',
      here: document.querySelector('#userRules .sitegroup').classList.contains('here'),
    })`);
    check('manager: one card for ChatGPT, holding the built-in rules and yours', manager.user === 1 && manager.rows.length === 2 &&
      /Built-in/i.test(manager.rows[0]) && /YOURS/i.test(manager.rows[1]), JSON.stringify(manager.rows).slice(0, 200));
    check('manager: every other built-in site listed', manager.builtins >= 11, String(manager.builtins));
    check('manager: colour legend shown', manager.legend >= 9, String(manager.legend));
    check('manager: yours is the one in use, and it works', /My ChatGPT/.test(manager.inUse) && /Worked on/.test(manager.inUse) && manager.here,
      manager.inUse.replace(/\s+/g, ' ').slice(0, 160));

    const gptCard = `document.querySelector('#userRules .sitegroup')`;
    await run(`${gptCard}.querySelectorAll('.setrow')[0].querySelector('input[type=radio]').click(); true`);
    await waitFor(`/built-in rules/.test(document.getElementById('providerBadge').textContent)`, 5000);
    const switched = await run(`({
      inUse: ${gptCard}.querySelector('.setrow.inuse')?.innerText || '',
      reset: Array.from(${gptCard}.querySelectorAll('button')).some((b) => /Back to the built-in/.test(b.textContent)),
      choices: Array.from(document.querySelectorAll('#siteSwitch option')).map((o) => o.textContent),
      switchShown: !document.getElementById('siteSwitchRow').hidden,
      picked: document.getElementById('siteSwitch').selectedOptions[0]?.textContent,
    })`);
    check('profiles: the round button switches the site to the built-in rules', /Built-in/i.test(switched.inUse) && !switched.reset,
      switched.inUse.replace(/\s+/g, ' ').slice(0, 120));
    check('profiles: the site card offers a quick switch between them', switched.switchShown && switched.choices.length === 2 &&
      /built-in/.test(switched.picked), JSON.stringify(switched));

    const mineId = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).sets[0].id;
    await run(`const s = document.getElementById('siteSwitch'); s.value = ${JSON.stringify(mineId)};
      s.dispatchEvent(new Event('change')); true`);
    await waitFor(`/your rules/.test(document.getElementById('providerBadge').textContent)`, 5000);
    check('profiles: the quick switch puts your rules back in use',
      /your rules/.test(await run(`document.getElementById('providerBadge').textContent`)));

    await waitFor(`Array.from(${gptCard}.querySelectorAll('button')).some((b) => /Back to the built-in/.test(b.textContent))`, 5000);
    await run(`Array.from(${gptCard}.querySelectorAll('button')).find((b) => /Back to the built-in/.test(b.textContent)).click(); true`);
    await waitFor(`/built-in rules/.test(document.getElementById('providerBadge').textContent)`, 5000);
    const afterReset = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    check('profiles: back to the built-in rules keeps your rule set', afterReset.sets.length === 1 && afterReset.sets[0].isDefault === false,
      JSON.stringify(afterReset.sets.map((s) => [s.name, s.isDefault])));

    await run(`const row = ${gptCard}.querySelectorAll('.setrow')[0];
      Array.from(row.querySelectorAll('button')).find((b) => b.textContent.startsWith('More')).click();
      Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Make a copy').click(); true`);
    await waitFor(`${gptCard}.querySelectorAll('.setrow').length === 3`, 5000);
    const copied = await run(`({
      rows: Array.from(${gptCard}.querySelectorAll('.setrow')).map((r) => r.innerText.split('\\n')[0]),
      inUse: ${gptCard}.querySelector('.setrow.inuse')?.innerText || '',
    })`);
    check('profiles: a copy of the built-in rules is a new rule set, not yet in use',
      copied.rows.length === 3 && /Built-in/i.test(copied.inUse), JSON.stringify(copied.rows));
    await run(`${gptCard}.querySelectorAll('.setrow')[1].querySelector('input[type=radio]').click(); true`);
    await waitFor(`/your rules/.test(document.getElementById('providerBadge').textContent)`, 5000);

    const gemini = `Array.from(document.querySelectorAll('#builtinRules .sitegroup')).find((c) => /Gemini/.test(c.innerText))`;
    await run(`window.confirm = () => true;
      const card = ${gemini};
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent.startsWith('More')).click();
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent === 'Remove').click(); true`);
    await waitFor(`!document.getElementById('removedBox').hidden`, 5000);
    const removed = await run(`({ count: document.getElementById('removedCount').textContent, still: Boolean(${gemini}) })`);
    check('manager: a built-in set can be removed', removed.count === '1' && !removed.still, JSON.stringify(removed));
    await run(`document.getElementById('restoreAllBtn').click(); true`);
    await waitFor(`document.getElementById('removedBox').hidden`, 5000);
    check('manager: and restored', Boolean(await run(`Boolean(${gemini})`)));

    /* ---------------- help ---------------------------------------------- */
    await run(`document.getElementById('manualBtn').click(); true`);
    await waitFor(`document.getElementById('helpToc').children.length > 10`, 5000);
    const manualState = await run(`({
      open: !document.getElementById('helpOverlay').hidden,
      toc: document.getElementById('helpToc').children.length,
      anchors: document.querySelectorAll('#helpContent h2[id]').length,
    })`);
    check('help: the manual opens inside the app with a contents list',
      manualState.open && manualState.toc > 10 && manualState.anchors > 5, JSON.stringify(manualState));
    await run(`document.getElementById('helpSearch').value = 'teach';
      document.getElementById('helpSearch').dispatchEvent(new Event('input')); true`);
    await waitFor(`document.querySelectorAll('#helpToc .result').length > 0`, 3000);
    check('help: the manual can be searched', (await run(`document.querySelectorAll('#helpToc .result').length`)) > 0);
    await run(`document.getElementById('helpClose').click(); true`);

    await run(`document.querySelector('.tab[data-tab="export"]').click();
      document.getElementById('whatsThisBtn').click(); true`);
    await run(`document.getElementById('extractBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 300));
    const tip = await run(`({ text: document.getElementById('helpTip').innerText, reading: !document.getElementById('busy').hidden })`);
    check('help: "What’s this?" explains a control instead of using it',
      /Read this chat/.test(tip.text) && !tip.reading, JSON.stringify(tip));
    await run(`document.getElementById('whatsThisDone').click(); true`);

    /* ---------------- batch skips sites with no rules -------------------- */
    await run(`document.querySelector('.tab[data-tab="batch"]').click();
      document.getElementById('batchUrls').value = 'https://unknown-chat.example/c/1';
      document.getElementById('batchGuess').checked = false;
      for (const input of document.querySelectorAll('#formats input')) input.checked = input.value === 'md';
      document.getElementById('batchBtn').click(); true`);
    await waitFor(`/Finished/.test(document.getElementById('batchLog').innerText)`, 60000);
    const skippedLog = await run(`document.getElementById('batchLog').innerText`);
    check('batch: a site with no rules is skipped and the reason given',
      /skipped: no rules for unknown-chat\.example/.test(skippedLog) && /0 exported, 1 skipped/.test(skippedLog),
      skippedLog.replace(/\s+/g, ' '));
    await run(`document.getElementById('batchGuess').checked = true;
      document.getElementById('batchBtn').click(); true`);
    await waitFor(`/Finished: 1 exported/.test(document.getElementById('batchLog').innerText)`, 60000);
    const guessedLog = await run(`document.getElementById('batchLog').innerText`);
    check('batch: with permission, it is exported and marked as guessed',
      /layout guessed/.test(guessedLog) && /1 exported/.test(guessedLog), guessedLog.replace(/\s+/g, ' '));
    await run(`document.querySelector('.tab[data-tab="export"]').click(); true`);

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
