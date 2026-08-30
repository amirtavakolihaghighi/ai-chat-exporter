'use strict';

/* global ace */

const $ = (id) => document.getElementById(id);
const view = $('view');

let settings = {};
let lastRaw = null;      // the most recent extraction, unprepared
let currentPack = null;
let batchAbort = false;
let previewMessages = [];         // what the preview is currently showing
let selectedMessages = new Set(); // original indexes ticked for export
let mergeExternals = [];          // conversations loaded from .json files
const mergeSelectedIds = new Set();

/* --------------------------------------------------------------- helpers */

function setStatus(msg) {
  $('status').textContent = msg;
}

function busy(on, text = 'Working…') {
  $('busy').hidden = !on;
  $('busyText').textContent = text;
}

function normaliseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.\w{2,}(\/|$)/.test(raw)) return `https://${raw}`;
  return raw;
}

function chosenFormats() {
  return Array.from($('formats').querySelectorAll('input:checked')).map((i) => i.value);
}

function basename(p) {
  return String(p).split(/[\\/]/).pop();
}

/* -------------------------------------------------------------- settings */

/** Field id → settings key, for the controls that map one-to-one. */
const FIELD_MAP = {
  outDir: 'outDir',
  filenameTpl: 'filenameTemplate',
  themeSel: 'theme',
  optThinking: 'includeThinking',
  optSystem: 'includeSystem',
  optMeta: 'includeMeta',
  optFrontmatter: 'frontmatter',
  optEmbed: 'embedImages',
  assetMode: 'assetMode',
  pageSize: 'pageSize',
  marginIn: 'marginInches',
  scaleIn: 'scale',
  fontSizeIn: 'fontSize',
  optLandscape: 'landscape',
  optPageNums: 'pageNumbers',
  optPrintBg: 'printBackground',
  optBreakTurn: 'pageBreakPerTurn',
  optExpandLinks: 'expandLinks',
  jpegQ: 'jpegQuality',
  settleMs: 'settleMs',
  maxReadSeconds: 'maxReadSeconds',
  openAfter: 'openAfterExport',
};

function applySettingsToUi() {
  for (const [id, key] of Object.entries(FIELD_MAP)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(settings[key]);
    else el.value = settings[key] ?? '';
  }
  const mode = settings.captureMode === 'asShown' ? 'asShown' : 'clean';
  document.querySelector(`input[name="captureMode"][value="${mode}"]`).checked = true;

  const formats = new Set(settings.lastFormats || ['pdf']);
  for (const input of $('formats').querySelectorAll('input')) {
    input.checked = formats.has(input.value);
  }
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
  opts.captureMode = document.querySelector('input[name="captureMode"]:checked').value;
  opts.lastFormats = chosenFormats();
  opts.redactions = collectRedactions();
  opts.quality = opts.jpegQuality;
  // Only send a selection when it is a genuine subset; an empty array means
  // "no filter" downstream, which is what we want when everything is ticked.
  opts.selection =
    previewMessages.length && selectedMessages.size < previewMessages.length
      ? [...selectedMessages]
      : null;
  return opts;
}

let saveTimer = null;
function persistSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    settings = await ace.settings.save(collectOptions());
  }, 300);
}

/* ------------------------------------------------------------ redactions */

function renderRedactions() {
  const host = $('redactions');
  host.innerHTML = '';
  for (const rule of settings.redactions || []) addRedactionRow(rule);
}

function addRedactionRow(rule = { find: '', replace: '[redacted]', regex: false }) {
  const row = document.createElement('div');
  row.className = 'redaction';

  const find = document.createElement('input');
  find.type = 'text';
  find.placeholder = 'find';
  find.value = rule.find || '';

  const replace = document.createElement('input');
  replace.type = 'text';
  replace.placeholder = 'replace with';
  replace.value = rule.replace ?? '[redacted]';

  const regexLabel = document.createElement('label');
  const regex = document.createElement('input');
  regex.type = 'checkbox';
  regex.checked = Boolean(rule.regex);
  regexLabel.append(regex, document.createTextNode('re'));
  regexLabel.title = 'Treat "find" as a regular expression';

  const remove = document.createElement('button');
  remove.className = 'btn';
  remove.textContent = '×';
  remove.title = 'Remove this rule';
  remove.addEventListener('click', () => {
    row.remove();
    persistSettings();
  });

  for (const el of [find, replace, regex]) el.addEventListener('input', persistSettings);
  row.append(find, replace, regexLabel, remove);
  $('redactions').appendChild(row);
}

function collectRedactions() {
  return Array.from($('redactions').querySelectorAll('.redaction'))
    .map((row) => {
      const [find, replace] = row.querySelectorAll('input[type=text]');
      const regex = row.querySelector('input[type=checkbox]');
      return { find: find.value, replace: replace.value, regex: regex.checked };
    })
    .filter((r) => r.find);
}

/* ------------------------------------------------------------- the webview */

function loadUrl(input) {
  const url = normaliseUrl(input);
  if (!url) return;
  $('urlInput').value = url;
  $('placeholder').style.display = 'none';
  view.src = url;
  setStatus(`Loading ${url}`);
  refreshPack(url);
}

async function refreshPack(url) {
  try {
    const { pack, source } = await ace.providers.resolve(url);
    currentPack = pack;
    const badge = $('providerBadge');
    badge.className = 'badge ' + (source === 'user' ? 'user' : source === 'builtin' ? 'known' : 'guess');
    badge.textContent =
      source === 'user' ? `${pack.name || 'custom'} · your rule`
      : source === 'builtin' ? pack.name
      : 'unknown site · will guess';
    badge.title =
      source === 'heuristic'
        ? 'No selector pack for this site. The reader will infer the message layout; use "Pick a message by hand" if it gets it wrong.'
        : `Using ${source} selectors: ${pack.turnSelector || '(none)'}`;
    $('packInfo').textContent = pack.turnSelector ? `Turn selector: ${pack.turnSelector}` : '';
  } catch {
    /* a malformed URL just leaves the badge alone */
  }
}

view.addEventListener('did-start-loading', () => {
  setStatus('Loading…');
  $('extractBtn').disabled = true;
});

view.addEventListener('did-stop-loading', () => {
  setStatus('Page loaded. Click "Read this chat" when it looks right.');
  $('extractBtn').disabled = false;
  $('pickBtn').disabled = false;
  $('backBtn').disabled = !view.canGoBack();
  $('fwdBtn').disabled = !view.canGoForward();
});

view.addEventListener('did-navigate', (e) => {
  $('urlDisplay').textContent = e.url;
  $('urlInput').value = e.url;
  refreshPack(e.url);
});

view.addEventListener('did-navigate-in-page', (e) => {
  $('urlDisplay').textContent = e.url;
});

view.addEventListener('page-title-updated', (e) => {
  setStatus(e.title);
});

view.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return; // aborted, usually a redirect
  setStatus(`Could not load the page (${e.errorCode} ${e.errorDescription}).`);
});

/* ------------------------------------------------------------ extraction */

/**
 * Embeds any picture the in-page fetch could not reach.
 *
 * The extractor inlines what it can from inside the page, which covers
 * same-origin images. Attachments and generated pictures are the common case
 * though, and those come from a separate authenticated CDN: a page-context
 * fetch to another origin is blocked by CORS, so they were left as links.
 *
 * A link is not a harmless fallback here. It resolves while you are signed in
 * and the browser sends cookies, and fails everywhere else — so the export
 * looks fine in a quick check and shows broken images later, or on another
 * machine, or once the signed URL expires.
 */
async function embedRemoteImages(raw) {
  if (!raw?.messages?.length) return raw;

  const urls = new Set();
  const collect = (html) => {
    for (const match of String(html || '').matchAll(/<img[^>]+src="(https?:[^"]+)"/gi)) {
      urls.add(match[1]);
    }
  };
  for (const message of raw.messages) {
    collect(message.html);
    collect(message.thinkingHtml);
  }
  if (!urls.size) return raw;

  setStatus(`Fetching ${urls.size} image(s) so the export does not depend on a live link…`);
  let fetched = {};
  try {
    fetched = await ace.images.fetchMany([...urls]);
  } catch (err) {
    setStatus(`Could not fetch images: ${err.message}`);
    return raw;
  }

  let embedded = 0;
  const rewrite = (html) =>
    String(html || '').replace(/(<img[^>]+src=")(https?:[^"]+)(")/gi, (whole, before, url, after) => {
      const data = fetched[url];
      if (!data) return whole;
      embedded++;
      // Keep the original address; it is useful provenance even once the
      // picture itself travels with the file.
      return `${before}${data}${after} data-original-src="${url}"`;
    });

  for (const message of raw.messages) {
    message.html = rewrite(message.html);
    message.thinkingHtml = rewrite(message.thinkingHtml);
  }

  const failed = urls.size - embedded;
  raw.stats = {
    ...raw.stats,
    images: (raw.stats?.images || 0) + embedded,
    imagesFailed: (raw.stats?.imagesFailed || 0) + failed,
  };
  return raw;
}

async function extract() {
  if (!view.src) return;
  busy(true, 'Scrolling the whole conversation and reading it…');
  $('extractBtn').disabled = true;
  try {
    const { source } = await ace.inject.extractor(view.getURL());
    const result = await view.executeJavaScript(source, true);

    if (!result || !result.ok) {
      lastRaw = null;
      previewMessages = [];
      selectedMessages.clear();
      $('previewBox').hidden = true;
      $('exportBtn').disabled = true;
      const status = $('extractStatus');
      status.className = 'extract-status err';
      status.textContent = result?.error
        ? `Reading failed: ${result.error.split('\n')[0]}`
        : 'No messages found on this page. Try "Pick a message by hand" below, or check the chat is actually visible.';
      setStatus('Nothing captured.');
      return;
    }

    // Pull in anything the page itself was not allowed to fetch.
    if (collectOptions().embedImages !== false) {
      busy(true, 'Fetching images so the export does not depend on a live link…');
      await embedRemoteImages(result);
    }

    lastRaw = result;
    $('exportBtn').disabled = false;

    const s = result.stats;
    const status = $('extractStatus');
    const guessed = !result.usedPack;
    status.className = 'extract-status ' + (guessed ? 'warn' : 'ok');
    status.textContent =
      `${s.messages} messages · ${s.characters.toLocaleString()} characters` +
      (s.images ? ` · ${s.images} images embedded` : '') +
      (s.imagesFailed ? ` · ${s.imagesFailed} images unavailable` : '') +
      (guessed ? ' · layout was guessed, check the preview' : '');

    setStatus(`Read "${result.title}" — ${s.messages} messages in ${(s.elapsedMs / 1000).toFixed(1)}s.`);
    await renderPreview();
  } catch (err) {
    const status = $('extractStatus');
    status.className = 'extract-status err';
    status.textContent = `Reading failed: ${err.message}`;
    setStatus('Reading failed.');
  } finally {
    busy(false);
    $('extractBtn').disabled = false;
  }
}

async function renderPreview({ keepSelection = false } = {}) {
  if (!lastRaw) return;
  const preview = await ace.exports.preview({ raw: lastRaw, options: collectOptions() });
  previewMessages = preview.messages;

  if (!keepSelection) {
    selectedMessages = new Set(previewMessages.map((m) => m.originalIndex));
  } else {
    // Drop anything that a filter change has since removed from the preview.
    const available = new Set(previewMessages.map((m) => m.originalIndex));
    selectedMessages = new Set([...selectedMessages].filter((i) => available.has(i)));
  }

  const list = $('previewList');
  list.innerHTML = '';
  for (const msg of previewMessages) {
    const row = document.createElement('label');
    row.className = `pv ${msg.role}`;

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = selectedMessages.has(msg.originalIndex);
    tick.addEventListener('change', () => {
      if (tick.checked) selectedMessages.add(msg.originalIndex);
      else selectedMessages.delete(msg.originalIndex);
      updateSelectionCount();
    });

    const bits = [msg.label];
    if (msg.hasReasoning) bits.push('has reasoning');
    if (msg.codeBlocks > 0) bits.push(`${msg.codeBlocks} code block${msg.codeBlocks === 1 ? '' : 's'}`);

    const content = document.createElement('div');
    content.className = 'pvbody';
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = bits.join(' · ');
    const txt = document.createElement('div');
    txt.className = 'txt';
    txt.textContent = msg.markdown + (msg.truncated ? ' …' : '');
    content.append(who, txt);

    row.append(tick, content);
    list.appendChild(row);
  }

  updateSelectionCount();
  $('previewBox').hidden = false;
}

function updateSelectionCount() {
  const total = previewMessages.length;
  const chosen = selectedMessages.size;
  $('selectionCount').textContent =
    chosen === total ? `all ${total} messages` : `${chosen} of ${total} messages`;
  $('exportBtn').disabled = !lastRaw || chosen === 0;
}

function applySelectionPreset(preset) {
  const all = previewMessages.map((m) => m.originalIndex);
  if (preset === 'all') selectedMessages = new Set(all);
  else if (preset === 'none') selectedMessages.clear();
  else if (preset === 'invert') {
    selectedMessages = new Set(all.filter((i) => !selectedMessages.has(i)));
  } else {
    selectedMessages = new Set(
      previewMessages.filter((m) => m.role === preset).map((m) => m.originalIndex)
    );
  }
  for (const [i, box] of [...$('previewList').querySelectorAll('input[type=checkbox]')].entries()) {
    box.checked = selectedMessages.has(previewMessages[i].originalIndex);
  }
  updateSelectionCount();
}

/* -------------------------------------------------------------- exporting */

async function runExport() {
  if (!lastRaw) return;
  const formats = chosenFormats();
  if (!formats.length) {
    setStatus('Pick at least one format.');
    return;
  }

  const options = collectOptions();
  settings = await ace.settings.save(options);

  busy(true, `Exporting ${formats.length} format${formats.length > 1 ? 's' : ''}…`);
  $('exportBtn').disabled = true;
  try {
    const { results, outDir } = await ace.exports.run({
      raw: lastRaw,
      formats,
      options,
      webContentsId: view.getWebContentsId(),
    });
    renderResults(results);
    const okCount = results.filter((r) => r.ok).length;
    setStatus(`Exported ${okCount} of ${results.length} format(s) to ${outDir}`);
    if (options.openAfterExport && okCount) ace.shell.open(outDir);
    loadHistory();
  } catch (err) {
    setStatus(`Export failed: ${err.message}`);
  } finally {
    busy(false);
    $('exportBtn').disabled = false;
  }
}

function renderResults(results, targetId = 'results') {
  const host = $(targetId);
  host.innerHTML = '';
  for (const result of results) {
    if (!result.ok) {
      const row = document.createElement('div');
      row.className = 'result bad';
      row.innerHTML = '';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${result.format.toUpperCase()}: ${result.error}`;
      row.appendChild(name);
      host.appendChild(row);
      continue;
    }
    for (const file of result.files) {
      const row = document.createElement('div');
      row.className = 'result';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = basename(file);
      name.title = file;

      const open = document.createElement('button');
      open.className = 'mini';
      open.textContent = 'open';
      open.addEventListener('click', () => ace.shell.open(file));

      const reveal = document.createElement('button');
      reveal.className = 'mini';
      reveal.textContent = 'folder';
      reveal.addEventListener('click', () => ace.shell.reveal(file));

      row.append(name, open, reveal);
      host.appendChild(row);
    }
    for (const note of result.notes || []) {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = note;
      host.appendChild(p);
    }
  }
}

/* --------------------------------------------------------- element picker */

async function pickElement() {
  if (!view.src) return;
  setStatus('Click one message in the page (Esc to cancel).');
  try {
    const source = await ace.inject.picker();
    const result = await view.executeJavaScript(source, true);
    if (!result || !result.ok) {
      setStatus('Picking cancelled.');
      return;
    }
    const host = new URL(view.getURL()).hostname;
    await ace.packs.save(host, {
      name: host,
      turnSelector: result.selector,
      hosts: [host],
    });
    await refreshPack(view.getURL());
    await loadUserPacks();
    setStatus(`Saved a rule for ${host}: ${result.selector} (matches ${result.matches} message${result.matches === 1 ? '' : 's'}). Read the chat again.`);
    $('packInfo').textContent = `Saved: ${result.selector} — matches ${result.matches} element(s).`;
  } catch (err) {
    setStatus(`Picking failed: ${err.message}`);
  }
}

async function loadUserPacks() {
  const packs = await ace.packs.get();
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
    const label = document.createElement('code');
    label.textContent = `${hostname} → ${pack.turnSelector}`;
    label.title = label.textContent;
    const del = document.createElement('button');
    del.className = 'mini';
    del.textContent = 'remove';
    del.style.cssText = 'background:none;border:none;color:#f87171;cursor:pointer;font:inherit;font-size:11px;';
    del.addEventListener('click', async () => {
      await ace.packs.save(hostname, null);
      loadUserPacks();
      if (view.src) refreshPack(view.getURL());
    });
    row.append(label, del);
    host.appendChild(row);
  }
}

/* ------------------------------------------------------------------ batch */

function waitForLoad(timeoutMs = 45000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (reason) => {
      if (done) return;
      done = true;
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-fail-load', onFail);
      clearTimeout(timer);
      resolve(reason);
    };
    const onStop = () => finish('loaded');
    const onFail = (e) => {
      if (e.errorCode !== -3) finish(`failed: ${e.errorDescription}`);
    };
    const timer = setTimeout(() => finish('timed out'), timeoutMs);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-fail-load', onFail);
  });
}

function batchLog(text, cls = '') {
  const line = document.createElement('div');
  line.className = `logline ${cls}`;
  line.textContent = text;
  $('batchLog').appendChild(line);
  line.scrollIntoView({ block: 'nearest' });
  return line;
}

async function runBatch() {
  const urls = $('batchUrls').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) {
    setStatus('Add some links first.');
    return;
  }
  const formats = chosenFormats();
  if (!formats.length) {
    setStatus('Pick at least one format on the Export tab.');
    return;
  }

  batchAbort = false;
  $('batchBtn').disabled = true;
  $('batchStopBtn').hidden = false;
  $('batchLog').innerHTML = '';

  let done = 0;
  let failed = 0;

  for (const [i, url] of urls.entries()) {
    if (batchAbort) {
      batchLog('Stopped.', 'err');
      break;
    }
    const line = batchLog(`[${i + 1}/${urls.length}] Loading ${url}`, 'run');
    busy(true, `Batch ${i + 1} of ${urls.length}…`);
    try {
      $('placeholder').style.display = 'none';
      view.src = normaliseUrl(url);
      const outcome = await waitForLoad();
      if (outcome !== 'loaded') {
        line.className = 'logline err';
        line.textContent = `[${i + 1}/${urls.length}] ${url} — ${outcome}`;
        failed++;
        continue;
      }
      // Let client-rendered chats paint before the reader starts scrolling.
      await new Promise((r) => setTimeout(r, 1200));

      const { source } = await ace.inject.extractor(view.getURL());
      const raw = await view.executeJavaScript(source, true);
      if (!raw || !raw.ok) {
        line.className = 'logline err';
        line.textContent = `[${i + 1}/${urls.length}] ${url} — nothing could be read`;
        failed++;
        continue;
      }

      const { results } = await ace.exports.run({
        raw,
        formats,
        options: collectOptions(),
        webContentsId: view.getWebContentsId(),
      });
      const okFiles = results.filter((r) => r.ok).flatMap((r) => r.files);
      const errors = results.filter((r) => !r.ok);
      line.className = errors.length ? 'logline err' : 'logline ok';
      line.textContent =
        `[${i + 1}/${urls.length}] ${raw.title} — ${raw.stats.messages} messages, ${okFiles.length} file(s)` +
        (errors.length ? ` · failed: ${errors.map((e) => e.format).join(', ')}` : '');
      done++;
    } catch (err) {
      line.className = 'logline err';
      line.textContent = `[${i + 1}/${urls.length}] ${url} — ${err.message}`;
      failed++;
    }
  }

  busy(false);
  $('batchBtn').disabled = false;
  $('batchStopBtn').hidden = true;
  batchLog(`Finished: ${done} exported, ${failed} failed.`, failed ? 'err' : 'ok');
  setStatus(`Batch finished — ${done} exported, ${failed} failed.`);
  loadHistory();
}

/* ---------------------------------------------------------------- library */

async function loadHistory(query = '') {
  const entries = query.trim()
    ? await ace.library.search(query)
    : await ace.library.get();
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

    const title = document.createElement('div');
    title.className = 't';
    title.textContent = entry.title || 'Untitled';
    title.title = entry.url || '';

    const sub = document.createElement('div');
    sub.className = 's';
    const when = new Date(entry.at).toLocaleString();
    sub.append(document.createTextNode(
      `${entry.provider || '?'} · ${entry.messageCount ?? '?'} msgs · ${(entry.formats || []).join(', ')} · ${when}`
    ));

    if (entry.files?.length) {
      const open = document.createElement('button');
      open.className = 'mini';
      open.textContent = 'open';
      open.addEventListener('click', () => ace.shell.open(entry.files[0]));
      const reveal = document.createElement('button');
      reveal.className = 'mini';
      reveal.textContent = 'folder';
      reveal.addEventListener('click', () => ace.shell.reveal(entry.files[0]));
      sub.append(open, reveal);
    }
    if (entry.url) {
      const again = document.createElement('button');
      again.className = 'mini';
      again.textContent = 'reload chat';
      again.addEventListener('click', () => {
        document.querySelector('.tab[data-tab="export"]').click();
        loadUrl(entry.url);
      });
      sub.append(again);
    }

    card.append(title, sub);
    // Search results carry the matching passage so you can tell chats apart
    // without opening each one.
    if (entry.snippet) {
      const snippet = document.createElement('div');
      snippet.className = 'snippet';
      snippet.textContent = entry.snippet;
      card.appendChild(snippet);
    }
    host.appendChild(card);
  }
}

/* -------------------------------------------------------------------- merge */

async function loadMergeList() {
  const entries = await ace.library.get(200);
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
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = mergeSelectedIds.has(entry.id);
    tick.addEventListener('change', () => {
      if (tick.checked) mergeSelectedIds.add(entry.id);
      else mergeSelectedIds.delete(entry.id);
      updateMergeButton();
    });
    const label = document.createElement('span');
    label.innerHTML = '';
    label.textContent = `${entry.title || 'Untitled'} — ${entry.messageCount ?? '?'} msgs · ${entry.provider || '?'}`;
    label.title = entry.url || '';
    row.append(tick, label);
    host.appendChild(row);
  }

  for (const [i, external] of mergeExternals.entries()) {
    const row = document.createElement('label');
    row.className = 'mergerow external';
    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.checked = true;
    tick.disabled = true;
    const label = document.createElement('span');
    label.textContent = `${external.title} — ${external.messageCount} msgs · from file`;
    label.title = external.file;
    const remove = document.createElement('button');
    remove.className = 'mini';
    remove.textContent = 'remove';
    remove.addEventListener('click', (e) => {
      e.preventDefault();
      mergeExternals.splice(i, 1);
      loadMergeList();
    });
    row.append(tick, label, remove);
    host.appendChild(row);
  }

  updateMergeButton();
}

function updateMergeButton() {
  const count = mergeSelectedIds.size + mergeExternals.length;
  $('mergeRunBtn').disabled = count < 1;
  $('mergeRunBtn').textContent =
    count === 0 ? 'Merge selected' : `Merge ${count} conversation${count === 1 ? '' : 's'}`;
}

async function pickMergeFiles() {
  const loaded = await ace.merge.pickFiles();
  const failures = loaded.filter((f) => f.error);
  for (const ok of loaded.filter((f) => !f.error)) mergeExternals.push(ok);
  if (failures.length) {
    setStatus(`Could not read ${failures.length} file(s): ${failures[0].error}`);
  } else if (loaded.length) {
    setStatus(`Added ${loaded.length} conversation(s) to the merge.`);
  }
  loadMergeList();
}

async function runMerge() {
  const formats = Array.from($('mergeFormats').querySelectorAll('input:checked')).map((i) => i.value);
  if (!formats.length) {
    setStatus('Pick at least one format for the merged document.');
    return;
  }

  busy(true, 'Building the merged document…');
  $('mergeRunBtn').disabled = true;
  try {
    const { results, outDir } = await ace.merge.run({
      ids: [...mergeSelectedIds],
      externals: mergeExternals.map((e) => e.source),
      formats,
      options: { ...collectOptions(), documentTitle: $('mergeTitle').value.trim() || 'Merged AI conversations' },
    });
    renderResults(results, 'mergeResults');
    const ok = results.every((r) => r.ok);
    setStatus(ok ? `Merged document written to ${outDir}` : `Merge failed: ${results[0].error}`);
    loadHistory();
  } catch (err) {
    setStatus(`Merge failed: ${err.message}`);
  } finally {
    busy(false);
    updateMergeButton();
  }
}

/* ------------------------------------------------------------------ wiring */

function wire() {
  $('urlForm').addEventListener('submit', (e) => {
    e.preventDefault();
    loadUrl($('urlInput').value);
  });

  $('backBtn').addEventListener('click', () => view.goBack());
  $('fwdBtn').addEventListener('click', () => view.goForward());
  $('reloadBtn').addEventListener('click', () => view.reload());
  $('devtoolsBtn').addEventListener('click', () => view.openDevTools());

  let zoom = 1;
  const applyZoom = () => {
    view.setZoomFactor(zoom);
    $('zoomLabel').textContent = `${Math.round(zoom * 100)}%`;
  };
  $('zoomInBtn').addEventListener('click', () => {
    zoom = Math.min(2.5, zoom + 0.1);
    applyZoom();
  });
  $('zoomOutBtn').addEventListener('click', () => {
    zoom = Math.max(0.3, zoom - 0.1);
    applyZoom();
  });

  $('extractBtn').addEventListener('click', extract);
  $('exportBtn').addEventListener('click', runExport);
  $('pickBtn').addEventListener('click', pickElement);

  $('browseBtn').addEventListener('click', async () => {
    const dir = await ace.dialog.chooseDir($('outDir').value);
    if (dir) {
      $('outDir').value = dir;
      persistSettings();
    }
  });

  $('openFolderBtn').addEventListener('click', () => ace.shell.open($('outDir').value));
  $('clearLibraryBtn').addEventListener('click', async () => {
    await ace.library.clear();
    mergeSelectedIds.clear();
    loadHistory($('librarySearch').value);
    loadMergeList();
  });

  let searchTimer = null;
  $('librarySearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadHistory($('librarySearch').value), 200);
  });

  for (const button of document.querySelectorAll('.selectbar .mini')) {
    button.addEventListener('click', (e) => {
      e.preventDefault();
      applySelectionPreset(button.dataset.select);
    });
  }

  $('mergePickBtn').addEventListener('click', pickMergeFiles);
  $('mergeClearBtn').addEventListener('click', () => {
    mergeSelectedIds.clear();
    mergeExternals = [];
    loadMergeList();
  });
  $('mergeRunBtn').addEventListener('click', runMerge);

  $('addRedactionBtn').addEventListener('click', () => addRedactionRow());

  $('clearSessionBtn').addEventListener('click', async () => {
    await ace.session.clear();
    setStatus('Signed out of all chat sites in the embedded browser.');
  });

  $('batchBtn').addEventListener('click', runBatch);
  $('batchStopBtn').addEventListener('click', () => {
    batchAbort = true;
  });

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.tab')) t.classList.remove('active');
      for (const p of document.querySelectorAll('.panel')) p.classList.remove('active');
      tab.classList.add('active');
      document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      if (tab.dataset.tab === 'library') loadHistory($('librarySearch').value);
      if (tab.dataset.tab === 'options') loadUserPacks();
      if (tab.dataset.tab === 'merge') loadMergeList();
    });
  }

  // Any control change is persisted; content-affecting ones also refresh the
  // preview so the user sees the effect of, say, a redaction rule immediately.
  // The tick boxes survive that refresh — re-reading a chat should not silently
  // discard a selection the user has just made by hand.
  for (const el of document.querySelectorAll('.panel input, .panel select')) {
    el.addEventListener('change', () => {
      persistSettings();
      if (lastRaw && ['optThinking', 'optSystem', 'optMeta'].includes(el.id)) {
        renderPreview({ keepSelection: true });
      }
    });
  }
  $('formats').addEventListener('change', persistSettings);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      $('urlInput').select();
    }
    if (e.ctrlKey && e.key === 'e') {
      e.preventDefault();
      if (!$('extractBtn').disabled) extract();
    }
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (!$('exportBtn').disabled) runExport();
    }
  });

  ace.on('session:cleared', () => setStatus('Browsing data cleared.'));
}

(async function init() {
  settings = await ace.settings.get();
  applySettingsToUi();
  wire();
  loadUserPacks();
  loadHistory();
  loadMergeList();
  setStatus('Ready. Paste a chat share link, or sign in to a provider to export a private chat.');
})();
