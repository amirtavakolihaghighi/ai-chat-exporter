'use strict';

const { api } = require('./browser');

/**
 * Persistence for the extension.
 *
 * Two stores, chosen deliberately:
 *  - storage.local for settings and saved site rules. Small, synchronous to
 *    reason about, and readable from any extension context.
 *  - IndexedDB for the library. Conversations are far too big for the
 *    storage.local quota, and IndexedDB has no practical size ceiling.
 */

const SETTINGS_KEY = 'ace:settings';
const PACKS_KEY = 'ace:userPacks';
const DB_NAME = 'ai-chat-extractor';
const DB_VERSION = 1;
const STORE_CAPTURES = 'captures';
const STORE_LIBRARY = 'library';

const DEFAULT_SETTINGS = {
  filenameTemplate: '{date} - {provider} - {title}',
  theme: 'light',
  fontSize: 15,
  includeMeta: true,
  includeThinking: true,
  includeSystem: true,
  frontmatter: true,
  embedImages: true,
  assetMode: 'inline',
  pageBreakPerTurn: false,
  expandLinks: false,
  jpegQuality: 92,
  settleMs: 450,
  maxScrollSteps: 400,
  maxReadSeconds: 90,
  lastFormats: ['md'],
  redactions: [],
  minCodeLines: 1,
  assistantOnlyCode: false,
  screenshotDelayMs: 550,
};

/* --------------------------------------------------------------- settings */

async function getSettings() {
  const stored = await api.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] || {}) };
}

async function saveSettings(patch) {
  const merged = { ...(await getSettings()), ...(patch || {}) };
  await api.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

/* ------------------------------------------------------------- user packs */

async function getUserPacks() {
  const stored = await api.storage.local.get(PACKS_KEY);
  return stored[PACKS_KEY] || {};
}

async function saveUserPack(host, pack) {
  const packs = await getUserPacks();
  if (pack === null) delete packs[host];
  else packs[host] = { ...packs[host], ...pack, host, updatedAt: new Date().toISOString() };
  await api.storage.local.set({ [PACKS_KEY]: packs });
  return packs;
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
  getUserPacks,
  saveUserPack,
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
