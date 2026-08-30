'use strict';

const {
  api, ensureHostAccess, ensureContentScript, isScriptableUrl, sendToTab,
} = require('../lib/browser');
const storage = require('../lib/storage');
const exporters = require('../lib/exporters');
const { captureFullPage } = require('../lib/screenshot');
const { downloadBlob } = require('../lib/download');

const convert = require('../../../src/main/lib/convert.js');
const { renderHtml } = require('../../../src/main/lib/render.js');
const merge = require('../../../src/main/exporters/merge.js');

/**
 * The workspace. A normal extension page in a tab, which is the point: a popup
 * would close the moment focus moved and abandon whatever was running.
 */

const $ = (id) => document.getElementById(id);

let settings = {};
let targetTabId = null;
let lastRaw = null;
let previewMessages = [];
let selectedMessages = new Set();
let mergeExternals = [];
const mergeSelectedIds = new Set();
let batchAbort = false;

const setStatus = (msg) => { $('status').textContent = msg; $('status').title = msg; };
const busy = (on, text = 'Working…') => { $('busy').hidden = !on; $('busyText').textContent = text; };

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
};

function applySettingsToUi() {
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[key]);
    else el.value = settings[key] ?? '';
  }
  const formats = new Set(settings.lastFormats || ['md']);
  for (const input of $('formats').querySelectorAll('input')) input.checked = formats.has(input.value);
  renderRedactions();
}

function collectOptions() {
  const opts = {};
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') opts[key] = el.checked;
    else if (el.type === 'number') opts[key] = Number(el.value);
    else opts[key] = el.value;
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

  for (const el of [find, replace, regex]) el.addEventListener('input', persistSettings);
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
    const info = await sendToTab(tabId, { type: 'ace:describe', userPacks: await storage.getUserPacks() });
    $('target').textContent = `Attached to: ${tab.title || tab.url}`;
    const badge = $('providerBadge');
    badge.className = 'badge ' + (info.packSource === 'user' ? 'user' : info.packSource === 'builtin' ? 'known' : 'guess');
    badge.textContent =
      info.packSource === 'user' ? `${info.providerName} · your rule`
        : info.packSource === 'builtin' ? info.providerName
          : 'unknown site · will guess';
    $('readBtn').disabled = false;
    $('pickBtn').disabled = false;
  } catch (err) {
    $('target').textContent = `Could not attach to that tab: ${err.message}`;
  }
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

/* --------------------------------------------------------------- reading */

async function readChat() {
  if (!targetTabId) return;
  busy(true, 'Scrolling the whole conversation and reading it…');
  $('readBtn').disabled = true;
  try {
    const options = collectOptions();
    const userPacks = await storage.getUserPacks();
    const response = await withTabFocused(targetTabId, () =>
      sendToTab(targetTabId, { type: 'ace:capture', settings: options, userPacks })
    );

    if (!response?.ok || !response.result?.ok) {
      lastRaw = null;
      previewMessages = [];
      selectedMessages.clear();
      $('previewCard').hidden = true;
      $('exportBtn').disabled = true;
      const status = $('extractStatus');
      status.className = 'extract-status err';
      status.textContent = response?.result?.error || response?.error
        ? `Reading failed: ${String(response.result?.error || response.error).split('\n')[0]}`
        : 'No messages found. Try "Pick a message by hand", or check the chat is on screen.';
      setStatus('Nothing captured.');
      return;
    }

    lastRaw = response.result;
    const s = lastRaw.stats;
    const guessed = !lastRaw.usedPack;
    const status = $('extractStatus');
    status.className = 'extract-status ' + (guessed ? 'warn' : 'ok');
    status.textContent =
      `${s.messages} messages · ${s.characters.toLocaleString()} characters` +
      (s.images ? ` · ${s.images} images embedded` : '') +
      (s.imagesFailed ? ` · ${s.imagesFailed} images unavailable` : '') +
      (guessed ? ' · layout was guessed, check the preview' : '');
    setStatus(`Read "${lastRaw.title}" — ${s.messages} messages.`);
    await renderPreview();
  } catch (err) {
    const status = $('extractStatus');
    status.className = 'extract-status err';
    status.textContent = `Reading failed: ${err.message}`;
  } finally {
    busy(false);
    $('readBtn').disabled = false;
  }
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
  $('exportBtn').disabled = !lastRaw || chosen === 0;
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
      await openPrintTab(renderHtml(conversation, options), conversation.title);
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
        : `Exported ${result.files.length} file(s) to Downloads/AI Chat Exports.`
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

/* ---------------------------------------------------------------- picker */

async function pickElement() {
  if (!targetTabId) return;
  try {
    const tab = await api.tabs.get(targetTabId);
    await api.tabs.update(targetTabId, { active: true });
    setStatus('Switch to the chat tab and click one message (Esc cancels).');

    const response = await sendToTab(targetTabId, { type: 'ace:pick' });
    if (!response?.ok || !response.result?.ok) { setStatus('Picking cancelled.'); return; }

    const host = new URL(tab.url).hostname;
    await storage.saveUserPack(host, { name: host, turnSelector: response.result.selector, hosts: [host] });
    await loadUserPacks();
    await attachTarget(targetTabId);
    setStatus(`Saved a rule for ${host}: ${response.result.selector} (matches ${response.result.matches}). Read the chat again.`);
  } catch (err) {
    setStatus(`Picking failed: ${err.message}`);
  } finally {
    const self = await api.tabs.getCurrent();
    if (self) await api.tabs.update(self.id, { active: true });
  }
}

async function loadUserPacks() {
  const packs = await storage.getUserPacks();
  const host = $('userPacks');
  host.innerHTML = '';
  const entries = Object.entries(packs);
  if (!entries.length) {
    host.textContent = 'None yet. Rules you create with the picker show up here.';
    return;
  }
  for (const [hostname, pack] of entries) {
    const row = document.createElement('div');
    row.className = 'packrow';
    const code = Object.assign(document.createElement('code'), { textContent: `${hostname} → ${pack.turnSelector}` });
    code.title = code.textContent;
    const del = Object.assign(document.createElement('button'), { className: 'mini', textContent: 'remove' });
    del.addEventListener('click', async () => { await storage.saveUserPack(hostname, null); loadUserPacks(); });
    row.append(code, del);
    host.appendChild(row);
  }
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
    result.notes = [];
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

  let done = 0;
  let failed = 0;

  for (const [i, url] of urls.entries()) {
    if (batchAbort) { batchLog('Stopped.', 'err'); break; }
    const line = batchLog(`[${i + 1}/${urls.length}] ${url}`, 'run');
    let tab = null;
    try {
      // Foreground on purpose: a background tab is throttled hard enough that
      // the site never re-renders while we scroll, and the read comes back
      // empty or short. Slower to watch, but it actually works.
      tab = await api.tabs.create({ url, active: true });
      const outcome = await waitForTabLoad(tab.id);
      if (outcome !== 'loaded') throw new Error(outcome);
      await new Promise((r) => setTimeout(r, 1200));

      await ensureContentScript(tab.id);
      const batchOptions = collectOptions();
      const batchPacks = await storage.getUserPacks();
      const response = await withTabFocused(tab.id, () =>
        sendToTab(tab.id, { type: 'ace:capture', settings: batchOptions, userPacks: batchPacks })
      );
      if (!response?.ok || !response.result?.ok) throw new Error('nothing could be read');

      const options = collectOptions();
      const conversation = convert.prepare(response.result, {
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

      line.className = result.errors.length ? 'logline err' : 'logline ok';
      line.textContent = `[${i + 1}/${urls.length}] ${conversation.title} — ${conversation.messages.length} messages, ${result.files.length} file(s)`;
      done++;
    } catch (err) {
      line.className = 'logline err';
      line.textContent = `[${i + 1}/${urls.length}] ${url} — ${err.message}`;
      failed++;
    } finally {
      if (tab) await api.tabs.remove(tab.id).catch(() => {});
    }
  }

  $('batchBtn').disabled = false;
  $('batchStopBtn').hidden = true;
  batchLog(`Finished: ${done} exported, ${failed} failed.`, failed ? 'err' : 'ok');
  loadLibrary();
  loadMergeList();
}

/* ----------------------------------------------------------------- wiring */

function wire() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      if (tab.dataset.tab === 'library') loadLibrary($('librarySearch').value);
      if (tab.dataset.tab === 'merge') loadMergeList();
      if (tab.dataset.tab === 'options') loadUserPacks();
    });
  }

  $('readBtn').addEventListener('click', readChat);
  $('exportBtn').addEventListener('click', runExport);
  $('pickBtn').addEventListener('click', pickElement);
  $('addRedactionBtn').addEventListener('click', () => addRedactionRow());

  for (const button of document.querySelectorAll('.selectbar .mini')) {
    button.addEventListener('click', (e) => { e.preventDefault(); applySelectionPreset(button.dataset.select); });
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

  for (const el of document.querySelectorAll('.panel input, .panel select')) {
    el.addEventListener('change', () => {
      persistSettings();
      if (lastRaw && ['optThinking', 'optSystem', 'optMeta'].includes(el.id)) renderPreview({ keepSelection: true });
    });
  }

  $('formatNotes').textContent =
    'PDF opens the browser print dialog — pick "Save as PDF". Images are stitched from ' +
    'screen captures, so the chat tab is brought to the front while they are taken.';
}

(async function init() {
  settings = await storage.getSettings();
  applySettingsToUi();
  wire();
  loadUserPacks();
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

  if (params.get('capture') && targetTabId) {
    await readChat();
    if (params.get('auto') && lastRaw) await runExport();
  }

  setStatus(targetTabId ? 'Ready.' : 'Open this from the extension button while a chat is on screen.');
})();
