'use strict';

const {
  api, ensureHostAccess, ensureContentScript, isScriptableUrl, sendToTab,
} = require('../lib/browser');
const storage = require('../lib/storage');
const exporters = require('../lib/exporters');
const { captureFullPage } = require('../lib/screenshot');
const { downloadBlob } = require('../lib/download');
const folder = require('../lib/folder');

const convert = require('../../../src/main/lib/convert.js');
const { renderHtml } = require('../../../src/main/lib/render.js');
const merge = require('../../../src/main/exporters/merge.js');
const rules = require('../../../src/shared/rules.js');
const { PARTS, STATUS } = require('../../../src/shared/parts.js');
const help = require('../../../src/shared/help.js');
const ui = require('../../../src/shared/ui.js');
const { marked } = require('marked');
// The user manual, bundled as text by extension/build.js.
const MANUAL = require('../../../docs/MANUAL.md');

/**
 * The workspace. A normal extension page in a tab, which is the point: a popup
 * would close the moment focus moved and abandon whatever was running.
 */

const $ = (id) => document.getElementById(id);
const { el, button, paint, statusOf, healthLine, partChips, countsOf, describeProblems, focusFor } = ui;

let settings = {};
let targetTabId = null;
let targetUrl = '';
let lastRaw = null;
let previewMessages = [];
let selectedMessages = new Set();
let mergeExternals = [];
const mergeSelectedIds = new Set();
let batchAbort = false;

// The rules that read the attached chat: { set, source, name, off }.
let siteState = { set: null, source: 'none', name: '' };
let liveCounts = null;
let teaching = false;
let teachRun = 0;

let manual = null;
let whatsThis = null;

const setStatus = (msg) => { $('status').textContent = msg; $('status').title = msg; };
const busy = (on, text = 'Working…') => { $('busy').hidden = !on; $('busyText').textContent = text; };

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/* ------------------------------------------------- where files are kept */

/** The folder's parts, in the colours the desktop app shows them in. */
const FOLDER_PARTS = [
  { key: 'settings', color: '#94a3b8', text: 'extension-settings.json — the options you changed' },
  { key: 'rules', color: '#a78bfa', text: 'site-rules.json — site rules, shared with the desktop app' },
  { key: 'exports', color: '#22c55e', text: 'exported chats' },
];

const FOLDER_NOTES = {
  unsupported: 'This browser does not let extensions keep files in a folder of your choice — only Chrome and Edge do. Your options and site rules are kept in its own storage; “Export…” in Site rules saves your rules as a file.',
  none: 'Your options and site rules are kept in the browser, and exports go to Downloads/AI Chat Exports. Choose a folder to keep them there too — the project’s data folder, say, which the desktop app uses, so both share one set of site rules.',
  'needs-permission': 'The browser asks again after it restarts. Until you allow it, changes stay in the browser and exports go to Downloads.',
  ready: 'Your options and site rules are kept in this folder as well as in the browser, and exports are saved in its exports folder.',
};

function renderFolder(now) {
  const status = (now && now.status) || 'none';
  const name = (now && now.name) || '';
  paint($('folderDot'), { ready: '#22c55e', 'needs-permission': '#f59e0b' }[status] || '#6b7280');
  $('folderText').textContent = {
    ready: `Also in the folder “${name}”`,
    'needs-permission': `“${name}” — waiting for your permission`,
  }[status] || 'Only in this browser';
  $('folderNote').textContent = FOLDER_NOTES[status];
  const parts = $('folderParts');
  parts.textContent = '';
  parts.hidden = status !== 'ready' && status !== 'needs-permission';
  for (const part of FOLDER_PARTS) {
    const row = paint(el('div', 'datafolder-item'), part.color);
    row.append(el('i'), el('strong', '', part.key), el('span', '', part.text));
    parts.appendChild(row);
  }
  $('folderChooseBtn').hidden = status === 'unsupported';
  $('folderChooseBtn').textContent = status === 'none' ? 'Choose a folder…' : 'Choose another…';
  $('folderAllowBtn').hidden = status !== 'needs-permission';
  $('folderForgetBtn').hidden = status !== 'ready' && status !== 'needs-permission';
}

/**
 * Brings the browser's copies and the folder's into step and shows the
 * result: the desktop app may have changed the shared rules meanwhile.
 */
async function refreshFromFolder() {
  const settingsBefore = JSON.stringify(await storage.getSettings());
  const rulesBefore = (await storage.getSiteRules()).savedAt;
  const now = await storage.syncFolder().catch(() => null);
  renderFolder(now);
  if (JSON.stringify(await storage.getSettings()) !== settingsBefore) {
    settings = await storage.getSettings();
    applySettingsToUi();
  }
  if ((await storage.getSiteRules()).savedAt !== rulesBefore) {
    await refreshSiteRules();
    if (activeTab() === 'rules') loadRulesManager();
  }
  return now;
}

/** Where exports are about to go, in words. */
async function exportDestination() {
  const handle = await folder.ready().catch(() => null);
  return handle ? `${handle.name}/exports` : 'Downloads/AI Chat Exports';
}

/* -------------------------------------------------------------- settings */

const FIELD_MAP = {
  filenameTpl: 'filenameTemplate',
  themeSel: 'theme',
  fontSizeIn: 'fontSize',
  optThinking: 'includeThinking',
  optSystem: 'includeSystem',
  optMeta: 'includeMeta',
  optFrontmatter: 'frontmatter',
  optEmbed: 'embedImages',
  assetMode: 'assetMode',
  optBreakTurn: 'pageBreakPerTurn',
  optExpandLinks: 'expandLinks',
  settleMs: 'settleMs',
  maxReadSeconds: 'maxReadSeconds',
  screenshotDelayMs: 'screenshotDelayMs',
  jpegQ: 'jpegQuality',
  minCodeLines: 'minCodeLines',
  assistantOnlyCode: 'assistantOnlyCode',
  batchGuess: 'batchGuessUnknown',
};

function applySettingsToUi() {
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const field = $(id);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(settings[key]);
    else field.value = settings[key] ?? '';
  }
  const formats = new Set(settings.lastFormats || ['md']);
  for (const input of $('formats').querySelectorAll('input')) input.checked = formats.has(input.value);
  renderRedactions();
}

function collectOptions() {
  const opts = {};
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const field = $(id);
    if (!field) continue;
    if (field.type === 'checkbox') opts[key] = field.checked;
    else if (field.type === 'number') opts[key] = Number(field.value);
    else opts[key] = field.value;
  }
  opts.lastFormats = chosenFormats();
  opts.redactions = collectRedactions();
  opts.selection =
    previewMessages.length && selectedMessages.size < previewMessages.length
      ? [...selectedMessages]
      : null;
  return opts;
}

let saveTimer = null;
function persistSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { settings = await storage.saveSettings(collectOptions()); }, 250);
}

const chosenFormats = () =>
  Array.from($('formats').querySelectorAll('input:checked')).map((i) => i.value);

/* ------------------------------------------------------------ redactions */

function renderRedactions() {
  $('redactions').innerHTML = '';
  for (const rule of settings.redactions || []) addRedactionRow(rule);
}

function addRedactionRow(rule = { find: '', replace: '[redacted]', regex: false }) {
  const row = document.createElement('div');
  row.className = 'redaction';

  const find = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'find', value: rule.find || '' });
  const replace = Object.assign(document.createElement('input'), { type: 'text', placeholder: 'replace with', value: rule.replace ?? '[redacted]' });

  const label = document.createElement('label');
  const regex = Object.assign(document.createElement('input'), { type: 'checkbox', checked: Boolean(rule.regex) });
  label.title = 'Treat "find" as a regular expression';
  label.append(regex, document.createTextNode('re'));

  const remove = Object.assign(document.createElement('button'), { className: 'btn', textContent: '×', title: 'Remove' });
  remove.addEventListener('click', () => { row.remove(); persistSettings(); });

  for (const field of [find, replace, regex]) field.addEventListener('input', persistSettings);
  row.append(find, replace, label, remove);
  $('redactions').appendChild(row);
}

const collectRedactions = () =>
  Array.from($('redactions').querySelectorAll('.redaction'))
    .map((row) => {
      const [find, replace] = row.querySelectorAll('input[type=text]');
      return { find: find.value, replace: replace.value, regex: row.querySelector('input[type=checkbox]').checked };
    })
    .filter((r) => r.find);

/* ---------------------------------------------------------------- target */

async function attachTarget(tabId) {
  targetTabId = tabId;
  if (!tabId) return;
  try {
    const tab = await api.tabs.get(tabId);
    if (!isScriptableUrl(tab.url)) {
      $('target').textContent = 'That tab is not a readable web page.';
      return;
    }
    await ensureContentScript(tabId);
    await sendToTab(tabId, { type: 'ace:describe' });
    targetUrl = tab.url;
    $('target').textContent = `Attached to: ${tab.title || tab.url}`;
    $('readBtn').disabled = false;
    await refreshSiteRules();
  } catch (err) {
    $('target').textContent = `Could not attach to that tab: ${err.message}`;
  }
}

/** The chat tab's address now — single-page chat sites change it as you move between chats. */
async function currentTargetUrl() {
  try {
    const tab = await api.tabs.get(targetTabId);
    if (tab.url !== targetUrl) {
      targetUrl = tab.url;
      liveCounts = null;
      await refreshSiteRules();
    }
  } catch {
    /* the tab has gone; keep what we had */
  }
  return targetUrl;
}

/**
 * Runs something with the chat tab in the foreground, then puts the workspace
 * back in front.
 *
 * This is not cosmetic. Browsers throttle background tabs hard: no animation
 * frames, timers clamped to a second or worse. The site's own virtualiser is
 * driven by those, so in a background tab it never re-renders as we scroll and
 * the read stalls or comes back short. Since opening this workspace in a new
 * tab is itself what pushes the chat into the background, every operation that
 * drives the page has to bring it forward again first.
 */
async function withTabFocused(tabId, work) {
  const self = await api.tabs.getCurrent();
  let restored = false;
  try {
    const tab = await api.tabs.get(tabId);
    await api.tabs.update(tabId, { active: true });
    if (tab.windowId != null) await api.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return await work();
  } finally {
    if (!restored && self) {
      restored = true;
      await api.tabs.update(self.id, { active: true }).catch(() => {});
      if (self.windowId != null) await api.windows.update(self.windowId, { focused: true }).catch(() => {});
    }
  }
}

/* ------------------------------------------------------------ site rules */

async function refreshSiteRules() {
  siteState = targetUrl
    ? rules.siteSummary(targetUrl, await storage.getSiteRules())
    : { set: null, source: 'none', name: '' };
  renderBadge();
  renderSiteCard();
}

function renderBadge() {
  const badge = $('providerBadge');
  const { set, source, name, off } = siteState;
  if (!targetUrl) {
    badge.className = 'badge';
    badge.textContent = 'no chat attached';
  } else if (set) {
    const broken = statusOf(set) === 'broken';
    badge.className = `badge ${broken ? 'broken' : source === 'user' ? 'user' : 'known'}`;
    badge.textContent = `${name} · ${source === 'user' ? 'your rules' : 'built-in rules'}${broken ? ' · broken' : ''}`;
  } else if (off) {
    badge.className = 'badge off';
    badge.textContent = `${off.name} · rules ${off.removed ? 'removed' : 'turned off'}`;
  } else {
    badge.className = 'badge guess';
    badge.textContent = 'no rules · will guess';
  }
}

function renderSiteCard() {
  const { set, source, name, off } = siteState;
  const note = $('siteNote');
  note.hidden = true;
  note.className = 'sitecard-note';
  $('siteChips').replaceWith(Object.assign(set ? partChips(set, countsOf(set, liveCounts)) : el('div', 'chips'), { id: 'siteChips' }));
  paint($('siteDot'), STATUS[set ? statusOf(set) : off ? 'off' : 'unknown'].color);

  const teachBtn = $('teachBtn');
  teachBtn.classList.remove('primary');
  if (!targetUrl) {
    $('siteName').textContent = 'No chat attached';
    $('siteSub').textContent = 'Open this workspace from a chat to see which rules read it.';
  } else if (set) {
    $('siteName').textContent = name;
    $('siteSub').textContent = `${source === 'user' ? 'Your rules' : 'Built-in rules'} · ${healthLine(set.health)}`;
    teachBtn.textContent = 'Fix these rules';
    if (statusOf(set) === 'broken') teachBtn.classList.add('primary');
  } else if (off) {
    $('siteName').textContent = off.name;
    $('siteSub').textContent = off.removed ? 'Built-in rules removed — the layout will be guessed.' : 'Rules turned off — the layout will be guessed.';
    teachBtn.textContent = 'Teach this site';
  } else {
    $('siteName').textContent = hostOf(targetUrl) || 'This page';
    $('siteSub').textContent = 'No rules yet — the layout will be guessed.';
    note.textContent = 'Teach the extension this site once and it will know it from then on. It starts with its own guess, so usually you only check the colours and save.';
    note.hidden = false;
    teachBtn.textContent = 'Teach this site';
    teachBtn.classList.add('primary');
  }

  if (teaching) {
    note.className = 'sitecard-note warn';
    note.textContent = '';
    note.append(
      document.createTextNode('The panel is open on the chat tab — use it there, then save or close it. '),
      button('Stop', 'btn', stopTeaching)
    );
    note.hidden = false;
  }

  ui.renderSiteSwitch($('siteSwitchRow'), $('siteSwitch'), targetUrl ? siteState.choices : [], switchSiteRules);
  $('siteSwitch').disabled = teaching;

  const usable = Boolean(targetUrl) && !teaching;
  teachBtn.disabled = !usable;
  $('showRulesBtn').disabled = !usable || !set;
}

/** The quick switch on the site card: read this site with another of its rule sets. */
function switchSiteRules(id) {
  const choice = (siteState.choices || []).find((c) => c.id === id);
  liveCounts = null;
  changeRules((s) => rules.setDefault(s, id),
    `Now using “${choice ? choice.name : 'those rules'}” for this site. Read the chat again to see what they find.`);
}

/** Keeps the rule manager's "last checked" up to date with every read. */
function recordHealth(result, url) {
  if (!result || !result.rules || !result.rules.id || !result.health) return;
  const health = {
    ...result.health,
    at: new Date().toISOString(),
    url,
    counts: { ...result.health.counts },
    parts: result.health.parts,
    found: result.health.found,
  };
  storage.updateSiteRules((store) => rules.recordHealth(store, result.rules.id, health))
    .then(() => {
      liveCounts = null;
      return refreshSiteRules();
    })
    .catch(() => {});
}

/* -------------------------------------------------------------- teaching */

function setTeaching(on) {
  teaching = on;
  $('readBtn').disabled = on || !targetTabId;
  $('exportBtn').disabled = on || !lastRaw;
  renderSiteCard();
}

async function stopTeaching() {
  if (!targetTabId) return;
  await sendToTab(targetTabId, { type: 'ace:teachClose' }).catch(() => {});
}

/**
 * Opens the teach panel on the chat tab — or, in "show" mode, just draws what
 * the rules find. The chat tab comes to the front for it, and the workspace
 * returns once the panel is saved or closed.
 */
async function teachSite({ mode = 'teach', focus = null, ruleId = null } = {}) {
  if (!targetTabId || teaching) return;
  const url = await currentTargetUrl();
  const store = await storage.getSiteRules();
  const set = ruleId ? rules.findSet(store, ruleId) : rules.resolve(url, store).set;
  const options = {
    mode,
    parts: PARTS,
    rules: set
      ? { name: rules.displayName(set, url), origin: set.origin, parts: set.parts, options: set.options, pathPrefix: set.pathPrefix }
      : null,
    siteName: hostOf(url) || 'this page',
    focus,
    saving: rules.saveChoices(store, url, set ? set.id : null),
  };

  const run = ++teachRun;
  setTeaching(true);
  setStatus(mode === 'show'
    ? 'The rules are drawn on the chat tab. Close the panel there when you are done.'
    : 'Teach panel open on the chat tab: choose a part, click it on the page, then save.');
  let response;
  try {
    const tab = await api.tabs.get(targetTabId);
    await api.tabs.update(targetTabId, { active: true });
    if (tab.windowId != null) await api.windows.update(tab.windowId, { focused: true }).catch(() => {});
    response = await sendToTab(targetTabId, { type: 'ace:teach', options });
  } catch (err) {
    // The tab navigated or closed while the panel was open.
    response = { ok: false, error: err.message };
  } finally {
    const self = await api.tabs.getCurrent();
    if (self) await api.tabs.update(self.id, { active: true }).catch(() => {});
  }
  if (run !== teachRun) return;
  setTeaching(false);
  const result = response && response.ok ? response.result : { ok: false, error: response && response.error };
  await afterTeach(result, url, set ? set.id : null);
}

async function afterTeach(result, url, baseId) {
  if (result && result.action === 'save') {
    try {
      const saved = await storage.updateSiteRules((store) => rules.saveTaught(store, {
        url,
        baseId,
        parts: result.parts,
        options: result.options,
        pathPrefix: result.pathPrefix,
        name: result.name,
        asNew: result.saveAs === 'new',
        makeDefault: result.makeDefault !== false,
      }));
      liveCounts = result.counts ? { ...result.counts, found: result.found } : null;
      await refreshSiteRules();
      if (activeTab() === 'rules') loadRulesManager();
      const s = result.summary || {};
      if (result.makeDefault === false && !result.pathPrefix) {
        setStatus(`Saved “${saved.name}”. The site is still read with the rules it used before — choose “${saved.name}” on the site card or in Site rules to use it.`);
        return;
      }
      setStatus(`Saved “${saved.name}”: ${s.user || 0} of your messages and ${s.assistant || 0} AI replies on this page. Reading the chat with them…`);
      await readChat();
    } catch (err) {
      setStatus(`Could not save the rules: ${err.message}`);
    }
    return;
  }
  if (result && result.action === 'close') {
    liveCounts = result.counts ? { ...result.counts, found: result.found } : null;
    renderSiteCard();
    const s = result.summary || {};
    setStatus(`On this page the rules find ${s.messages || 0} messages: ${s.user || 0} yours, ${s.assistant || 0} from the AI.`);
    return;
  }
  if (result && result.error) {
    setStatus(`The teach panel stopped: ${String(result.error).split('\n')[0]}`);
    return;
  }
  setStatus('Closed the teach panel — nothing was changed.');
}

/* --------------------------------------------------------------- reading */

async function readChat({ ignoreRules = false } = {}) {
  if (!targetTabId || teaching) return;
  busy(true, ignoreRules ? 'Reading the chat by guessing its layout…' : 'Scrolling the whole conversation and reading it…');
  $('readBtn').disabled = true;
  try {
    const url = await currentTargetUrl();
    const options = collectOptions();
    const { set } = ignoreRules ? { set: null } : rules.resolve(url, await storage.getSiteRules());
    const response = await withTabFocused(targetTabId, () =>
      sendToTab(targetTabId, { type: 'ace:capture', settings: options, rules: rules.compile(set, url) })
    );
    const result = response && response.ok
      ? response.result
      : { ok: false, error: (response && response.error) || 'the page did not answer' };
    recordHealth(result, url);

    if (!result.ok) {
      lastRaw = null;
      previewMessages = [];
      selectedMessages.clear();
      $('previewCard').hidden = true;
      $('exportBtn').disabled = true;
      renderReadStatus(result, null);
      setStatus('Nothing captured.');
      return;
    }

    lastRaw = result;
    renderReadStatus(result, await storage.lastExportOf(url).catch(() => null));
    setStatus(`Read "${lastRaw.title}" — ${lastRaw.stats.messages} messages.`);
    await renderPreview();
  } catch (err) {
    renderReadStatus({ ok: false, error: err.message }, null);
  } finally {
    busy(false);
    $('readBtn').disabled = teaching;
  }
}

/** The reading result, with buttons for whatever would fix a problem. */
function renderReadStatus(result, previous) {
  ui.renderReadStatus($('extractStatus'), result, previous, {
    fix: (focus) => teachSite({ focus }),
    guess: () => readChat({ ignoreRules: true }),
    show: () => teachSite({ mode: 'show' }),
    teach: () => teachSite(),
  });
}

function prepared(options = collectOptions(), withSelection = true) {
  return convert.prepare(lastRaw, {
    includeThinking: options.includeThinking !== false,
    includeSystem: options.includeSystem !== false,
    redactions: options.redactions || [],
    selection: withSelection ? options.selection : null,
  });
}

async function renderPreview({ keepSelection = false } = {}) {
  if (!lastRaw) return;
  const conversation = prepared(collectOptions(), false);
  previewMessages = conversation.messages;

  if (!keepSelection) selectedMessages = new Set(previewMessages.map((m) => m.originalIndex));
  else {
    const available = new Set(previewMessages.map((m) => m.originalIndex));
    selectedMessages = new Set([...selectedMessages].filter((i) => available.has(i)));
  }

  const list = $('previewList');
  list.innerHTML = '';
  for (const msg of previewMessages) {
    const row = document.createElement('label');
    row.className = `pv ${msg.role}`;

    const tick = Object.assign(document.createElement('input'), {
      type: 'checkbox', checked: selectedMessages.has(msg.originalIndex),
    });
    tick.addEventListener('change', () => {
      if (tick.checked) selectedMessages.add(msg.originalIndex);
      else selectedMessages.delete(msg.originalIndex);
      updateSelectionCount();
    });

    const codeBlocks = (msg.markdown.match(/^```/gm) || []).length >> 1;
    const bits = [msg.label];
    if (msg.thinkingMarkdown) bits.push('has reasoning');
    if (codeBlocks) bits.push(`${codeBlocks} code block${codeBlocks === 1 ? '' : 's'}`);

    const body = document.createElement('div');
    body.className = 'pvbody';
    const who = Object.assign(document.createElement('div'), { className: 'who', textContent: bits.join(' · ') });
    const txt = Object.assign(document.createElement('div'), {
      className: 'txt',
      textContent: msg.markdown.slice(0, 1200) + (msg.markdown.length > 1200 ? ' …' : ''),
    });
    body.append(who, txt);
    row.append(tick, body);
    list.appendChild(row);
  }

  updateSelectionCount();
  $('previewCard').hidden = false;
}

function updateSelectionCount() {
  const total = previewMessages.length;
  const chosen = selectedMessages.size;
  $('selectionCount').textContent = chosen === total ? `all ${total} messages` : `${chosen} of ${total} messages`;
  $('exportBtn').disabled = !lastRaw || chosen === 0 || teaching;
}

function applySelectionPreset(preset) {
  const all = previewMessages.map((m) => m.originalIndex);
  if (preset === 'all') selectedMessages = new Set(all);
  else if (preset === 'none') selectedMessages.clear();
  else if (preset === 'invert') selectedMessages = new Set(all.filter((i) => !selectedMessages.has(i)));
  else selectedMessages = new Set(previewMessages.filter((m) => m.role === preset).map((m) => m.originalIndex));

  const boxes = [...$('previewList').querySelectorAll('input[type=checkbox]')];
  boxes.forEach((box, i) => { box.checked = selectedMessages.has(previewMessages[i].originalIndex); });
  updateSelectionCount();
}

/* -------------------------------------------------------------- exporting */

/** Hands a rendered document to the browser's print dialog. */
async function openPrintTab(html, title) {
  const key = `ace:print:${Date.now().toString(36)}`;
  await api.storage.local.set({ [key]: { html, title } });
  await api.tabs.create({ url: api.runtime.getURL(`print.html?key=${encodeURIComponent(key)}`) });
}

async function runExport() {
  if (!lastRaw) return;
  const formats = chosenFormats();
  if (!formats.length) { setStatus('Pick at least one format.'); return; }

  const options = collectOptions();
  settings = await storage.saveSettings(options);
  const conversation = prepared(options);

  busy(true, `Exporting ${formats.length} format${formats.length > 1 ? 's' : ''}…`);
  $('exportBtn').disabled = true;
  try {
    const fileFormats = formats.filter((f) => !['pdf', 'png', 'jpg'].includes(f));
    const result = await exporters.exportConversation(conversation, fileFormats, options);

    // PDF and images cannot go through the file exporter: one needs the print
    // dialog, the other needs the original tab still on screen.
    if (formats.includes('pdf')) {
      // The print window suggests the page's title as the PDF's name, so give
      // it the same name every other format gets.
      await openPrintTab(renderHtml(conversation, options), exporters.formatFilename(options.filenameTemplate, conversation));
      result.notes.push('PDF opened in a new tab — choose "Save as PDF" in the print dialog.');
    }

    for (const imageFormat of ['png', 'jpg'].filter((f) => formats.includes(f))) {
      try {
        const shot = await captureImages(conversation, imageFormat, options);
        result.files.push(...shot.files);
        result.notes.push(...shot.notes);
      } catch (err) {
        result.errors.push(`${imageFormat}: ${err.message}`);
      }
    }

    renderResults(result, 'results');
    setStatus(
      result.errors.length
        ? `Exported ${result.files.length} file(s); ${result.errors.length} failed.`
        : `Exported ${result.files.length} file(s) to ${await exportDestination()}.`
    );

    await storage.addLibraryEntry({
      title: conversation.title,
      url: conversation.url,
      provider: conversation.providerName,
      capturedAt: conversation.capturedAt,
      messageCount: conversation.messages.length,
      formats,
      messages: conversation.messages.map((m) => ({
        role: m.role, label: m.label, markdown: m.markdown, text: m.text,
      })),
    });
    loadLibrary();
    loadMergeList();
  } catch (err) {
    setStatus(`Export failed: ${err.message}`);
  } finally {
    busy(false);
    updateSelectionCount();
  }
}

async function captureImages(conversation, format, options) {
  if (!targetTabId) throw new Error('the original tab is no longer attached');
  const tab = await api.tabs.get(targetTabId);

  busy(true, 'Capturing the page — the chat tab has to stay in front…');
  const shot = await withTabFocused(targetTabId, () =>
    captureFullPage(targetTabId, tab.windowId, {
      format: format === 'jpg' ? 'jpeg' : 'png',
      quality: options.jpegQuality,
      delayMs: options.screenshotDelayMs,
      onProgress: (fraction) => busy(true, `Capturing the page… ${Math.round(fraction * 100)}%`),
    })
  );

  const base = exporters.formatFilename(options.filenameTemplate, conversation);
  const ext = format === 'jpg' ? 'jpg' : 'png';
  const files = [];
  const notes = [];

  for (const [i, blob] of shot.blobs.entries()) {
    const name = shot.blobs.length === 1 ? `${base}.${ext}` : `${base} - part ${i + 1}.${ext}`;
    const saved = await downloadBlob(blob, exporters.inFolder(name));
    files.push(saved.filename);
  }
  if (shot.blobs.length > 1) notes.push(`Page is ${shot.height}px tall — split into ${shot.blobs.length} image tiles.`);
  return { files, notes };
}

function renderResults(result, targetId) {
  const host = $(targetId);
  host.innerHTML = '';
  for (const name of result.files || []) {
    const row = document.createElement('div');
    row.className = 'result';
    row.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: name, title: name }));
    host.appendChild(row);
  }
  for (const note of result.notes || []) {
    host.appendChild(Object.assign(document.createElement('div'), { className: 'note', textContent: note }));
  }
  for (const error of result.errors || []) {
    const row = document.createElement('div');
    row.className = 'result bad';
    row.appendChild(Object.assign(document.createElement('span'), { className: 'name', textContent: error }));
    host.appendChild(row);
  }
}

/* ------------------------------------------------------- the rule manager */

async function changeRules(change, message) {
  try {
    const outcome = await storage.updateSiteRules(change);
    if (message) setStatus(typeof message === 'function' ? message(outcome) : message);
  } catch (err) {
    setStatus(`That did not work: ${err.message}`);
  }
  await refreshSiteRules();
  await loadRulesManager();
}

const siteOf = (set) => set.hosts.find((h) => h.includes('.')) || set.hosts[0];

/** What each button for one rule set does, in its site's card. */
function cardActions(set) {
  return {
    use: () => changeRules((s) => rules.setDefault(s, set.id),
      `Now using “${set.name}” for ${siteOf(set)}. Read a chat there again to see what they find.`),
    show: () => teachSite({ mode: 'show', ruleId: set.id }),
    fix: () => teachSite({ ruleId: set.id }),
    rename: (name) => changeRules((s) => rules.saveUserSet(s, { ...set, name }), 'Renamed.'),
    copy: () => changeRules((s) => rules.duplicateSet(s, set.id), (made) =>
      `Made “${made.name}”, a copy of ${set.name}. It is not used until you choose it with its round button.`),
    exportRules: () => exportRules([set.id]),
    remove: () => changeRules((s) => rules.deleteUserSet(s, set.id), `Deleted “${set.name}”.`),
    removeBuiltin: () => changeRules((s) => rules.removeBuiltin(s, set.id), `Removed the built-in rules for ${set.name}.`),
    restore: () => changeRules((s) => rules.restoreBuiltin(s, set.id), `${set.name}: restored.`),
    saveParts: (parts) => changeRules((s) => rules.saveUserSet(s, { ...set, parts }), `Saved the changes to ${set.name}.`),
    confirm: (question) => window.confirm(question),
  };
}

/** What the buttons for a whole site do. */
const siteActions = {
  resetToBuiltin: (group) => changeRules((s) => rules.setDefault(s, group.builtin.id),
    `${group.name}: back to the built-in rules. Your own rule sets for it are still in the list.`),
};

async function loadRulesManager() {
  const groups = rules.siteGroups(await storage.getSiteRules(), targetUrl);
  const removed = ui.renderSiteGroups(
    groups,
    { user: $('userRules'), builtins: $('builtinRules'), removed: $('removedRules') },
    $('rulesFilter').value,
    cardActions,
    siteActions,
    (set) => Boolean(set.onThisPage && targetTabId && !teaching)
  );
  $('removedBox').hidden = !removed;
  $('removedCount').textContent = String(removed);
}

async function exportRules(ids) {
  try {
    const file = rules.exportSets(await storage.getSiteRules(), ids || []);
    if (!file.sets.length) {
      setStatus('You have no rules of your own to export yet.');
      return;
    }
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const stamp = new Date().toISOString().slice(0, 10);
    const saved = await downloadBlob(blob, exporters.inFolder(`AI Chat Extractor rules ${stamp}.json`), { area: 'rules' });
    setStatus(`Saved ${file.sets.length} set(s) of rules to ${saved.linked ? '' : 'Downloads/'}${saved.filename}`);
  } catch (err) {
    setStatus(`Could not export the rules: ${err.message}`);
  }
}

async function importRules(file) {
  try {
    const data = JSON.parse(await file.text());
    const result = await storage.updateSiteRules((store) => rules.importSets(store, data));
    const parts = [`Imported ${result.added} set(s) of rules`];
    if (result.skipped) parts.push(`${result.skipped} you already had`);
    if (result.invalid) parts.push(`${result.invalid} unreadable and left out`);
    setStatus(`${parts.join(', ')}.`);
  } catch (err) {
    setStatus(`Could not import that file: ${err.message}`);
  }
  await refreshSiteRules();
  await loadRulesManager();
}

/* --------------------------------------------------------------- library */

async function loadLibrary(query = '') {
  const entries = query.trim() ? await storage.searchLibrary(query) : await storage.getLibrary();
  const host = $('historyList');
  host.innerHTML = '';
  if (!entries.length) {
    host.innerHTML = query.trim()
      ? '<p class="muted small">Nothing matched that search.</p>'
      : '<p class="muted small">No exports yet. Everything you export is indexed here and becomes searchable.</p>';
    return;
  }
  for (const entry of entries) {
    const card = document.createElement('div');
    card.className = 'hist';
    card.appendChild(Object.assign(document.createElement('div'), { className: 't', textContent: entry.title || 'Untitled' }));

    const sub = document.createElement('div');
    sub.className = 's';
    sub.append(document.createTextNode(
      `${entry.provider || '?'} · ${entry.messageCount ?? '?'} msgs · ${(entry.formats || []).join(', ')} · ${new Date(entry.at).toLocaleString()}`
    ));
    if (entry.url) {
      const open = Object.assign(document.createElement('button'), { className: 'mini', textContent: 'open chat' });
      open.addEventListener('click', () => api.tabs.create({ url: entry.url }));
      sub.appendChild(open);
    }
    const drop = Object.assign(document.createElement('button'), { className: 'mini', textContent: 'remove' });
    drop.addEventListener('click', async () => {
      await storage.deleteLibraryEntry(entry.id);
      loadLibrary($('librarySearch').value);
      loadMergeList();
    });
    sub.appendChild(drop);
    card.appendChild(sub);

    if (entry.snippet) {
      card.appendChild(Object.assign(document.createElement('div'), { className: 'snippet', textContent: entry.snippet }));
    }
    host.appendChild(card);
  }
}

/* ----------------------------------------------------------------- merge */

async function loadMergeList() {
  const entries = await storage.getLibrary(200);
  const host = $('mergeList');
  host.innerHTML = '';

  if (!entries.length && !mergeExternals.length) {
    host.innerHTML = '<p class="muted small">Nothing in the library yet. Export a chat first, or add .json files above.</p>';
    updateMergeButton();
    return;
  }

  for (const entry of entries) {
    const row = document.createElement('label');
    row.className = 'mergerow';
    const tick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: mergeSelectedIds.has(entry.id) });
    tick.addEventListener('change', () => {
      if (tick.checked) mergeSelectedIds.add(entry.id); else mergeSelectedIds.delete(entry.id);
      updateMergeButton();
    });
    const label = Object.assign(document.createElement('span'), {
      textContent: `${entry.title || 'Untitled'} — ${entry.messageCount ?? '?'} msgs · ${entry.provider || '?'}`,
    });
    row.append(tick, label);
    host.appendChild(row);
  }

  mergeExternals.forEach((external, i) => {
    const row = document.createElement('label');
    row.className = 'mergerow external';
    const tick = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true, disabled: true });
    const label = Object.assign(document.createElement('span'), {
      textContent: `${external.title} — ${external.messages.length} msgs · from file`,
    });
    const remove = Object.assign(document.createElement('button'), { className: 'mini', textContent: 'remove' });
    remove.addEventListener('click', (e) => { e.preventDefault(); mergeExternals.splice(i, 1); loadMergeList(); });
    row.append(tick, label, remove);
    host.appendChild(row);
  });

  updateMergeButton();
}

function updateMergeButton() {
  const count = mergeSelectedIds.size + mergeExternals.length;
  $('mergeRunBtn').disabled = count < 1;
  $('mergeRunBtn').textContent = count ? `Merge ${count} conversation${count === 1 ? '' : 's'}` : 'Merge selected';
}

async function addMergeFiles(fileList) {
  let added = 0;
  let failed = 0;
  for (const file of fileList) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.messages)) throw new Error('not an exported conversation');
      mergeExternals.push({
        title: parsed.title || file.name.replace(/\.json$/i, ''),
        url: parsed.url || '',
        provider: parsed.provider?.name || '',
        capturedAt: parsed.capturedAt || null,
        messages: parsed.messages,
      });
      added++;
    } catch {
      failed++;
    }
  }
  setStatus(`Added ${added} conversation(s)${failed ? `, ${failed} file(s) could not be read` : ''}.`);
  loadMergeList();
}

async function runMerge() {
  const formats = Array.from($('mergeFormats').querySelectorAll('input:checked')).map((i) => i.value);
  if (!formats.length) { setStatus('Pick at least one format for the merged document.'); return; }

  busy(true, 'Building the merged document…');
  try {
    const options = { ...collectOptions(), documentTitle: $('mergeTitle').value.trim() || 'Merged AI conversations' };
    const sources = [...(await storage.getLibraryRecords([...mergeSelectedIds])), ...mergeExternals];
    if (!sources.length) { setStatus('Nothing selected to merge.'); return; }

    const fileFormats = formats.filter((f) => f !== 'pdf');
    const result = await exporters.exportMerged(sources, fileFormats, options);
    result.notes = result.notes || [];
    if (formats.includes('pdf')) {
      await openPrintTab(merge.buildMergedHtml(sources, options), options.documentTitle);
      result.notes.push('PDF opened in a new tab — choose "Save as PDF" in the print dialog.');
    }
    renderResults(result, 'mergeResults');
    setStatus(result.errors.length ? `Merge finished with ${result.errors.length} problem(s).` : 'Merged document saved.');
  } catch (err) {
    setStatus(`Merge failed: ${err.message}`);
  } finally {
    busy(false);
  }
}

/* ----------------------------------------------------------------- batch */

function batchLog(text, cls = '') {
  const line = Object.assign(document.createElement('div'), { className: `logline ${cls}`, textContent: text });
  $('batchLog').appendChild(line);
  line.scrollIntoView({ block: 'nearest' });
  return line;
}

function waitForTabLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const done = (reason) => {
      api.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve(reason);
    };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done('loaded'); };
    const timer = setTimeout(() => done('timed out'), timeoutMs);
    api.tabs.onUpdated.addListener(listener);
  });
}

async function runBatch() {
  const urls = $('batchUrls').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) { setStatus('Add some links first.'); return; }
  const formats = chosenFormats().filter((f) => !['png', 'jpg', 'pdf'].includes(f));
  if (!formats.length) {
    setStatus('Pick at least one file format on the first tab (images and PDF cannot run unattended).');
    return;
  }

  batchAbort = false;
  $('batchBtn').disabled = true;
  $('batchStopBtn').hidden = false;
  $('batchLog').innerHTML = '';
  const guessUnknown = $('batchGuess').checked;

  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const [i, url] of urls.entries()) {
    if (batchAbort) { batchLog('Stopped.', 'err'); break; }
    const prefix = `[${i + 1}/${urls.length}]`;
    const line = batchLog(`${prefix} ${url}`, 'run');
    let tab = null;
    try {
      // Foreground on purpose: a background tab is throttled hard enough that
      // the site never re-renders while we scroll, and the read comes back
      // empty or short. Slower to watch, but it actually works.
      tab = await api.tabs.create({ url, active: true });
      const outcome = await waitForTabLoad(tab.id);
      if (outcome !== 'loaded') throw new Error(outcome);
      await new Promise((r) => setTimeout(r, 1200));

      const pageUrl = (await api.tabs.get(tab.id)).url || url;
      const store = await storage.getSiteRules();
      const { set } = rules.resolve(pageUrl, store);
      if (!set && !guessUnknown) {
        line.className = 'logline err';
        line.textContent = `${prefix} ${url} — skipped: no rules for ${hostOf(pageUrl)}. Teach the site, or tick “Also export sites that have no rules”.`;
        skipped++;
        continue;
      }

      await ensureContentScript(tab.id);
      const batchOptions = collectOptions();
      const response = await withTabFocused(tab.id, () =>
        sendToTab(tab.id, { type: 'ace:capture', settings: batchOptions, rules: rules.compile(set, pageUrl) })
      );
      const raw = response && response.ok ? response.result : null;
      recordHealth(raw, pageUrl);
      if (!raw || !raw.ok) {
        line.className = 'logline err';
        if (raw && raw.reason === 'rules-found-nothing') {
          line.textContent = `${prefix} ${url} — skipped: the rules for ${raw.rules.name} found nothing. Fix them in Site rules.`;
          skipped++;
        } else {
          line.textContent = `${prefix} ${url} — nothing could be read`;
          failed++;
        }
        continue;
      }
      if (raw.health && raw.health.status === 'broken') {
        line.className = 'logline err';
        line.textContent = `${prefix} ${url} — skipped: ${describeProblems(raw.health)[0] || 'the rules look broken'}`;
        skipped++;
        continue;
      }

      const options = collectOptions();
      const conversation = convert.prepare(raw, {
        includeThinking: options.includeThinking !== false,
        includeSystem: options.includeSystem !== false,
        redactions: options.redactions || [],
      });
      const result = await exporters.exportConversation(conversation, formats, options);
      await storage.addLibraryEntry({
        title: conversation.title,
        url: conversation.url,
        provider: conversation.providerName,
        capturedAt: conversation.capturedAt,
        messageCount: conversation.messages.length,
        formats,
        messages: conversation.messages.map((m) => ({ role: m.role, label: m.label, markdown: m.markdown, text: m.text })),
      });

      const caution = raw.source === 'guess'
        ? ' · layout guessed'
        : raw.health && raw.health.status === 'warn'
          ? ` · ⚠ ${describeProblems(raw.health)[0] || 'worth a look'}`
          : '';
      line.className = result.errors.length ? 'logline err' : 'logline ok';
      line.textContent = `${prefix} ${conversation.title} — ${conversation.messages.length} messages, ${result.files.length} file(s)${caution}`;
      done++;
    } catch (err) {
      line.className = 'logline err';
      line.textContent = `${prefix} ${url} — ${err.message}`;
      failed++;
    } finally {
      if (tab) await api.tabs.remove(tab.id).catch(() => {});
    }
  }

  $('batchBtn').disabled = false;
  $('batchStopBtn').hidden = true;
  batchLog(`Finished: ${done} exported, ${skipped} skipped, ${failed} failed.`, failed || skipped ? 'err' : 'ok');
  loadLibrary();
  loadMergeList();
}

/* ----------------------------------------------------------------- wiring */

function activeTab() {
  const tab = document.querySelector('.tab.active');
  return tab ? tab.dataset.tab : 'capture';
}

function wire() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      if (tab.dataset.tab === 'library') loadLibrary($('librarySearch').value);
      if (tab.dataset.tab === 'merge') loadMergeList();
      if (tab.dataset.tab === 'rules') loadRulesManager();
    });
  }

  $('readBtn').addEventListener('click', () => readChat());
  $('exportBtn').addEventListener('click', runExport);
  $('teachBtn').addEventListener('click', () => {
    const set = siteState.set;
    teachSite({ focus: set ? focusFor(set.health) : null });
  });
  $('showRulesBtn').addEventListener('click', () => teachSite({ mode: 'show' }));
  $('addRedactionBtn').addEventListener('click', () => addRedactionRow());

  for (const mini of document.querySelectorAll('.selectbar .mini')) {
    mini.addEventListener('click', (e) => { e.preventDefault(); applySelectionPreset(mini.dataset.select); });
  }

  let searchTimer = null;
  $('librarySearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadLibrary($('librarySearch').value), 200);
  });
  $('clearLibraryBtn').addEventListener('click', async () => {
    await storage.clearLibrary();
    mergeSelectedIds.clear();
    loadLibrary($('librarySearch').value);
    loadMergeList();
  });

  $('mergeFileInput').addEventListener('change', (e) => addMergeFiles([...e.target.files]));
  $('mergeClearBtn').addEventListener('click', () => { mergeSelectedIds.clear(); mergeExternals = []; loadMergeList(); });
  $('mergeRunBtn').addEventListener('click', runMerge);

  $('batchBtn').addEventListener('click', runBatch);
  $('batchStopBtn').addEventListener('click', () => { batchAbort = true; });

  // Site rules tab.
  let filterTimer = null;
  $('rulesFilter').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadRulesManager, 150);
  });
  $('rulesFileInput').addEventListener('change', (e) => {
    const [file] = e.target.files;
    if (file) importRules(file);
    e.target.value = '';
  });
  $('rulesExportBtn').addEventListener('click', () => exportRules([]));
  $('restoreAllBtn').addEventListener('click', () =>
    changeRules((s) => rules.restoreBuiltin(s, '*'), 'Restored every built-in rule set.'));

  // The chat tab may move to another chat, and that chat may have other rules.
  api.tabs.onUpdated.addListener((id, info) => {
    if (id === targetTabId && info.url) currentTargetUrl();
  });

  // Help: the manual, and "What's this?" for any control.
  manual = ui.createManualViewer(
    { overlay: $('helpOverlay'), toc: $('helpToc'), content: $('helpContent'), search: $('helpSearch'), close: $('helpClose') },
    async () => help.buildManual(MANUAL, (text) => marked.parse(text)),
    (url) => api.tabs.create({ url })
  );
  whatsThis = ui.createWhatsThis(
    { toggleButton: $('whatsThisBtn'), bar: $('whatsThisBar'), done: $('whatsThisDone'), tip: $('helpTip') },
    (section) => manual.open(section)
  );
  $('manualBtn').addEventListener('click', () => manual.open());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (manual.isOpen()) manual.hide();
    else if (whatsThis.isOn()) whatsThis.set(false);
  });

  for (const field of document.querySelectorAll('.panel input, .panel select')) {
    if (field.id === 'rulesFilter' || field.id === 'rulesFileInput' || field.closest('.rulelist') || field.closest('.sitecard')) continue;
    field.addEventListener('change', () => {
      persistSettings();
      if (lastRaw && ['optThinking', 'optSystem', 'optMeta'].includes(field.id)) renderPreview({ keepSelection: true });
    });
  }

  // Where files are kept. Choosing and allowing need the click itself, so the
  // browser's own prompt is the first thing each does.
  $('folderChooseBtn').addEventListener('click', async () => {
    try {
      await folder.choose();
    } catch (err) {
      if (err && err.name !== 'AbortError') setStatus(`Could not use that folder: ${err.message}`);
      return;
    }
    const now = await refreshFromFolder();
    if (now && now.status === 'ready') setStatus(`Your options and site rules are kept in “${now.name}” too, and exports go to its exports folder.`);
  });
  $('folderAllowBtn').addEventListener('click', async () => {
    try {
      await folder.allowAgain();
    } catch (err) {
      setStatus(`The browser did not allow it: ${err.message}`);
    }
    await refreshFromFolder();
  });
  $('folderForgetBtn').addEventListener('click', async () => {
    if (!window.confirm('Stop keeping files in this folder? The folder and the files in it are left as they are; the extension just stops writing there.')) return;
    renderFolder(await storage.forgetFolder());
    setStatus('The folder is no longer used. Exports go to Downloads/AI Chat Exports again.');
  });
  $('resetSettingsBtn').addEventListener('click', async () => {
    if (!window.confirm('Put every option back to its default? Your rules, library and exported chats are not touched.')) return;
    settings = await storage.resetSettings();
    applySettingsToUi();
    setStatus('Every option is back to its default.');
  });
  // Back from the desktop app, or another tab: take in what changed there.
  window.addEventListener('focus', () => {
    refreshFromFolder().catch(() => {});
  });

  $('formatNotes').textContent =
    'PDF opens the browser print dialog — pick "Save as PDF". Images are stitched from ' +
    'screen captures, so the chat tab is brought to the front while they are taken.';
}

(async function init() {
  // The folder's copies first, so options and rules changed there are the ones shown.
  const folderNow = await storage.syncFolder().catch(() => null);
  settings = await storage.getSettings();
  applySettingsToUi();
  ui.renderLegend($('rulesLegend'), $('rulesLegendMore'));
  wire();
  renderFolder(folderNow);
  renderSiteCard();
  loadLibrary();
  loadMergeList();
  await ensureHostAccess();

  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tabId'));
  if (Number.isFinite(tabId) && tabId > 0) await attachTarget(tabId);

  if (params.get('tab')) {
    const target = document.querySelector(`.tab[data-tab="${params.get('tab')}"]`);
    if (target) target.click();
  }
  if (params.get('help')) manual.open(params.get('help') === '1' ? undefined : params.get('help'));

  if (params.get('capture') && targetTabId) {
    await readChat();
    if (params.get('auto') && lastRaw && lastRaw.health && lastRaw.health.status !== 'broken') await runExport();
  }

  setStatus(targetTabId ? 'Ready.' : 'Open this from the extension button while a chat is on screen.');
})();
