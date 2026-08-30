'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Flat JSON persistence in the app's userData folder. Everything the app knows
 * lives here and nowhere else — there is no network component, no telemetry
 * and no account.
 */

const DEFAULT_SETTINGS = {
  outDir: '',
  filenameTemplate: '{date} - {provider} - {title}',
  theme: 'light',
  fontSize: 15,
  includeMeta: true,
  includeThinking: true,
  includeSystem: true,
  frontmatter: true,
  embedImages: true,
  assetMode: 'inline',
  captureMode: 'clean',
  pageSize: 'A4',
  marginInches: 0.5,
  landscape: false,
  scale: 1,
  pageNumbers: true,
  printBackground: true,
  pageBreakPerTurn: false,
  expandLinks: false,
  jpegQuality: 92,
  settleMs: 450,
  maxScrollSteps: 400,
  maxReadSeconds: 90,
  openAfterExport: true,
  lastFormats: ['pdf'],
  redactions: [],
};

function userDataFile(name) {
  return path.join(app.getPath('userData'), name);
}

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

/* ---------------------------------------------------------------- settings */

let settingsCache = null;

function getSettings() {
  if (!settingsCache) {
    const stored = readJson(userDataFile('settings.json'), {});
    settingsCache = { ...DEFAULT_SETTINGS, ...stored };
    if (!settingsCache.outDir) {
      settingsCache.outDir = path.join(app.getPath('documents'), 'AI Chat Exports');
    }
  }
  return settingsCache;
}

async function saveSettings(patch) {
  settingsCache = { ...getSettings(), ...patch };
  await writeJsonAtomic(userDataFile('settings.json'), settingsCache);
  return settingsCache;
}

/* -------------------------------------------------------------- user packs */

/**
 * Selectors the user taught the app with the element picker, keyed by hostname.
 * These override the built-in packs, which is how the app survives a provider
 * redesign without waiting for an update.
 */
function getUserPacks() {
  return readJson(userDataFile('user-packs.json'), {});
}

async function saveUserPack(host, pack) {
  const packs = getUserPacks();
  if (pack === null) delete packs[host];
  else packs[host] = { ...packs[host], ...pack, host, updatedAt: new Date().toISOString() };
  await writeJsonAtomic(userDataFile('user-packs.json'), packs);
  return packs;
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
  return userDataFile('library.json');
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
  const legacy = readJson(userDataFile('history.json'), []);
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

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  getUserPacks,
  saveUserPack,
  addLibraryEntry,
  getLibrary,
  getLibraryRecords,
  searchLibrary,
  clearLibrary,
  userDataFile,
};
