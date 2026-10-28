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
    reset: () => ipcRenderer.invoke('settings:reset'),
  },
  data: {
    info: () => ipcRenderer.invoke('data:info'),
    open: (which) => ipcRenderer.invoke('data:open', which),
    change: () => ipcRenderer.invoke('data:change'),
    useDefault: () => ipcRenderer.invoke('data:useDefault'),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
  },
  rules: {
    resolve: (url) => ipcRenderer.invoke('rules:resolve', url),
    groups: (url) => ipcRenderer.invoke('rules:groups', url),
    suggestName: (url, baseId) => ipcRenderer.invoke('rules:suggestName', { url, baseId }),
    saveTaught: (payload) => ipcRenderer.invoke('rules:saveTaught', payload),
    saveSet: (set) => ipcRenderer.invoke('rules:saveSet', set),
    remove: (id) => ipcRenderer.invoke('rules:delete', id),
    setDefault: (id) => ipcRenderer.invoke('rules:setDefault', id),
    duplicate: (id) => ipcRenderer.invoke('rules:duplicate', id),
    removeBuiltin: (id) => ipcRenderer.invoke('rules:removeBuiltin', id),
    restoreBuiltin: (id) => ipcRenderer.invoke('rules:restoreBuiltin', id),
    recordHealth: (id, health) => ipcRenderer.invoke('rules:recordHealth', { id, health }),
    exportFile: (ids) => ipcRenderer.invoke('rules:export', ids),
    importFile: () => ipcRenderer.invoke('rules:import'),
  },
  library: {
    get: (limit) => ipcRenderer.invoke('library:get', limit),
    search: (query) => ipcRenderer.invoke('library:search', query),
    clear: () => ipcRenderer.invoke('library:clear'),
    lastFor: (url) => ipcRenderer.invoke('library:lastFor', url),
  },
  merge: {
    pickFiles: () => ipcRenderer.invoke('merge:pickFiles'),
    run: (payload) => ipcRenderer.invoke('merge:run', payload),
  },
  inject: {
    extractor: (url, options) => ipcRenderer.invoke('inject:extractor', url, options),
    teach: (options) => ipcRenderer.invoke('inject:teach', options),
    teachClose: () => ipcRenderer.invoke('inject:teachClose'),
  },
  help: {
    manual: () => ipcRenderer.invoke('help:manual'),
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
    const allowed = ['guest:navigated', 'session:cleared', 'help:open', 'help:whatsThis'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_event, ...args) => handler(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld('ace', api);
