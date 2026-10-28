'use strict';

/**
 * A folder on the computer that the extension keeps its files in, besides the
 * browser's own storage: its options, the site rules, exports and exported
 * rules — in the same layout as the desktop app's data folder, so both can
 * share one (and with it, one set of site rules):
 *
 *   settings/extension-settings.json   the options you changed, and only those
 *   rules/site-rules.json              site rules, the same file the desktop app uses
 *   exports/                           exported chats
 *
 * Browsers let an extension write to a folder only after the person picks it,
 * and only Chromium browsers (Chrome, Edge) can, through the File System Access
 * API. The folder is remembered in IndexedDB; after a restart the browser may
 * want permission again, which takes a click.
 *
 * The browser's storage stays the working copy: everything works without a
 * folder, and a folder that is missing or not allowed is simply not written
 * until it is back.
 */

const DB_NAME = 'ai-chat-extractor-folder';
const DB_STORE = 'handles';
const KEY = 'data';

const FILES = {
  settings: ['settings', 'extension-settings.json'],
  rules: ['rules', 'site-rules.json'],
};

const supported = () => typeof globalThis.showDirectoryPicker === 'function';

/* ------------------------------------------------ remembering the folder */

function withDb(mode, work) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(DB_STORE, mode);
      const result = work(tx.objectStore(DB_STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(result && 'result' in result ? result.result : undefined);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

const indexedDbHandles = {
  get: () => withDb('readonly', (store) => store.get(KEY)),
  set: (handle) => withDb('readwrite', (store) => store.put(handle, KEY)),
  remove: () => withDb('readwrite', (store) => store.delete(KEY)),
};

// The extension's tests stand in for IndexedDB here: it cannot keep their
// make-believe folder, only a real one.
const handles = () => globalThis.__aceFolderHandles || indexedDbHandles;

/* ---------------------------------------------------------------- state */

/**
 * Where things stand:
 *   { status: 'unsupported' }                 this browser cannot (Firefox)
 *   { status: 'none' }                         no folder chosen
 *   { status: 'needs-permission', name }       chosen, waiting for a click
 *   { status: 'ready', name, handle }          in use
 */
async function state() {
  if (!supported()) return { status: 'unsupported' };
  let handle = null;
  try {
    handle = await handles().get();
  } catch {
    handle = null;
  }
  if (!handle) return { status: 'none' };
  let permission = 'prompt';
  try {
    permission = await handle.queryPermission({ mode: 'readwrite' });
  } catch {
    permission = 'prompt';
  }
  return permission === 'granted' ? { status: 'ready', name: handle.name, handle } : { status: 'needs-permission', name: handle.name };
}

/** The folder when it can be written to now, or null. */
async function ready() {
  const now = await state();
  return now.status === 'ready' ? now.handle : null;
}

/** Asks the person to pick a folder. Needs a click to start from. */
async function choose() {
  const handle = await globalThis.showDirectoryPicker({ id: 'ai-chat-extractor', mode: 'readwrite' });
  await handles().set(handle);
  return state();
}

/** Asks for permission again, after a browser restart. Needs a click to start from. */
async function allowAgain() {
  const handle = await handles().get();
  if (!handle) return state();
  await handle.requestPermission({ mode: 'readwrite' });
  return state();
}

/** Stops using the folder. The folder and the files in it are left as they are. */
async function forget() {
  await handles().remove();
  return state();
}

/* ------------------------------------------------------------ the files */

async function folderIn(handle, name, create) {
  return handle.getDirectoryHandle(name, { create });
}

/**
 * Reads one of the JSON files: { exists, value }. A file that is there but
 * cannot be read is put aside under another name — it may be repairable by
 * hand — so that writing the browser's copy never lands on top of it.
 */
async function readJson(handle, which) {
  const [dirName, fileName] = FILES[which];
  let file;
  try {
    const dir = await folderIn(handle, dirName, false);
    file = await (await dir.getFileHandle(fileName)).getFile();
  } catch {
    return { exists: false, value: null };
  }
  const text = await file.text();
  try {
    return { exists: true, value: JSON.parse(text) };
  } catch {
    const dir = await folderIn(handle, dirName, true);
    await writeText(dir, `${fileName}.unreadable-${Date.now()}`, text);
    return { exists: false, value: null };
  }
}

async function writeText(dir, name, content) {
  const out = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await out.write(content);
  await out.close();
}

async function writeJson(handle, which, value) {
  const [dirName, fileName] = FILES[which];
  await writeText(await folderIn(handle, dirName, true), fileName, JSON.stringify(value, null, 2));
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a file in one of the folder's own folders — `exports` or `rules` —
 * at `relative` (which may name a subfolder, such as "chat_files/image.png").
 * Never over an earlier file: a second "chat.md" becomes "chat (2).md".
 * Resolves with the path it was saved at, from the folder's name.
 */
async function saveFile(handle, area, relative, blob) {
  const parts = String(relative).split('/').filter(Boolean);
  const name = parts.pop();
  let dir = await folderIn(handle, area, true);
  for (const part of parts) dir = await folderIn(dir, part, true);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let chosen = name;
  for (let n = 2; await exists(dir, chosen); n++) chosen = `${stem} (${n})${ext}`;
  const out = await (await dir.getFileHandle(chosen, { create: true })).createWritable();
  await out.write(blob);
  await out.close();
  return [handle.name, area, ...parts, chosen].join('/');
}

/* -------------------------------------------------------- keeping in step */

const time = (iso) => Date.parse(iso || '') || 0;

/**
 * What to do with the browser's copy and the folder's, given when each was
 * saved and when they were last the same:
 *   'write'  the folder's is missing or behind — write the browser's there
 *   'adopt'  the browser's is behind — take the folder's
 *   'merge'  both changed (or were never compared) — keep what is in both
 *   'none'   nothing to do
 */
function decide({ localAt, fileAt, syncedAt, fileExists }) {
  if (!fileExists) return 'write';
  if (!syncedAt) return 'merge';
  const localChanged = time(localAt) > time(syncedAt);
  const fileChanged = time(fileAt) > time(syncedAt);
  if (localChanged && fileChanged) return 'merge';
  if (fileChanged) return 'adopt';
  if (localChanged) return 'write';
  return 'none';
}

module.exports = {
  FILES,
  supported,
  state,
  ready,
  choose,
  allowAgain,
  forget,
  readJson,
  writeJson,
  saveFile,
  decide,
};
