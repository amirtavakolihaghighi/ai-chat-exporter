'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const rules = require('../../shared/rules');
const settingsLib = require('../../shared/settings');
const paths = require('./paths');

/**
 * Plain JSON files in the data folder (see ./paths.js): settings, site rules
 * and the library, each in a folder of its own. Everything the app knows lives
 * there and nowhere else — there is no network component, no telemetry and no
 * account.
 */

/** The defaults, kept with the project so they can be read and changed there. */
const DEFAULTS_FILE = path.join(__dirname, '..', '..', '..', 'config', 'default-settings.json');

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

function writeJsonSync(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/* ------------------------------------------------- from the old location */

/**
 * Older versions kept every file side by side in Electron's profile folder.
 * The first time a file is missing from the data folder, the old one is copied
 * there — copied, never moved: the original stays where it was, as a backup,
 * and an older version of the app still finds it.
 */
let movedIn = false;

function copyOldFiles() {
  if (movedIn) return;
  movedIn = true;
  const old = (name) => path.join(app.getPath('userData'), name);
  const copies = [
    [old('settings.json'), paths.file('settings'), cleanOldSettings],
    [old('site-rules.json'), paths.file('rules')],
    [old('user-packs.json'), path.join(paths.folder('rules'), LEGACY_PACKS_FILE)],
    [old('library.json'), paths.file('library')],
    [old('history.json'), path.join(paths.folder('library'), 'history.json')],
  ];
  for (const [from, to, transform] of copies) {
    if (path.resolve(from) === path.resolve(to) || fs.existsSync(to) || !fs.existsSync(from)) continue;
    try {
      if (transform) writeJsonSync(to, transform(readJson(from, {})));
      else {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      }
    } catch {
      /* the old file is still there to read by hand */
    }
  }
}

/**
 * The old settings file held every option, changed or not, and the old
 * default output folder — the installed app's default still, elsewhere no
 * longer. Keep only what the person actually changed.
 */
function cleanOldSettings(old) {
  const value = { ...old };
  const oldDefault = path.join(app.getPath('documents'), 'AI Chat Exports');
  if (typeof value.outDir === 'string' && path.resolve(value.outDir) === path.resolve(oldDefault)) delete value.outDir;
  const defaults = defaultSettings();
  return settingsLib.changedFrom(settingsLib.withDefaults(value, defaults), defaults);
}

/* ---------------------------------------------------------------- settings */

/**
 * The defaults: config/default-settings.json over the built-in ones. "Save to"
 * left empty means the default exports folder (see paths.exportsDir).
 */
function defaultSettings() {
  const defaults = settingsLib.defaultsFor('desktop', readJson(DEFAULTS_FILE, null));
  if (!defaults.outDir) defaults.outDir = paths.exportsDir();
  return defaults;
}

let settingsCache = null;

function getSettings() {
  if (!settingsCache) {
    copyOldFiles();
    const defaults = defaultSettings();
    settingsCache = settingsLib.withDefaults(readJson(paths.file('settings'), {}), defaults);
    if (!settingsCache.outDir) settingsCache.outDir = defaults.outDir;
  }
  return settingsCache;
}

/** Saves the options; the file keeps only those that differ from the defaults. */
async function saveSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  await writeJsonAtomic(paths.file('settings'), settingsLib.changedFrom(settingsCache, defaultSettings()));
  return settingsCache;
}

/** Every option back to its default. The file as it was is kept beside it. */
async function resetSettings() {
  const file = paths.file('settings');
  if (fs.existsSync(file)) {
    await fsp.copyFile(file, path.join(path.dirname(file), `settings.before-reset-${stamp()}.json`));
  }
  await writeJsonAtomic(file, {});
  settingsCache = null;
  return getSettings();
}

/* -------------------------------------------------------------- site rules */

/**
 * Site rules — which parts of a chat page are messages — that the person taught
 * or imported, plus their choices about the built-in ones (turned off,
 * removed). The shape and the logic live in src/shared/rules.js, shared with
 * the extension; this is only where they are kept.
 *
 * Rules saved by older versions — one selector per site, in user-packs.json —
 * are converted the first time this is read. The old file is never changed or
 * deleted; it stays where it was, as a backup.
 */
const LEGACY_PACKS_FILE = 'user-packs.json';

function getSiteRules() {
  copyOldFiles();
  const file = paths.file('rules');
  if (fs.existsSync(file)) {
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // Unreadable, but possibly repairable by hand. Keep it under another
      // name instead of letting the next save write over it.
      const aside = `${file}.unreadable-${Date.now()}`;
      try {
        fs.renameSync(file, aside);
      } catch {
        /* if it cannot be moved it cannot be overwritten either */
      }
    }
    return rules.normaliseStore(raw);
  }

  const legacy = readJson(path.join(paths.folder('rules'), LEGACY_PACKS_FILE), null);
  const store = legacy ? rules.migrateLegacyPacks(legacy) : rules.emptyStore();
  if (store.sets.length) {
    // Written straight away so the converted rules keep the same identity
    // from one read to the next.
    writeJsonSync(file, { ...store, savedAt: new Date().toISOString() });
  }
  return store;
}

// One change at a time: reading, changing and writing the file must not
// interleave, or a save and a health record arriving together lose one.
let rulesQueue = Promise.resolve();

/**
 * Applies `change(store)` to the saved rules and writes the result.
 * Resolves with whatever `change` returned.
 */
function updateSiteRules(change) {
  const run = rulesQueue.then(async () => {
    const store = getSiteRules();
    const value = change(store);
    // When it was saved: the extension, sharing this file, keeps the newer copy.
    store.savedAt = new Date().toISOString();
    await writeJsonAtomic(paths.file('rules'), store);
    return value;
  });
  rulesQueue = run.catch(() => {});
  return run;
}

/* ----------------------------------------------------------------- library */

/**
 * The library is the index of everything ever exported: one small record per
 * export, holding enough of the conversation to search it later and to rebuild
 * it into a merged document — without having to revisit the original site.
 *
 * Records deliberately keep Markdown and plain text but not the page HTML.
 * HTML carries inlined images as data URIs, and storing those would turn a
 * few-hundred-kilobyte index into a multi-gigabyte one.
 */

const LIBRARY_LIMIT = 1000;
const MAX_RECORD_CHARS = 400_000;

function libraryFile() {
  copyOldFiles();
  return paths.file('library');
}

/**
 * Brings a stored record up to the current shape.
 *
 * Entries written by the older history file recorded `messages` as a count
 * rather than as the messages themselves, so anything reading the array has to
 * cope with finding a number there. Those entries stay listable and openable;
 * they simply have no text to search or merge, having never stored any.
 */
function normaliseRecord(record, index) {
  const messages = Array.isArray(record.messages) ? record.messages : [];
  const messageCount =
    typeof record.messageCount === 'number'
      ? record.messageCount
      : typeof record.messages === 'number'
        ? record.messages
        : messages.length;
  return {
    ...record,
    id: record.id || `legacy-${index}-${String(record.at || '').replace(/\D/g, '').slice(0, 14)}`,
    messages,
    messageCount,
  };
}

function readLibrary() {
  const list = readJson(libraryFile(), null);
  if (Array.isArray(list)) return list.map(normaliseRecord);

  // First run after upgrading: fold the old history file in so nothing is lost.
  const legacy = readJson(path.join(paths.folder('library'), 'history.json'), []);
  return Array.isArray(legacy) ? legacy.map(normaliseRecord) : [];
}

/** Trims a record so one enormous chat cannot dominate the index. */
function capRecord(record) {
  let budget = MAX_RECORD_CHARS;
  const messages = [];
  for (const message of record.messages || []) {
    if (budget <= 0) break;
    const markdown = String(message.markdown || '').slice(0, budget);
    budget -= markdown.length;
    messages.push({
      role: message.role,
      label: message.label,
      markdown,
      text: String(message.text || '').slice(0, 4000),
    });
  }
  return { ...record, messages, truncated: messages.length < (record.messages || []).length };
}

async function addLibraryEntry(entry) {
  const library = readLibrary();
  const record = capRecord({
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  });
  library.unshift(record);
  const trimmed = library.slice(0, LIBRARY_LIMIT);
  await writeJsonAtomic(libraryFile(), trimmed);
  return record.id;
}

/** Summaries only — message bodies stay in the main process. */
function getLibrary(limit = 300) {
  return readLibrary()
    .slice(0, limit)
    .map(({ messages, ...rest }) => rest);
}

function getLibraryRecords(ids) {
  const wanted = new Set(ids || []);
  return readLibrary().filter((record) => wanted.has(record.id));
}

/**
 * Full-text search across every stored conversation.
 *
 * All terms must appear somewhere in the chat (AND), which is what people
 * expect when they add a word to narrow a search down. Results carry a snippet
 * around the first hit so you can tell which chat you actually want.
 */
function searchLibrary(query, limit = 50) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!terms.length) return [];

  const results = [];
  for (const record of readLibrary()) {
    const haystacks = [
      record.title || '',
      record.provider || '',
      record.url || '',
      ...(record.messages || []).map((m) => m.markdown || m.text || ''),
    ];
    const joined = haystacks.join('\n').toLowerCase();
    if (!terms.every((term) => joined.includes(term))) continue;

    const hit = joined.indexOf(terms[0]);
    const start = Math.max(0, hit - 90);
    const raw = haystacks.join('\n');
    results.push({
      id: record.id,
      at: record.at,
      title: record.title,
      url: record.url,
      provider: record.provider,
      messageCount: record.messageCount,
      files: record.files || [],
      snippet:
        (start > 0 ? '…' : '') +
        raw.slice(start, Math.min(raw.length, hit + 190)).replace(/\s+/g, ' ').trim() +
        (hit + 190 < raw.length ? '…' : ''),
    });
    if (results.length >= limit) break;
  }
  return results;
}

async function clearLibrary() {
  await writeJsonAtomic(libraryFile(), []);
  return [];
}

/** The same page whatever its query string, fragment or trailing slash. */
function comparableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * The most recent export of this same chat, if there is one.
 *
 * Lets a read notice that it came back far shorter than last time — the
 * clearest sign that rules have stopped finding part of the conversation.
 */
function lastExportOf(url) {
  const target = comparableUrl(url);
  if (!target) return null;
  const hit = readLibrary().find((record) => comparableUrl(record.url) === target);
  return hit ? { messageCount: hit.messageCount, at: hit.at, title: hit.title } : null;
}

/* ------------------------------------------------------ moving the folder */

/**
 * Copies settings, rules and library into another data folder — for moving
 * there. Never over files already in it, and the originals stay as they are.
 * Exports are not copied: they can be large, and they stay where they were.
 */
async function copyDataTo(dir) {
  copyOldFiles();
  const copied = [];
  for (const [name, parts] of Object.entries(paths.FILES)) {
    const from = paths.file(name);
    const to = path.join(dir, ...parts);
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
    copied.push(name);
  }
  return copied;
}

module.exports = {
  defaultSettings,
  getSettings,
  saveSettings,
  resetSettings,
  copyDataTo,
  getSiteRules,
  updateSiteRules,
  lastExportOf,
  addLibraryEntry,
  getLibrary,
  getLibraryRecords,
  searchLibrary,
  clearLibrary,
};
