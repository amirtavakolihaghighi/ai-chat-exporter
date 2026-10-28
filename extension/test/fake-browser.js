/**
 * A stand-in for the slice of the extension API the workspace page uses, so the
 * built page can be booted and inspected in a plain Electron window.
 *
 * Loaded as a preload with context isolation off, which puts it in the page's
 * own world before any of the page's scripts run. Storage is kept in memory;
 * there is no chat tab to attach to, so tab calls fail the way a closed tab does.
 */
'use strict';

const store = new Map();
const copy = (value) => JSON.parse(JSON.stringify(value));
const event = () => ({ addListener() {}, removeListener() {} });
const noTab = async () => {
  throw new Error('No tab with that id.');
};

window.chrome = {
  runtime: {
    getURL: (file) => file,
    onMessage: event(),
    onStartup: event(),
    onInstalled: event(),
    sendMessage: async () => ({}),
  },
  storage: {
    local: {
      async get(keys) {
        const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) if (store.has(key)) out[key] = copy(store.get(key));
        return out;
      },
      async set(items) {
        for (const [key, value] of Object.entries(items)) store.set(key, copy(value));
      },
      async remove(keys) {
        for (const key of [].concat(keys)) store.delete(key);
      },
    },
  },
  tabs: {
    get: noTab,
    sendMessage: noTab,
    getCurrent: async () => null,
    update: async () => ({}),
    create: async () => ({ id: 99 }),
    remove: async () => {},
    query: async () => [],
    onUpdated: event(),
  },
  windows: { update: async () => ({}) },
  permissions: { contains: async () => true, request: async () => true },
  downloads: { download: async () => 1 },
  scripting: { executeScript: async () => [] },
};

/** Lets a test put data in storage, as an earlier version would have left it. */
window.__fakeStorage = store;

/*
 * A folder on disk, as Chrome and Edge give one through the File System Access
 * API: "picking" returns the directory the test names in __fakeFolderDir, and
 * the files land there for the test to read. __folderPermission plays the
 * browser asking again after a restart.
 */
const fs = require('node:fs');
const path = require('node:path');

const notFound = () => new DOMException('A requested file or directory could not be found.', 'NotFoundError');

function fileHandle(file) {
  return {
    kind: 'file',
    name: path.basename(file),
    async getFile() {
      return new File([fs.readFileSync(file)], path.basename(file));
    },
    async createWritable() {
      const chunks = [];
      return {
        async write(data) {
          if (typeof data === 'string') chunks.push(Buffer.from(data, 'utf8'));
          else if (data instanceof Blob) chunks.push(Buffer.from(await data.arrayBuffer()));
          else chunks.push(Buffer.from(data));
        },
        async close() {
          fs.writeFileSync(file, Buffer.concat(chunks));
        },
      };
    },
  };
}

function dirHandle(dir) {
  return {
    kind: 'directory',
    name: path.basename(dir),
    async queryPermission() {
      return window.__folderPermission || 'granted';
    },
    async requestPermission() {
      window.__folderPermission = 'granted';
      return 'granted';
    },
    async getDirectoryHandle(name, { create = false } = {}) {
      const target = path.join(dir, name);
      if (!fs.existsSync(target)) {
        if (!create) throw notFound();
        fs.mkdirSync(target, { recursive: true });
      }
      return dirHandle(target);
    },
    async getFileHandle(name, { create = false } = {}) {
      const target = path.join(dir, name);
      if (!fs.existsSync(target)) {
        if (!create) throw notFound();
        fs.writeFileSync(target, '');
      }
      return fileHandle(target);
    },
  };
}

window.__fakeFolderDir = null;
window.showDirectoryPicker = async () => {
  if (!window.__fakeFolderDir) throw new DOMException('The user aborted a request.', 'AbortError');
  return dirHandle(window.__fakeFolderDir);
};
// IndexedDB cannot keep this make-believe folder; the extension looks here first.
const folderHandles = new Map();
window.__aceFolderHandles = {
  get: async () => folderHandles.get('data') || null,
  set: async (handle) => {
    folderHandles.set('data', handle);
  },
  remove: async () => {
    folderHandles.delete('data');
  },
};
