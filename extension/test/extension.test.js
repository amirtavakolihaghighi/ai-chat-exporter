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
const os = require('node:os');
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

    for (const extra of ['panel.html', 'panel.js', 'panel.css', 'ui.css', 'popup.js', 'popup.css', 'content.js', 'print.js']) {
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
  const fakeRequire = (name) => (name === './folder' ? { ready: async () => null } : { api: {} });
  new Function('require', 'module', 'exports', src)(fakeRequire, mod, mod.exports);
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

/* -------------------------------------------------------------- downloads */

/**
 * What happens to a file after it is handed to the browser. A download manager
 * (IDM and the like) can take a download over and name it after the download's
 * internal address — a long id — which looks exactly like the app ignoring its
 * own filename template. That has to be noticed and said.
 */
async function checkDownloads() {
  const src = fs.readFileSync(path.join(EXT, 'src', 'lib', 'download.js'), 'utf8');
  const calls = [];
  const fakeApi = { downloads: {} };
  // No folder linked, unless a check below links one.
  const fakeFolder = { ready: async () => null, saved: [] };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', src)((name) => (name === './folder' ? fakeFolder : { api: fakeApi }), mod, mod.exports);
  const { downloadBlob } = mod.exports;
  const wanted = 'AI Chat Exports/2026-10-28 - ChatGPT - Weekend plans.html';

  fakeApi.downloads.download = async (opts) => {
    calls.push(opts);
    return 7;
  };
  fakeApi.downloads.search = async () => [
    { id: 7, state: 'complete', filename: 'C:\\Users\\me\\Downloads\\3f2b7e0c-1a2b-4c5d-9e8f-0a1b2c3d4e5f.html' },
  ];
  const renamed = await downloadBlob(new Blob(['x']), wanted);
  check('download: a file renamed by something else is reported',
    renamed.renamedTo === '3f2b7e0c-1a2b-4c5d-9e8f-0a1b2c3d4e5f.html', JSON.stringify(renamed));

  fakeApi.downloads.search = async () => [
    { id: 7, state: 'complete', filename: 'C:\\Users\\me\\Downloads\\AI Chat Exports\\2026-10-28 - ChatGPT - Weekend plans (1).html' },
  ];
  const kept = await downloadBlob(new Blob(['x']), wanted);
  check('download: a name the browser only numbered is not called a rename', !kept.renamedTo, JSON.stringify(kept));

  fakeApi.downloads.download = async (opts) => {
    calls.push(opts);
    if (!opts.saveAs) throw new Error('Invalid filename');
    return 9;
  };
  calls.length = 0;
  await downloadBlob(new Blob(['x']), wanted);
  const dialog = calls[calls.length - 1];
  check('download: the save dialog is still offered the name, never left to use an id',
    dialog.saveAs === true && /Weekend plans/.test(dialog.filename || ''), JSON.stringify(dialog));

  // With a folder linked in Options, files go there instead of Downloads.
  fakeFolder.ready = async () => ({ name: 'data' });
  fakeFolder.saveFile = async (_handle, area, relative) => {
    fakeFolder.saved.push(`${area}/${relative}`);
    return `data/${area}/${relative}`;
  };
  calls.length = 0;
  const intoFolder = await downloadBlob(new Blob(['x']), 'AI Chat Exports/chat_files/pic.png');
  const rulesFile = await downloadBlob(new Blob(['{}']), 'AI Chat Exports/rules.json', { area: 'rules' });
  check('download: with a folder linked, exports go to its exports folder, not Downloads',
    intoFolder.linked && intoFolder.filename === 'data/exports/chat_files/pic.png' && calls.length === 0, JSON.stringify(intoFolder));
  check('download: and exported rules to its rules folder', rulesFile.filename === 'data/rules/rules.json', JSON.stringify(rulesFile));
  fakeFolder.saveFile = async () => {
    throw new Error('The folder is gone');
  };
  const fellBack = await downloadBlob(new Blob(['x']), wanted);
  check('download: a folder that went away falls back to Downloads', !fellBack.linked && calls.length > 0, JSON.stringify(fellBack));
}

app.whenReady().then(async () => {
  try {
    checkManifests();
    checkFilenames();
    await checkDownloads();

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
          { type: 'ace:capture', settings: { embedImages: false, settleMs: 120 }, rules: null },
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
    check('content script: with no rules sent, says it guessed', result?.source === 'guess', String(result?.source));

    /* ---------- rules sent by the workspace drive the read ---------- */
    const siteRules = require(path.join(ROOT, 'src', 'shared', 'rules.js'));
    const chatgptRules = siteRules.compile(siteRules.builtinById('chatgpt'), 'https://chatgpt.com/');
    const runCapture = async (fixture, rules) => {
      await win.loadFile(path.join(ROOT, 'test', 'fixtures', fixture));
      await new Promise((r) => setTimeout(r, 300));
      return win.webContents.executeJavaScript(`(async () => {
        const listeners = [];
        globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({}) } };
        delete globalThis.__aceContentLoaded;
        ${contentBundle}
        return await new Promise((resolve) => {
          listeners[0]({ type: 'ace:capture', settings: { embedImages: false, settleMs: 120 },
            rules: ${JSON.stringify(rules)} }, {}, resolve);
        });
      })()`, true);
    };
    const withRules = await runCapture('fixture-chatgpt.html', chatgptRules);
    check('content script: reads with the rules it is sent',
      withRules?.result?.source === 'rules' && withRules.result.messages.length === 6 && withRules.result.health?.status === 'ok',
      JSON.stringify({ source: withRules?.result?.source, n: withRules?.result?.messages?.length, health: withRules?.result?.health?.status }));
    const stale = await runCapture('fixture-redesign.html', { ...chatgptRules, parts: chatgptRules.parts });
    check('content script: rules that no longer fit report it, not a guess',
      stale?.result?.ok === false && stale.result.reason === 'rules-found-nothing',
      JSON.stringify({ ok: stale?.result?.ok, reason: stale?.result?.reason }));

    /* ---------- the teach panel opens and closes on request ---------- */
    const { PARTS } = require(path.join(ROOT, 'src', 'shared', 'parts.js'));
    await win.loadFile(path.join(ROOT, 'test', 'fixtures', 'fixture-chatgpt.html'));
    await new Promise((r) => setTimeout(r, 300));
    const taught = await win.webContents.executeJavaScript(`(async () => {
      const listeners = [];
      globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({}) } };
      delete globalThis.__aceContentLoaded;
      ${contentBundle}
      const settled = new Promise((resolve) => {
        listeners[0]({ type: 'ace:teach', options: { mode: 'show', parts: ${JSON.stringify(PARTS)},
          rules: ${JSON.stringify(siteRules.builtinById('chatgpt'))}, siteName: 'chatgpt.test' } }, {}, resolve);
      });
      await new Promise((r) => setTimeout(r, 400));
      const panel = document.getElementById('__ace_teach__')?.shadowRoot?.querySelector('.panel')?.innerText || '';
      listeners[0]({ type: 'ace:teachClose' }, {}, () => {});
      const answer = await settled;
      return { panel, answer, gone: !document.getElementById('__ace_teach__') };
    })()`, true);
    check('content script: shows the rules on the page', /Your messages\s+3/.test(taught?.panel || ''),
      (taught?.panel || '').replace(/\s+/g, ' ').slice(0, 120));

    /* ---------- the manual travels with the extension ---------- */
    const panelBundle = fs.readFileSync(path.join(EXT, 'dist', 'chrome', 'panel.js'), 'utf8');
    const manualText = fs.readFileSync(path.join(ROOT, 'docs', 'MANUAL.md'), 'utf8');
    const firstHeading = (manualText.match(/^# (.+)$/m) || [])[1] || '';
    check('workspace: the user manual is bundled', firstHeading.length > 0 && panelBundle.includes(firstHeading), firstHeading);

    /* ---------- the built workspace page boots and works ---------- */
    const workspace = new BrowserWindow({
      show: false,
      width: 1300,
      height: 900,
      webPreferences: {
        preload: path.join(__dirname, 'fake-browser.js'),
        contextIsolation: false,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    const workspaceErrors = [];
    workspace.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2 && !/Security Warning/.test(message)) workspaceErrors.push(message);
    });
    await workspace.loadFile(path.join(EXT, 'dist', 'chrome', 'panel.html'));
    await new Promise((r) => setTimeout(r, 800));
    const ws = (code) => workspace.webContents.executeJavaScript(code, true);

    const booted = await ws(`({
      legend: document.querySelectorAll('#rulesLegend .item').length,
      tabs: document.querySelectorAll('.tab').length,
      card: document.getElementById('siteName').textContent,
    })`);
    check('workspace: boots with the colour legend and every tab', booted.legend >= 9 && booted.tabs === 6, JSON.stringify(booted));
    check('workspace: says no chat is attached', /No chat attached/.test(booted.card), booted.card);

    // Rules the old one-click picker saved, as an earlier version left them.
    await ws(`window.__fakeStorage.set('ace:userPacks', {
      'chatgpt.com': { name: 'chatgpt.com', turnSelector: 'div.user-bubble', hosts: ['chatgpt.com'] },
    }); document.querySelector('.tab[data-tab="rules"]').click(); true`);
    await new Promise((r) => setTimeout(r, 500));
    const managerState = await ws(`({
      user: Array.from(document.querySelectorAll('#userRules .sitegroup')).map((c) => c.innerText),
      builtins: document.querySelectorAll('#builtinRules .sitegroup').length,
      inUse: document.querySelector('#userRules .setrow.inuse')?.innerText || '',
      converted: Boolean(window.__fakeStorage.get('ace:siteRules')),
      kept: Boolean(window.__fakeStorage.get('ace:userPacks')),
    })`);
    check('workspace: rules from the old picker are carried over and labelled',
      managerState.user.length === 1 && /Old picker/i.test(managerState.user[0]),
      JSON.stringify(managerState.user).slice(0, 160));
    check('workspace: and still the ones in use for their site', /Old picker/i.test(managerState.inUse),
      managerState.inUse.replace(/\s+/g, ' ').slice(0, 120));
    check('workspace: the old rules are kept as a backup', managerState.converted && managerState.kept);
    check('workspace: every other built-in site is listed', managerState.builtins >= 11, String(managerState.builtins));

    await ws(`document.querySelector('#userRules .sitegroup .setrow input[type=radio]').click(); true`);
    await new Promise((r) => setTimeout(r, 400));
    const switchedBack = await ws(`({
      stored: window.__fakeStorage.get('ace:siteRules').sets.map((s) => s.isDefault),
      inUse: document.querySelector('#userRules .setrow.inuse')?.innerText || '',
    })`);
    check('workspace: choosing the built-in rules for a site is saved, keeping yours',
      switchedBack.stored.length === 1 && switchedBack.stored[0] === false && /Built-in/i.test(switchedBack.inUse),
      JSON.stringify(switchedBack).slice(0, 160));
    await ws(`const row = document.querySelector('#userRules .sitegroup .setrow');
      Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Make a copy').click(); true`);
    await new Promise((r) => setTimeout(r, 400));
    const afterCopy = await ws(`window.__fakeStorage.get('ace:siteRules').sets.map((s) => ({ name: s.name, isDefault: s.isDefault }))`);
    check('workspace: a copy of the built-in rules is saved as a new rule set, not in use',
      afterCopy.length === 2 && afterCopy[1].isDefault === false && /copy/.test(afterCopy[1].name), JSON.stringify(afterCopy));

    await ws(`window.confirm = () => true;
      const card = Array.from(document.querySelectorAll('#builtinRules .sitegroup')).find((c) => /Gemini/.test(c.innerText));
      Array.from(card.querySelectorAll('button')).find((b) => b.textContent === 'Remove').click(); true`);
    await new Promise((r) => setTimeout(r, 400));
    const afterRemove = await ws(`({
      removed: document.getElementById('removedCount').textContent,
      stored: window.__fakeStorage.get('ace:siteRules').builtins.gemini,
    })`);
    check('workspace: removing a built-in set is saved', afterRemove.removed === '1' && afterRemove.stored?.removed === true,
      JSON.stringify(afterRemove));

    /* ---------- a folder on the computer (Chrome, Edge) ---------- */
    const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-ext-folder-'));
    const linkRules = path.join(linkDir, 'rules', 'site-rules.json');
    const linkSettings = path.join(linkDir, 'settings', 'extension-settings.json');
    // Rules the desktop app saved there earlier.
    fs.mkdirSync(path.dirname(linkRules), { recursive: true });
    fs.writeFileSync(linkRules, JSON.stringify({
      version: 3,
      savedAt: '2026-01-01T00:00:00.000Z',
      sets: [{ id: 'u-desktop-1', name: 'From the desktop', hosts: ['claude.ai'], isDefault: true,
        parts: { user: ['.du'], assistant: ['.da'] }, updatedAt: '2026-01-01T00:00:00.000Z' }],
      builtins: {},
    }));
    const before = await ws(`({
      text: document.getElementById('folderText').textContent,
      choose: !document.getElementById('folderChooseBtn').hidden,
      sets: window.__fakeStorage.get('ace:siteRules').sets.length,
    })`);
    check('folder: without one, everything stays in the browser', /Only in this browser/.test(before.text) && before.choose,
      JSON.stringify(before));
    await ws(`window.__fakeFolderDir = ${JSON.stringify(linkDir)};
      document.querySelector('.tab[data-tab="options"]').click();
      document.getElementById('folderChooseBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 800));
    const linked = await ws(`({
      text: document.getElementById('folderText').textContent,
      parts: document.querySelectorAll('#folderParts .datafolder-item').length,
      sets: window.__fakeStorage.get('ace:siteRules').sets.map((s) => s.name),
    })`);
    const sharedRules = JSON.parse(fs.readFileSync(linkRules, 'utf8'));
    check('folder: choosing one shows it in use, with its parts', /Also in the folder/.test(linked.text) && linked.parts === 3,
      JSON.stringify(linked));
    check('folder: rules from the browser and from the desktop app are both kept, in both places',
      linked.sets.includes('From the desktop') && linked.sets.length === before.sets + 1 &&
      sharedRules.sets.length === linked.sets.length, JSON.stringify({ browser: linked.sets, folder: sharedRules.sets.map((x) => x.name) }));
    check('folder: the options file is written, holding only what was changed',
      fs.existsSync(linkSettings) && JSON.stringify(JSON.parse(fs.readFileSync(linkSettings, 'utf8')).options) === '{}');

    await ws(`const theme = document.getElementById('themeSel'); theme.value = 'dark';
      theme.dispatchEvent(new Event('change', { bubbles: true })); true`);
    await new Promise((r) => setTimeout(r, 900));
    const optionsFile = JSON.parse(fs.readFileSync(linkSettings, 'utf8'));
    check('folder: a changed option is written to the folder', JSON.stringify(optionsFile.options) === '{"theme":"dark"}',
      JSON.stringify(optionsFile));

    // The desktop app renames a rule set in the shared file.
    const changed = JSON.parse(fs.readFileSync(linkRules, 'utf8'));
    changed.sets.find((x) => x.id === 'u-desktop-1').name = 'Renamed in the desktop app';
    changed.savedAt = new Date(Date.now() + 60_000).toISOString();
    fs.writeFileSync(linkRules, JSON.stringify(changed));
    await ws(`window.dispatchEvent(new Event('focus')); true`);
    await new Promise((r) => setTimeout(r, 800));
    const adopted = await ws(`window.__fakeStorage.get('ace:siteRules').sets.map((s) => s.name)`);
    check('folder: changes the desktop app made there are taken in', adopted.includes('Renamed in the desktop app') &&
      !adopted.includes('From the desktop'), JSON.stringify(adopted));

    await ws(`document.getElementById('rulesExportBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 600));
    const exportedRules = fs.readdirSync(path.join(linkDir, 'rules')).filter((f) => /^AI Chat Extractor rules .*\.json$/.test(f));
    check('folder: exported rules are saved in its rules folder', exportedRules.length === 1, fs.readdirSync(path.join(linkDir, 'rules')).join(', '));

    // After a browser restart it asks once more before writing.
    await ws(`window.__folderPermission = 'prompt'; window.dispatchEvent(new Event('focus')); true`);
    await new Promise((r) => setTimeout(r, 500));
    const waiting = await ws(`({
      text: document.getElementById('folderText').textContent,
      allow: !document.getElementById('folderAllowBtn').hidden,
    })`);
    check('folder: after a restart it waits for permission, with a button to give it',
      /waiting for your permission/.test(waiting.text) && waiting.allow, JSON.stringify(waiting));
    await ws(`document.getElementById('folderAllowBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 500));
    check('folder: and is in use again once allowed',
      /Also in the folder/.test(await ws(`document.getElementById('folderText').textContent`)));

    await ws(`window.confirm = () => true; document.getElementById('folderForgetBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 500));
    check('folder: stopping leaves the folder and its files as they are',
      /Only in this browser/.test(await ws(`document.getElementById('folderText').textContent`)) &&
      fs.existsSync(linkRules) && fs.existsSync(linkSettings));

    await ws(`document.getElementById('resetSettingsBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 400));
    const reset = await ws(`({ theme: document.getElementById('themeSel').value,
      kept: window.__fakeStorage.get('ace:settingsBeforeReset')?.theme })`);
    check('options: reset puts them back to the defaults, keeping the old ones aside',
      reset.theme === 'light' && reset.kept === 'dark', JSON.stringify(reset));

    await ws(`document.getElementById('manualBtn').click(); true`);
    await new Promise((r) => setTimeout(r, 500));
    const manualOpen = await ws(`({ open: !document.getElementById('helpOverlay').hidden,
      toc: document.getElementById('helpToc').children.length })`);
    check('workspace: the manual opens inside the extension', manualOpen.open && manualOpen.toc > 10, JSON.stringify(manualOpen));
    check('workspace: no unexpected console errors', workspaceErrors.length === 0, workspaceErrors.join(' | '));
    workspace.destroy();
    check('content script: closes the panel when asked', taught?.answer?.ok === true && taught.answer.result?.cancelled === true && taught.gone,
      JSON.stringify(taught?.answer));

    /* ---------- describe / ping, used by the popup ---------- */
    const described = await win.webContents.executeJavaScript(`(async () => {
      const listeners = [];
      globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) }, sendMessage: async () => ({}) } };
      delete globalThis.__aceContentLoaded;
      ${contentBundle}
      let ping, describe;
      listeners[0]({ type: 'ace:ping' }, {}, (r) => { ping = r; });
      listeners[0]({ type: 'ace:describe' }, {}, (r) => { describe = r; });
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
