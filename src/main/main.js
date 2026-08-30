'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, session, screen, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const store = require('./lib/store');
const convert = require('./lib/convert');
const inject = require('./lib/inject');
const { exportConversation, exportMerged } = require('./exporters');
const { PROVIDERS, COMMON_STRIP, COMMON_EXPAND, matchProvider } = require('../shared/providers');

const GUEST_PARTITION = 'persist:aichats';
const isDev = process.argv.includes('--dev');

// Electron derives the user-data folder from the app name, which differs
// between a packaged build (productName) and `npm start` (package.json name).
// Left alone, settings and the library would live in two different places and
// the built app would look like it had lost them. Pin it to one name.
// Note: an explicit app.setPath('userData', …) — as the e2e test does — still
// wins, because a path set by hand is never recomputed from the name.
app.setName('AI Chat Extractor');

/**
 * Chat providers serve degraded pages, or refuse outright, when they see an
 * Electron user agent. Present as plain Chrome instead.
 */
function normaliseUserAgent() {
  const ua = app.userAgentFallback
    .replace(/ Electron\/[\d.]+/, '')
    .replace(new RegExp(` ${app.getName()}/[\\d.]+`), '');
  app.userAgentFallback = ua;
  return ua;
}

let mainWindow = null;

/**
 * Sizes the window to fit the screen it will open on.
 *
 * A fixed 1500x950 default is taller than the work area of a 1366x768 laptop,
 * which puts the bottom of the window — and the status bar with it — off-screen
 * with no way to reach it. Clamp to what is actually available, and keep the
 * minimum small enough that the window still fits on a short display.
 */
function preferredBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1500, Math.max(800, workArea.width - 80));
  const height = Math.min(950, Math.max(520, workArea.height - 60));
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    minWidth: Math.min(900, workArea.width),
    minHeight: Math.min(520, workArea.height),
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...preferredBounds(),
    backgroundColor: '#0f1115',
    title: 'AI Chat Extractor',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // the preload needs require() for path/ipc plumbing
      webviewTag: true,
      spellcheck: false,
      // A batch run left minimised must keep scrolling and reading normally.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Links clicked in our own UI go to the real browser, never a new app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Guest pages need popups for third-party sign-in (Google, Microsoft). Allow
 * them, but keep them inside the same persistent partition so the resulting
 * session cookies land where the webview can use them.
 */
function configureGuestWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.setWindowOpenHandler(({ url }) => ({
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 520,
        height: 700,
        autoHideMenuBar: true,
        webPreferences: { partition: GUEST_PARTITION, contextIsolation: true, nodeIntegration: false },
      },
    }));

    contents.on('will-navigate', (_e, url) => {
      mainWindow?.webContents.send('guest:navigated', url);
    });
  });
}

/* ------------------------------------------------------- injection sources */

/** Built-in pack for the URL, overlaid with anything the user taught us. */
function resolvePack(url) {
  const builtin = matchProvider(url, PROVIDERS) || {};
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    /* unparseable URL: fall through with an empty host */
  }
  const userPacks = store.getUserPacks();
  const user = userPacks[host] || {};
  const merged = { ...builtin, ...user };
  if (builtin.genericName && !user.name) merged.name = host || builtin.name;
  if (user.turnSelector) merged.name = user.name || merged.name || host;
  return { pack: merged, source: user.turnSelector ? 'user' : builtin.id ? 'builtin' : 'heuristic' };
}

async function buildExtractorSource(url) {
  const settings = store.getSettings();
  const { pack, source } = resolvePack(url);
  const config = {
    pack,
    commonStrip: COMMON_STRIP,
    commonExpand: COMMON_EXPAND,
    embedImages: settings.embedImages !== false,
    settleMs: Math.max(100, settings.settleMs || 450),
    maxScrollSteps: Math.max(20, settings.maxScrollSteps || 400),
    maxImageBytes: 12 * 1024 * 1024,
    maxTotalImageBytes: 150 * 1024 * 1024,
    maxDurationMs: Math.max(15000, (settings.maxReadSeconds || 90) * 1000),
  };
  return { source: await inject.buildExtractorSource(config), packSource: source, pack };
}

/* ------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch || {}));

  ipcMain.handle('providers:list', () =>
    PROVIDERS.map((p) => ({ id: p.id, name: p.name, hosts: p.hosts }))
  );
  ipcMain.handle('packs:get', () => store.getUserPacks());
  ipcMain.handle('packs:save', (_e, { host, pack }) => store.saveUserPack(host, pack));
  ipcMain.handle('packs:resolve', (_e, url) => resolvePack(url));

  ipcMain.handle('library:get', (_e, limit) => store.getLibrary(limit));
  ipcMain.handle('library:search', (_e, query) => store.searchLibrary(query));
  ipcMain.handle('library:clear', () => store.clearLibrary());

  ipcMain.handle('merge:pickFiles', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose exported chat JSON files to merge',
      filters: [{ name: 'AI Chat Extractor JSON', extensions: ['json'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];

    const loaded = [];
    for (const file of result.filePaths) {
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!Array.isArray(parsed.messages)) {
          loaded.push({ file, error: 'Not an exported conversation (no messages array).' });
          continue;
        }
        loaded.push({
          file,
          title: parsed.title || path.basename(file, '.json'),
          url: parsed.url || '',
          provider: parsed.provider?.name || '',
          messageCount: parsed.messages.length,
          source: parsed,
        });
      } catch (err) {
        loaded.push({ file, error: err.message });
      }
    }
    return loaded;
  });

  ipcMain.handle('merge:run', async (_e, { ids, externals, formats, options }) => {
    const settings = store.getSettings();
    const merged = { ...settings, ...(options || {}) };
    const sources = [...store.getLibraryRecords(ids || []), ...(externals || [])];
    if (!sources.length) throw new Error('Nothing selected to merge.');

    const outDir = merged.outDir || settings.outDir;
    try {
      const { files, notes } = await exportMerged({ sources, formats, outDir, options: merged });
      return { results: [{ format: 'merged', ok: true, files, notes }], outDir };
    } catch (err) {
      return { results: [{ format: 'merged', ok: false, error: err?.message || String(err) }], outDir };
    }
  });

  ipcMain.handle('inject:extractor', (_e, url) => buildExtractorSource(url));
  ipcMain.handle('inject:picker', () => inject.buildPickerSource());

  ipcMain.handle('dialog:chooseDir', async (_e, current) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose export folder',
      defaultPath: current || store.getSettings().outDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('shell:open', (_e, target) => shell.openPath(target));
  ipcMain.handle('shell:reveal', (_e, target) => shell.showItemInFolder(target));
  ipcMain.handle('shell:external', (_e, url) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  /**
   * Fetches images through the guest session, where the cookies are.
   *
   * The extractor tries this from inside the page first, which works for
   * anything same-origin. It cannot work for the usual case though: pictures
   * are served from a separate, authenticated CDN, and a page-context fetch to
   * another origin is blocked by CORS. Running it here instead uses the same
   * cookie jar the webview browsed with and is not subject to page CORS, so
   * the picture ends up embedded rather than left as a link that will not load
   * outside the browser.
   */
  ipcMain.handle('images:fetchMany', async (_e, urls) => {
    const guest = session.fromPartition(GUEST_PARTITION);
    const out = {};
    let budget = 150 * 1024 * 1024;

    await Promise.all(
      (urls || []).slice(0, 400).map(async (url) => {
        if (out[url] !== undefined) return;
        try {
          const response = await guest.fetch(url, { credentials: 'include' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length > 12 * 1024 * 1024 || buffer.length > budget) {
            out[url] = null;
            return;
          }
          budget -= buffer.length;
          const mime = response.headers.get('content-type') || 'image/png';
          out[url] = `data:${mime.split(';')[0]};base64,${buffer.toString('base64')}`;
        } catch {
          out[url] = null;
        }
      })
    );
    return out;
  });

  ipcMain.handle('session:clear', async () => {
    const guest = session.fromPartition(GUEST_PARTITION);
    await guest.clearStorageData();
    await guest.clearCache();
    return true;
  });

  /**
   * Runs one or more format exports over a single extraction. Formats are
   * attempted independently so one failure (a 20k-page PDF, say) doesn't cost
   * the user the other outputs.
   */
  ipcMain.handle('export:run', async (_e, { raw, formats, options, webContentsId }) => {
    const settings = store.getSettings();
    const merged = { ...settings, ...(options || {}) };
    const conversation = convert.prepare(raw, {
      includeThinking: merged.includeThinking !== false,
      includeSystem: merged.includeSystem !== false,
      redactions: merged.redactions || [],
      selection: merged.selection || null,
    });
    if (!conversation.messages.length) {
      throw new Error('No messages selected — tick at least one message to export.');
    }

    const outDir = merged.outDir || settings.outDir;
    const results = [];

    for (const format of formats) {
      try {
        const { files, notes } = await exportConversation({
          conversation,
          format,
          outDir,
          options: merged,
          webContentsId,
        });
        results.push({ format, ok: true, files, notes });
      } catch (err) {
        results.push({ format, ok: false, error: err?.message || String(err) });
      }
    }

    const succeeded = results.filter((r) => r.ok).flatMap((r) => r.files);
    if (succeeded.length) {
      // Store the conversation itself, not just a log line: this is what makes
      // the export searchable later and mergeable without revisiting the site.
      await store.addLibraryEntry({
        title: conversation.title,
        url: conversation.url,
        provider: conversation.providerName,
        capturedAt: conversation.capturedAt,
        messageCount: conversation.messages.length,
        formats: results.filter((r) => r.ok).map((r) => r.format),
        files: succeeded,
        messages: conversation.messages.map((m) => ({
          role: m.role,
          label: m.label,
          markdown: m.markdown,
          text: m.text,
        })),
      });
    }
    return { results, outDir };
  });

  ipcMain.handle('export:preview', (_e, { raw, options }) => {
    const merged = { ...store.getSettings(), ...(options || {}) };
    // Selection is deliberately ignored here: the preview is where the user
    // ticks messages, so it must list everything that could be exported.
    const conversation = convert.prepare(raw, {
      includeThinking: merged.includeThinking !== false,
      includeSystem: merged.includeSystem !== false,
      redactions: merged.redactions || [],
      selection: null,
    });
    return {
      title: conversation.title,
      providerName: conversation.providerName,
      url: conversation.url,
      stats: conversation.stats,
      messages: conversation.messages.map((m) => ({
        index: m.index,
        originalIndex: m.originalIndex,
        role: m.role,
        label: m.label,
        markdown: m.markdown.slice(0, 1200),
        truncated: m.markdown.length > 1200,
        characters: m.markdown.length,
        hasReasoning: Boolean(m.thinkingMarkdown),
        codeBlocks: (m.markdown.match(/^```/gm) || []).length >> 1,
      })),
    };
  });
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open export folder',
          click: () => shell.openPath(store.getSettings().outDir),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Session',
      submenu: [
        {
          label: 'Sign out of all chat sites (clear browsing data)',
          click: async () => {
            const { response } = await dialog.showMessageBox(mainWindow, {
              type: 'warning',
              buttons: ['Clear', 'Cancel'],
              defaultId: 1,
              cancelId: 1,
              message: 'Clear all cookies and site data for the embedded browser?',
              detail: 'You will be signed out of every chat provider you logged into inside this app. Your exported files are not affected.',
            });
            if (response !== 0) return;
            const guest = session.fromPartition(GUEST_PARTITION);
            await guest.clearStorageData();
            await guest.clearCache();
            mainWindow?.webContents.send('session:cleared');
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------- boot */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    normaliseUserAgent();
    configureGuestWebContents();
    registerIpc();
    buildMenu();

    // Make sure the export folder exists before the first export attempt.
    const settings = store.getSettings();
    await fs.mkdir(settings.outDir, { recursive: true }).catch(() => {});

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
