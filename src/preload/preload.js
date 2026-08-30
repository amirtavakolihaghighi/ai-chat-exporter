'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer gets exactly these calls and nothing else — no ipcRenderer, no
 * fs, no require. Every filesystem write goes through an explicit main-process
 * handler.
 */
const api = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    resolve: (url) => ipcRenderer.invoke('packs:resolve', url),
  },
  packs: {
    get: () => ipcRenderer.invoke('packs:get'),
    save: (host, pack) => ipcRenderer.invoke('packs:save', { host, pack }),
  },
  library: {
    get: (limit) => ipcRenderer.invoke('library:get', limit),
    search: (query) => ipcRenderer.invoke('library:search', query),
    clear: () => ipcRenderer.invoke('library:clear'),
  },
  merge: {
    pickFiles: () => ipcRenderer.invoke('merge:pickFiles'),
    run: (payload) => ipcRenderer.invoke('merge:run', payload),
  },
  inject: {
    extractor: (url) => ipcRenderer.invoke('inject:extractor', url),
    picker: () => ipcRenderer.invoke('inject:picker'),
  },
  exports: {
    run: (payload) => ipcRenderer.invoke('export:run', payload),
    preview: (payload) => ipcRenderer.invoke('export:preview', payload),
  },
  dialog: {
    chooseDir: (current) => ipcRenderer.invoke('dialog:chooseDir', current),
  },
  shell: {
    open: (target) => ipcRenderer.invoke('shell:open', target),
    reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
    external: (url) => ipcRenderer.invoke('shell:external', url),
  },
  images: {
    fetchMany: (urls) => ipcRenderer.invoke('images:fetchMany', urls),
  },
  session: {
    clear: () => ipcRenderer.invoke('session:clear'),
  },
  on: (channel, handler) => {
    const allowed = ['guest:navigated', 'session:cleared'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, ...args) => handler(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('ace', api);
