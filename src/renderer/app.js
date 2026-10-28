'use strict';

/* global ace, AceParts, AceHelp */

const $ = (id) => document.getElementById(id);
const view = $('view');

const { STATUS } = AceParts;

let settings = {};
let lastRaw = null;      // the most recent extraction, unprepared
let currentUrl = '';     // what the browser pane is showing
let pageReady = false;   // the page has finished loading at least once
let batchAbort = false;
let previewMessages = [];         // what the preview is currently showing
let selectedMessages = new Set(); // original indexes ticked for export
let mergeExternals = [];          // conversations loaded from .json files
const mergeSelectedIds = new Set();

// The rules that read the current page: { set, source, name, off }.
let siteState = { set: null, source: 'none', name: '' };
// Counts from the last time the rules were drawn on the page, newer than any read.
let liveCounts = null;
let teaching = false;
let teachRun = 0;

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

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Interface pieces shared with the extension; see src/shared/ui.js.
const { el, button, paint, statusOf, healthLine, partChips, countsOf, describeProblems, focusFor } = AceUI;

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
  batchGuess: 'batchGuessUnknown',
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

/* -------------------------------------------------- where files are kept */

/** The folders inside the data folder, each with its own colour. */
const DATA_FOLDERS = [
  { key: 'settings', color: '#94a3b8', text: 'your changes to the options' },
  { key: 'rules', color: '#a78bfa', text: 'your site rules' },
  { key: 'library', color: '#f59e0b', text: 'everything you exported, for search and merging' },
  { key: 'exports', color: '#22c55e', text: 'exported chats, unless “Save to” points elsewhere' },
];

async function loadDataFolder() {
  let info;
  try {
    info = await ace.data.info();
  } catch {
    return;
  }
  $('dataDir').textContent = info.dir;
  const notes = {
    env: 'Set for this run by ACE_DATA_DIR.',
    chosen: `A folder you chose. “Use the default” goes back to ${info.defaultDir}.`,
    default: 'The default place.',
    fallback: '',
  };
  $('dataDirNote').textContent = [info.problem, notes[info.source]].filter(Boolean).join(' ');
  const list = $('dataFolders');
  list.textContent = '';
  for (const folder of DATA_FOLDERS) {
    const item = paint(button('', 'datafolder-item', () => ace.data.open(folder.key), `Open ${info.folders[folder.key]}`), folder.color);
    item.append(el('i'), el('strong', '', folder.key), el('span', '', folder.text));
    list.appendChild(item);
  }
  $('dataChangeBtn').disabled = info.source === 'env';
  $('dataDefaultBtn').disabled = info.source === 'env' || info.source === 'default';
}

async function moveDataFolder(work) {
  try {
    const result = await work();
    if (result && result.changed) setStatus(`Your files will be kept in ${result.dir} from the next start.`);
  } catch (err) {
    setStatus(`Could not move the data folder: ${err.message}`);
  }
  await loadDataFolder();
}

async function resetSettings() {
  if (!window.confirm('Put every option back to its default? Your rules, library and exported chats are not touched.')) return;
  try {
    settings = await ace.settings.reset();
    applySettingsToUi();
    setStatus('Every option is back to its default. The ones you had are kept in a backup file in the settings folder.');
  } catch (err) {
    setStatus(`Could not reset the options: ${err.message}`);
  }
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
  navigate(url);
  setStatus(`Loading ${url}`);
  setCurrentUrl(url);
}

/**
 * Opens `url` in the browser pane.
 *
 * Setting the pane's address directly reports a load that gets superseded —
 * opening the page that is already open, say — as an unhandled error. Asking it
 * to load lets that be caught; the outcome still arrives as the usual events.
 * Before the pane has loaded anything at all, only the address can be set.
 */
function navigate(url) {
  if (!view.src || !pageReady) {
    view.src = url;
    return;
  }
  view.loadURL(url).catch(() => {
    /* reported through did-fail-load, which the callers listen for */
  });
}

function setCurrentUrl(url) {
  const changed = url !== currentUrl;
  currentUrl = url;
  if (changed) liveCounts = null;
  refreshSiteRules();
}

view.addEventListener('did-start-loading', () => {
  setStatus('Loading…');
  $('extractBtn').disabled = true;
});

view.addEventListener('did-stop-loading', () => {
  pageReady = true;
  setStatus('Page loaded. Click "Read this chat" when it looks right.');
  $('extractBtn').disabled = teaching;
  $('backBtn').disabled = !view.canGoBack();
  $('fwdBtn').disabled = !view.canGoForward();
  renderSiteCard();
});

view.addEventListener('did-navigate', (e) => {
  $('urlDisplay').textContent = e.url;
  $('urlInput').value = e.url;
  // A new document: any teach panel on the old one has gone with it.
  if (teaching) stoppedByNavigation();
  setCurrentUrl(e.url);
});

view.addEventListener('did-navigate-in-page', (e) => {
  if (!e.isMainFrame) return;
  $('urlDisplay').textContent = e.url;
  // Rules can be narrowed to part of a site, so a new page may mean new rules.
  setCurrentUrl(e.url);
});

view.addEventListener('page-title-updated', (e) => {
  setStatus(e.title);
});

view.addEventListener('did-fail-load', (e) => {
  if (e.errorCode === -3) return; // aborted, usually a redirect
  setStatus(`Could not load the page (${e.errorCode} ${e.errorDescription}).`);
});

/* ------------------------------------------------------------ site rules */


async function refreshSiteRules() {
  if (!currentUrl) {
    siteState = { set: null, source: 'none', name: '' };
  } else {
    try {
      siteState = await ace.rules.resolve(currentUrl);
    } catch {
      return;
    }
  }
  renderBadge();
  renderSiteCard();
}

function renderBadge() {
  const badge = $('providerBadge');
  const { set, source, name, off } = siteState;
  if (!currentUrl) {
    badge.className = 'badge';
    badge.textContent = 'no page';
    return;
  }
  if (set) {
    const broken = statusOf(set) === 'broken';
    badge.className = `badge ${broken ? 'broken' : source === 'user' ? 'user' : 'known'}`;
    badge.textContent = `${name} · ${source === 'user' ? 'your rules' : 'built-in rules'}${broken ? ' · broken' : ''}`;
    badge.title = 'Which rules read this site. See the Site rules tab.';
  } else if (off) {
    badge.className = 'badge off';
    badge.textContent = `${off.name} · rules ${off.removed ? 'removed' : 'turned off'}`;
    badge.title = 'This site has rules, but none is in use — the layout will be guessed. Choose or restore them in Site rules.';
  } else {
    badge.className = 'badge guess';
    badge.textContent = 'no rules · will guess';
    badge.title = 'No rules for this site yet, so the layout will be guessed. “Teach this site” fixes that.';
  }
}

function renderSiteCard() {
  const { set, source, name, off } = siteState;
  const chips = $('siteChips');
  const note = $('siteNote');
  chips.textContent = '';
  note.hidden = true;
  note.className = 'sitecard-note';
  paint($('siteDot'), STATUS[set ? statusOf(set) : off ? 'off' : 'unknown'].color);

  const teachBtn = $('teachBtn');
  const showBtn = $('showRulesBtn');
  teachBtn.classList.remove('primary');

  if (!currentUrl) {
    $('siteName').textContent = 'No page loaded';
    $('siteSub').textContent = 'Load a chat to see which rules read it.';
  } else if (set) {
    $('siteName').textContent = name;
    $('siteSub').textContent = `${source === 'user' ? 'Your rules' : 'Built-in rules'} · ${healthLine(set.health)}`;
    chips.replaceWith(Object.assign(partChips(set, countsOf(set, liveCounts)), { id: 'siteChips' }));
    teachBtn.textContent = 'Fix these rules';
    if (statusOf(set) === 'broken') teachBtn.classList.add('primary');
  } else if (off) {
    $('siteName').textContent = off.name;
    $('siteSub').textContent = off.removed ? 'Built-in rules removed — the layout will be guessed.' : 'Rules turned off — the layout will be guessed.';
    teachBtn.textContent = 'Teach this site';
  } else {
    $('siteName').textContent = hostOf(currentUrl) || 'This page';
    $('siteSub').textContent = 'No rules yet — the layout will be guessed.';
    note.textContent = 'Teach the app this site once and it will know it from then on. It starts with its own guess, so usually you only check the colours and save.';
    note.hidden = false;
    teachBtn.textContent = 'Teach this site';
    teachBtn.classList.add('primary');
  }

  if (teaching) {
    note.className = 'sitecard-note warn';
    note.textContent = '';
    note.append(
      document.createTextNode('The panel is open on the page — use it there, then save or close it. '),
      button('Stop', 'btn', stopTeaching)
    );
    note.hidden = false;
  }

  AceUI.renderSiteSwitch($('siteSwitchRow'), $('siteSwitch'), currentUrl ? siteState.choices : [], switchSiteRules);
  $('siteSwitch').disabled = teaching;

  const usable = Boolean(currentUrl) && pageReady && !teaching;
  teachBtn.disabled = !usable;
  showBtn.disabled = !usable || !set;
}

/** The quick switch on the site card: read this site with another of its rule sets. */
function switchSiteRules(id) {
  const choice = (siteState.choices || []).find((c) => c.id === id);
  liveCounts = null;
  changeRules(() => ace.rules.setDefault(id),
    `Now using “${choice ? choice.name : 'those rules'}” for this site. Read the chat again to see what they find.`);
}

/* ------------------------------------------------------------- teaching */

function setTeaching(on) {
  teaching = on;
  $('extractBtn').disabled = on || !pageReady;
  $('exportBtn').disabled = on || !lastRaw;
  renderSiteCard();
}

function stoppedByNavigation() {
  teachRun++;
  setTeaching(false);
  setStatus('The page changed, so the teach panel closed. Nothing was saved.');
}

async function stopTeaching() {
  try {
    await view.executeJavaScript(await ace.inject.teachClose(), true);
  } catch {
    /* the page may already be gone */
  }
}

/**
 * Opens the teach overlay on the page — or, in "show" mode, just draws what the
 * rules find. `ruleId` names a rule set from the manager; otherwise the rules
 * that apply to the page are used, and a site with none starts from a guess.
 */
async function teachSite({ mode = 'teach', focus = null, ruleId = null } = {}) {
  if (!currentUrl || teaching) return;
  const url = currentUrl;
  const run = ++teachRun;
  let built;
  try {
    built = await ace.inject.teach({ url, mode, ruleId, focus });
  } catch (err) {
    setStatus(`Could not open the teach panel: ${err.message}`);
    return;
  }
  setTeaching(true);
  setStatus(mode === 'show'
    ? 'The rules are drawn on the page as coloured boxes. Close the panel there when you are done.'
    : 'Teach panel open on the page: choose a part, click it on the page, then save.');
  let result;
  try {
    result = await view.executeJavaScript(built.source, true);
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (run !== teachRun) return; // the page navigated away in the meantime
  setTeaching(false);
  await afterTeach(result, url, built.ruleId);
}

async function afterTeach(result, url, baseId) {
  if (result && result.action === 'save') {
    try {
      const saved = await ace.rules.saveTaught({
        url,
        baseId,
        parts: result.parts,
        options: result.options,
        pathPrefix: result.pathPrefix,
        name: result.name,
        asNew: result.saveAs === 'new',
        makeDefault: result.makeDefault !== false,
      });
      liveCounts = result.counts ? { ...result.counts, found: result.found } : null;
      await refreshSiteRules();
      if (activeTab() === 'rules') loadRulesManager();
      const s = result.summary || {};
      if (result.makeDefault === false && !result.pathPrefix) {
        setStatus(`Saved “${saved.name}”. The site is still read with the rules it used before — choose “${saved.name}” on the site card or in Site rules to use it.`);
        return;
      }
      setStatus(`Saved “${saved.name}”: ${s.user || 0} of your messages and ${s.assistant || 0} AI replies on this page. Reading the chat with them…`);
      await extract();
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

/** Keeps the rule manager's "last checked" up to date with every read. */
function recordHealth(result, url) {
  if (!result || !result.rules || !result.rules.id || !result.health) return;
  const health = {
    ...result.health,
    at: new Date().toISOString(),
    url,
    // What each part found, for the coloured chips.
    counts: { ...result.health.counts },
    parts: result.health.parts,
    found: result.health.found,
  };
  ace.rules.recordHealth(result.rules.id, health)
    .then(() => {
      liveCounts = null;
      refreshSiteRules();
    })
    .catch(() => {});
}

async function extract({ ignoreRules = false } = {}) {
  if (!view.src || teaching) return;
  const url = view.getURL();
  busy(true, ignoreRules ? 'Reading the chat by guessing its layout…' : 'Scrolling the whole conversation and reading it…');
  $('extractBtn').disabled = true;
  try {
    const { source } = await ace.inject.extractor(url, { ignoreRules });
    const result = await view.executeJavaScript(source, true);
    recordHealth(result, url);

    if (!result || !result.ok) {
      lastRaw = null;
      previewMessages = [];
      selectedMessages.clear();
      $('previewBox').hidden = true;
      $('exportBtn').disabled = true;
      renderReadStatus(result, null);
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

    const previous = await ace.library.lastFor(url).catch(() => null);
    renderReadStatus(result, previous);

    const s = result.stats;
    setStatus(`Read "${result.title}" — ${s.messages} messages in ${(s.elapsedMs / 1000).toFixed(1)}s.`);
    await renderPreview();
  } catch (err) {
    renderReadStatus({ ok: false, error: err.message }, null);
    setStatus('Reading failed.');
  } finally {
    busy(false);
    $('extractBtn').disabled = teaching;
  }
}

/** The reading result, with buttons for whatever would fix a problem. */
function renderReadStatus(result, previous) {
  AceUI.renderReadStatus($('extractStatus'), result, previous, {
    fix: (focus) => teachSite({ focus }),
    guess: () => extract({ ignoreRules: true }),
    show: () => teachSite({ mode: 'show' }),
    teach: () => teachSite(),
  });
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
  $('exportBtn').disabled = !lastRaw || chosen === 0 || teaching;
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

/* ------------------------------------------------------- the rule manager */

async function changeRules(work, message) {
  try {
    const outcome = await work();
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
    use: () => changeRules(() => ace.rules.setDefault(set.id),
      `Now using “${set.name}” for ${siteOf(set)}. Read a chat there again to see what they find.`),
    show: () => teachSite({ mode: 'show', ruleId: set.id }),
    fix: () => teachSite({ ruleId: set.id }),
    rename: (name) => changeRules(() => ace.rules.saveSet({ ...set, name }), 'Renamed.'),
    copy: () => changeRules(() => ace.rules.duplicate(set.id), (made) =>
      `Made “${made.name}”, a copy of ${set.name}. It is not used until you choose it with its round button.`),
    exportRules: () => exportRules([set.id]),
    remove: () => changeRules(() => ace.rules.remove(set.id), `Deleted “${set.name}”.`),
    removeBuiltin: () => changeRules(() => ace.rules.removeBuiltin(set.id), `Removed the built-in rules for ${set.name}.`),
    restore: () => changeRules(() => ace.rules.restoreBuiltin(set.id), `${set.name}: restored.`),
    saveParts: (parts) => changeRules(() => ace.rules.saveSet({ ...set, parts }), `Saved the changes to ${set.name}.`),
    confirm: (question) => window.confirm(question),
  };
}

/** What the buttons for a whole site do. */
const siteActions = {
  resetToBuiltin: (group) => changeRules(() => ace.rules.setDefault(group.builtin.id),
    `${group.name}: back to the built-in rules. Your own rule sets for it are still in the list.`),
};

async function loadRulesManager() {
  let groups;
  try {
    groups = await ace.rules.groups(currentUrl || '');
  } catch {
    return;
  }
  const removed = AceUI.renderSiteGroups(
    groups,
    { user: $('userRules'), builtins: $('builtinRules'), removed: $('removedRules') },
    $('rulesFilter').value,
    cardActions,
    siteActions,
    (set) => Boolean(set.onThisPage && pageReady && !teaching)
  );
  $('removedBox').hidden = !removed;
  $('removedCount').textContent = String(removed);
}

async function exportRules(ids) {
  try {
    const result = await ace.rules.exportFile(ids || []);
    if (result && result.saved) setStatus(`Saved ${result.count} set(s) of rules to ${result.saved}`);
    else if (result && result.count === 0 && !(ids && ids.length)) setStatus('You have no rules of your own to export yet.');
  } catch (err) {
    setStatus(`Could not export the rules: ${err.message}`);
  }
}

async function importRules() {
  try {
    const result = await ace.rules.importFile();
    if (!result) return;
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
  const guessUnknown = $('batchGuess').checked;

  let done = 0;
  let failed = 0;
  let skipped = 0;

  for (const [i, url] of urls.entries()) {
    if (batchAbort) {
      batchLog('Stopped.', 'err');
      break;
    }
    const prefix = `[${i + 1}/${urls.length}]`;
    const line = batchLog(`${prefix} Loading ${url}`, 'run');
    busy(true, `Batch ${i + 1} of ${urls.length}…`);
    try {
      $('placeholder').style.display = 'none';
      navigate(normaliseUrl(url));
      const outcome = await waitForLoad();
      if (outcome !== 'loaded') {
        line.className = 'logline err';
        line.textContent = `${prefix} ${url} — ${outcome}`;
        failed++;
        continue;
      }
      // Let client-rendered chats paint before the reader starts scrolling.
      await new Promise((r) => setTimeout(r, 1200));

      const pageUrl = view.getURL();
      const site = await ace.rules.resolve(pageUrl);
      if (!site.set && !guessUnknown) {
        line.className = 'logline err';
        line.textContent = `${prefix} ${url} — skipped: no rules for ${hostOf(pageUrl)}. Teach the site, or tick “Also export sites that have no rules”.`;
        skipped++;
        continue;
      }

      const { source } = await ace.inject.extractor(pageUrl);
      const raw = await view.executeJavaScript(source, true);
      recordHealth(raw, pageUrl);
      if (!raw || !raw.ok) {
        line.className = 'logline err';
        line.textContent = raw && raw.reason === 'rules-found-nothing'
          ? `${prefix} ${url} — skipped: the rules for ${raw.rules.name} found nothing. Fix them in Site rules.`
          : `${prefix} ${url} — nothing could be read`;
        if (raw && raw.reason === 'rules-found-nothing') skipped++;
        else failed++;
        continue;
      }
      if (raw.health && raw.health.status === 'broken') {
        line.className = 'logline err';
        line.textContent = `${prefix} ${url} — skipped: ${describeProblems(raw.health)[0] || 'the rules look broken'}`;
        skipped++;
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
      const caution = raw.source === 'guess'
        ? ' · layout guessed'
        : raw.health && raw.health.status === 'warn'
          ? ` · ⚠ ${describeProblems(raw.health)[0] || 'worth a look'}`
          : '';
      line.className = errors.length ? 'logline err' : 'logline ok';
      line.textContent =
        `${prefix} ${raw.title} — ${raw.stats.messages} messages, ${okFiles.length} file(s)${caution}` +
        (errors.length ? ` · failed: ${errors.map((e) => e.format).join(', ')}` : '');
      done++;
    } catch (err) {
      line.className = 'logline err';
      line.textContent = `${prefix} ${url} — ${err.message}`;
      failed++;
    }
  }

  busy(false);
  $('batchBtn').disabled = false;
  $('batchStopBtn').hidden = true;
  const summary = `Finished: ${done} exported, ${skipped} skipped, ${failed} failed.`;
  batchLog(summary, failed || skipped ? 'err' : 'ok');
  setStatus(`Batch ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`);
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

/* --------------------------------------------------------------------- help */

let manual = null;     // the manual viewer, made in wire()
let whatsThis = null;  // "What's this?" mode, likewise

/* ------------------------------------------------------------------ wiring */

function activeTab() {
  const tab = document.querySelector('.tab.active');
  return tab ? tab.dataset.tab : 'export';
}

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

  $('extractBtn').addEventListener('click', () => extract());
  $('exportBtn').addEventListener('click', runExport);
  $('teachBtn').addEventListener('click', () => {
    const set = siteState.set;
    teachSite({ focus: set ? focusFor(set.health) : null });
  });
  $('showRulesBtn').addEventListener('click', () => teachSite({ mode: 'show' }));

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

  for (const mini of document.querySelectorAll('.selectbar .mini')) {
    mini.addEventListener('click', (e) => {
      e.preventDefault();
      applySelectionPreset(mini.dataset.select);
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

  // Site rules tab.
  let filterTimer = null;
  $('rulesFilter').addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(loadRulesManager, 150);
  });
  $('rulesImportBtn').addEventListener('click', importRules);

  // Where files are kept, and starting over.
  $('dataOpenBtn').addEventListener('click', () => ace.data.open());
  $('dataChangeBtn').addEventListener('click', () => moveDataFolder(() => ace.data.change()));
  $('dataDefaultBtn').addEventListener('click', () => moveDataFolder(() => ace.data.useDefault()));
  $('resetSettingsBtn').addEventListener('click', resetSettings);
  $('rulesExportBtn').addEventListener('click', () => exportRules([]));
  $('restoreAllBtn').addEventListener('click', () =>
    changeRules(() => ace.rules.restoreBuiltin('*'), 'Restored every built-in rule set.'));

  // Help: the manual, and "What's this?" for any control.
  manual = AceUI.createManualViewer(
    { overlay: $('helpOverlay'), toc: $('helpToc'), content: $('helpContent'), search: $('helpSearch'), close: $('helpClose') },
    () => ace.help.manual(),
    (url) => ace.shell.external(url)
  );
  whatsThis = AceUI.createWhatsThis(
    { toggleButton: $('whatsThisBtn'), bar: $('whatsThisBar'), done: $('whatsThisDone'), tip: $('helpTip') },
    (section) => manual.open(section)
  );
  $('manualBtn').addEventListener('click', () => manual.open());
  ace.on('help:open', () => manual.open());
  ace.on('help:whatsThis', () => whatsThis.toggle());

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.tab')) t.classList.remove('active');
      for (const p of document.querySelectorAll('.panel')) p.classList.remove('active');
      tab.classList.add('active');
      document.querySelector(`.panel[data-panel="${tab.dataset.tab}"]`).classList.add('active');
      if (tab.dataset.tab === 'library') loadHistory($('librarySearch').value);
      if (tab.dataset.tab === 'rules') loadRulesManager();
      if (tab.dataset.tab === 'merge') loadMergeList();
      if (tab.dataset.tab === 'options') loadDataFolder();
    });
  }

  // Any control change is persisted; content-affecting ones also refresh the
  // preview so the user sees the effect of, say, a redaction rule immediately.
  // The tick boxes survive that refresh — re-reading a chat should not silently
  // discard a selection the user has just made by hand.
  for (const el of document.querySelectorAll('.panel input, .panel select')) {
    if (el.id === 'rulesFilter' || el.closest('.rulelist') || el.closest('.sitecard')) continue;
    el.addEventListener('change', () => {
      persistSettings();
      if (lastRaw && ['optThinking', 'optSystem', 'optMeta'].includes(el.id)) {
        renderPreview({ keepSelection: true });
      }
    });
  }
  $('formats').addEventListener('change', persistSettings);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (manual.isOpen()) {
        manual.hide();
        return;
      }
      if (whatsThis.isOn()) {
        whatsThis.set(false);
        return;
      }
    }
    if (e.key === 'F1') {
      e.preventDefault();
      if (e.shiftKey) whatsThis.toggle();
      else manual.open();
    }
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
  AceUI.renderLegend($('rulesLegend'), $('rulesLegendMore'));
  wire();
  renderSiteCard();
  loadHistory();
  loadMergeList();
  loadDataFolder();
  setStatus('Ready. Paste a chat share link, or sign in to a provider to export a private chat.');
})();
