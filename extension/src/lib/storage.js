'use strict';

const { api } = require('./browser');
const rules = require('../../../src/shared/rules');
const settingsLib = require('../../../src/shared/settings');
const folder = require('./folder');
// The defaults both apps start with, kept with the project; bundled at build time.
const DEFAULTS_FILE = require('../../../config/default-settings.json');

/**
 * Persistence for the extension.
 *
 * Two stores, chosen deliberately:
 *  - storage.local for settings and site rules. Small, synchronous to reason
 *    about, and readable from any extension context.
 *  - IndexedDB for the library. Conversations are far too big for the
 *    storage.local quota, and IndexedDB has no practical size ceiling.
 *
 * Settings and rules are also kept in a folder on the computer when the person
 * links one (see ./folder.js) — the desktop app's data folder, say, so both
 * share one set of rules. The browser's copy stays the working copy.
 */

const SETTINGS_KEY = 'ace:settings';
const SETTINGS_SAVED_KEY = 'ace:settingsSavedAt';
const SETTINGS_BACKUP_KEY = 'ace:settingsBeforeReset';
const RULES_KEY = 'ace:siteRules';
// When the browser's copies and the folder's were last the same.
const SYNC_KEY = 'ace:folderSyncedAt';
// Where the old one-click picker kept its rules. Read once, to convert them;
// never changed or removed, so it stays as a backup.
const LEGACY_PACKS_KEY = 'ace:userPacks';
const DB_NAME = 'ai-chat-extractor';
const DB_VERSION = 1;
const STORE_CAPTURES = 'captures';
const STORE_LIBRARY = 'library';

const DEFAULT_SETTINGS = settingsLib.defaultsFor('extension', DEFAULTS_FILE);

// One change at a time — to the settings, the rules or the folder's copies —
// so two arriving together cannot lose one.
let queue = Promise.resolve();
function inTurn(work) {
  const run = queue.then(work);
  queue = run.catch(() => {});
  return run;
}

/* --------------------------------------------------------------- settings */

async function getSettings() {
  const stored = await api.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

function saveSettings(patch) {
  return inTurn(async () => {
    const merged = { ...(await getSettings()), ...(patch || {}) };
    await api.storage.local.set({ [SETTINGS_KEY]: merged, [SETTINGS_SAVED_KEY]: new Date().toISOString() });
    await syncNow();
    return merged;
  });
}

/** Every option back to its default; the ones there were are kept aside. */
function resetSettings() {
  return inTurn(async () => {
    const stored = await api.storage.local.get(SETTINGS_KEY);
    await api.storage.local.set({
      [SETTINGS_BACKUP_KEY]: stored[SETTINGS_KEY] || {},
      [SETTINGS_KEY]: {},
      [SETTINGS_SAVED_KEY]: new Date().toISOString(),
    });
    await syncNow();
    return getSettings();
  });
}

/* ------------------------------------------------------------- site rules */

/**
 * Site rules — see src/shared/rules.js, which both apps share. Rules saved by
 * the old picker are converted the first time this is read.
 */
async function getSiteRules() {
  const stored = await api.storage.local.get([RULES_KEY, LEGACY_PACKS_KEY]);
  if (stored[RULES_KEY]) return rules.normaliseStore(stored[RULES_KEY]);
  const legacy = stored[LEGACY_PACKS_KEY];
  const store = legacy ? rules.migrateLegacyPacks(legacy) : rules.emptyStore();
  // Saved straight away so the converted rules keep the same identity.
  if (store.sets.length) await api.storage.local.set({ [RULES_KEY]: store });
  return store;
}

/**
 * Applies `change(store)` to the saved rules; resolves with what it returned.
 * With a folder in use, its copy is taken in first — the desktop app may have
 * changed it — so the change lands on the newest rules, and written after.
 */
function updateSiteRules(change) {
  return inTurn(async () => {
    await syncNow();
    const store = await getSiteRules();
    const value = change(store);
    store.savedAt = new Date().toISOString();
    await api.storage.local.set({ [RULES_KEY]: store });
    await syncNow();
    return value;
  });
}

/* ------------------------------------------------------- the linked folder */

/** Brings the rules in the browser and in the folder into step. */
async function syncRules(handle, syncedAt) {
  const local = await getSiteRules();
  const file = await folder.readJson(handle, 'rules');
  const fileStore = file.exists ? rules.normaliseStore(file.value) : null;
  const action = folder.decide({
    localAt: local.savedAt,
    fileAt: fileStore && fileStore.savedAt,
    syncedAt,
    fileExists: Boolean(fileStore),
  });
  if (action === 'none') return syncedAt;
  let result = local;
  if (action === 'adopt') result = fileStore;
  if (action === 'merge') result = { ...rules.mergeStores(local, fileStore), savedAt: new Date().toISOString() };
  if (!result.savedAt) result = { ...result, savedAt: new Date().toISOString() };
  if (action !== 'write') await api.storage.local.set({ [RULES_KEY]: result });
  if (action !== 'adopt') await folder.writeJson(handle, 'rules', result);
  return result.savedAt;
}

/** The same for the options; the folder's file holds only those that were changed. */
async function syncSettings(handle, syncedAt) {
  const stored = await api.storage.local.get([SETTINGS_KEY, SETTINGS_SAVED_KEY]);
  const local = { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
  const localAt = stored[SETTINGS_SAVED_KEY] || '';
  const file = await folder.readJson(handle, 'settings');
  const fileValue = file.exists && file.value && typeof file.value === 'object' ? file.value : null;
  const action = folder.decide({ localAt, fileAt: fileValue && fileValue.savedAt, syncedAt, fileExists: Boolean(fileValue) });
  if (action === 'none') return syncedAt;
  const fromFile = settingsLib.withDefaults(fileValue && fileValue.options, DEFAULT_SETTINGS);
  let result = local;
  let savedAt = localAt || new Date().toISOString();
  if (action === 'adopt') {
    result = fromFile;
    savedAt = fileValue.savedAt;
  }
  if (action === 'merge') {
    const fileNewer = (Date.parse(fileValue.savedAt || '') || 0) > (Date.parse(localAt) || 0);
    const mine = settingsLib.changedFrom(local, DEFAULT_SETTINGS);
    const theirs = settingsLib.changedFrom(fromFile, DEFAULT_SETTINGS);
    result = settingsLib.withDefaults(fileNewer ? { ...mine, ...theirs } : { ...theirs, ...mine }, DEFAULT_SETTINGS);
    savedAt = new Date().toISOString();
  }
  if (action !== 'write') await api.storage.local.set({ [SETTINGS_KEY]: result, [SETTINGS_SAVED_KEY]: savedAt });
  if (action !== 'adopt') {
    await folder.writeJson(handle, 'settings', { savedAt, options: settingsLib.changedFrom(result, DEFAULT_SETTINGS) });
  }
  return savedAt;
}

/** Runs inside the queue: brings both copies into step if the folder can be written now. */
async function syncNow() {
  const handle = await folder.ready();
  if (!handle) return false;
  const stored = await api.storage.local.get(SYNC_KEY);
  const synced = stored[SYNC_KEY] || {};
  const next = {
    rules: await syncRules(handle, synced.rules),
    settings: await syncSettings(handle, synced.settings),
  };
  await api.storage.local.set({ [SYNC_KEY]: next });
  return true;
}

/**
 * Brings the browser's copies and the folder's into step — when the workspace
 * opens or comes back into view, and after a folder is chosen or allowed.
 * Resolves with the folder's state (see folder.state()).
 */
async function syncFolder() {
  await inTurn(() => syncNow().catch(() => false));
  return folder.state();
}

/** Forgets the folder; the next one chosen is compared afresh. */
async function forgetFolder() {
  await folder.forget();
  await api.storage.local.remove(SYNC_KEY);
  return folder.state();
}

/* ------------------------------------------------------------- indexeddb */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_CAPTURES)) {
        db.createObjectStore(STORE_CAPTURES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_LIBRARY)) {
        const store = db.createObjectStore(STORE_LIBRARY, { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    let result;
    try {
      result = fn(objectStore);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* -------------------------------------------------------------- captures */

/**
 * A capture is the raw result of reading a page, held until it is exported.
 * Kept out of the library so a read that is never exported does not clutter it.
 */
async function putCapture(capture) {
  const db = await openDb();
  const id = capture.id || `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const record = { ...capture, id, at: new Date().toISOString() };
  await tx(db, STORE_CAPTURES, 'readwrite', (store) => store.put(record));
  db.close();
  return id;
}

async function getCapture(id) {
  const db = await openDb();
  const record = await tx(db, STORE_CAPTURES, 'readonly', (store) => requestToPromise(store.get(id)));
  db.close();
  return record ? await record : null;
}

async function deleteCapture(id) {
  const db = await openDb();
  await tx(db, STORE_CAPTURES, 'readwrite', (store) => store.delete(id));
  db.close();
}

/** Captures are scratch space; drop anything older than a day on startup. */
async function pruneCaptures(maxAgeMs = 24 * 60 * 60 * 1000) {
  const db = await openDb();
  const all = await tx(db, STORE_CAPTURES, 'readonly', (store) => requestToPromise(store.getAll()));
  const list = await all;
  const cutoff = Date.now() - maxAgeMs;
  const stale = list.filter((c) => new Date(c.at).getTime() < cutoff);
  if (stale.length) {
    await tx(db, STORE_CAPTURES, 'readwrite', (store) => {
      for (const c of stale) store.delete(c.id);
    });
  }
  db.close();
  return stale.length;
}

/* --------------------------------------------------------------- library */

const MAX_RECORD_CHARS = 400_000;

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
  const db = await openDb();
  const record = capRecord({
    ...entry,
    id: `lib-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  });
  await tx(db, STORE_LIBRARY, 'readwrite', (store) => store.put(record));
  db.close();
  return record.id;
}

async function allLibraryRecords() {
  const db = await openDb();
  const request = await tx(db, STORE_LIBRARY, 'readonly', (store) => requestToPromise(store.getAll()));
  const list = (await request) || [];
  db.close();
  return list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Summaries only, so the UI never holds every conversation in memory. */
async function getLibrary(limit = 300) {
  const list = await allLibraryRecords();
  return list.slice(0, limit).map(({ messages, ...rest }) => ({
    ...rest,
    messageCount: rest.messageCount ?? (messages ? messages.length : 0),
  }));
}

async function getLibraryRecords(ids) {
  const wanted = new Set(ids || []);
  return (await allLibraryRecords()).filter((record) => wanted.has(record.id));
}

/**
 * Full-text search. Every term must appear somewhere in the conversation, which
 * is what people expect when they add a word to narrow a search down.
 */
async function searchLibrary(query, limit = 50) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return [];

  const results = [];
  for (const record of await allLibraryRecords()) {
    const parts = [
      record.title || '',
      record.provider || '',
      record.url || '',
      ...(record.messages || []).map((m) => m.markdown || m.text || ''),
    ];
    const raw = parts.join('\n');
    const haystack = raw.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;

    const hit = haystack.indexOf(terms[0]);
    const start = Math.max(0, hit - 90);
    results.push({
      id: record.id,
      at: record.at,
      title: record.title,
      url: record.url,
      provider: record.provider,
      messageCount: (record.messages || []).length,
      formats: record.formats || [],
      snippet:
        (start > 0 ? '…' : '') +
        raw.slice(start, Math.min(raw.length, hit + 190)).replace(/\s+/g, ' ').trim() +
        (hit + 190 < raw.length ? '…' : ''),
    });
    if (results.length >= limit) break;
  }
  return results;
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

/** The most recent export of this same chat, so a short read can be noticed. */
async function lastExportOf(url) {
  const target = comparableUrl(url);
  if (!target) return null;
  const hit = (await allLibraryRecords()).find((record) => comparableUrl(record.url) === target);
  return hit ? { messageCount: hit.messageCount ?? (hit.messages || []).length, at: hit.at } : null;
}

async function deleteLibraryEntry(id) {
  const db = await openDb();
  await tx(db, STORE_LIBRARY, 'readwrite', (store) => store.delete(id));
  db.close();
}

async function clearLibrary() {
  const db = await openDb();
  await tx(db, STORE_LIBRARY, 'readwrite', (store) => store.clear());
  db.close();
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  resetSettings,
  getSiteRules,
  updateSiteRules,
  syncFolder,
  forgetFolder,
  lastExportOf,
  putCapture,
  getCapture,
  deleteCapture,
  pruneCaptures,
  addLibraryEntry,
  getLibrary,
  getLibraryRecords,
  searchLibrary,
  deleteLibraryEntry,
  clearLibrary,
};
