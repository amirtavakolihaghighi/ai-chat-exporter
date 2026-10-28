/**
 * Where the desktop app keeps its files, and everything that writes them:
 * choosing the data folder, copying files in from the old location, saving
 * only the options that changed, resetting, moving the folder, and setting
 * aside a rules file that cannot be read. Pure Node — Electron's `app` is
 * stood in for, pointing every folder at a throwaway one.
 *
 * Running from the project would use <project>/data; that case is left to the
 * end-to-end suite's eyes, because testing it here would write into the
 * project's real data folder.
 *
 *   npm test
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

// Every folder made here is removed at the end; nothing outside them is touched.
const made = [];
const tmp = (name) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ace-${name}-`));
  made.push(dir);
  return dir;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
};

// Electron's `app`, as much of it as the modules use.
const app = {
  isPackaged: true,
  folders: {},
  getPath(name) {
    return this.folders[name];
  },
};
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app } };

/** A fresh start of the app: new folders, and modules that read them anew. */
function start({ packaged = true, portable = '', env = '' } = {}) {
  app.isPackaged = packaged;
  app.folders = { userData: tmp('profile'), documents: tmp('documents') };
  if (portable) process.env.PORTABLE_EXECUTABLE_DIR = portable;
  else delete process.env.PORTABLE_EXECUTABLE_DIR;
  if (env) process.env.ACE_DATA_DIR = env;
  else delete process.env.ACE_DATA_DIR;
  return reload();
}

function reload() {
  for (const name of ['../src/main/lib/paths', '../src/main/lib/store']) delete require.cache[require.resolve(name)];
  return { paths: require('../src/main/lib/paths'), store: require('../src/main/lib/store') };
}

(async () => {
  /* ------------------------------------------- the installed app, upgraded */

  let { paths, store } = start();
  const profile = app.folders.userData;
  const documents = app.folders.documents;
  // What 1.1.5 left behind: every option, the old default output folder, rules and a library.
  writeJson(path.join(profile, 'settings.json'), {
    outDir: path.join(documents, 'AI Chat Exports'), theme: 'dark', pageSize: 'A4', fontSize: 15,
  });
  writeJson(path.join(profile, 'site-rules.json'), {
    version: 2, sets: [{ id: 'u-old-1', name: 'Mine', hosts: ['chat.example.org'], parts: { user: ['.u'], assistant: ['.a'] } }], builtins: {},
  });
  writeJson(path.join(profile, 'library.json'), [{ id: 'old-1', at: '2026-01-01T00:00:00.000Z', title: 'An old export', messages: [] }]);

  check('installed: the data folder is in the profile folder, never the install folder',
    paths.dataDir() === path.join(profile, 'data') && paths.info().source === 'default', paths.dataDir());
  check('installed: exports stay in Documents, where people find them',
    paths.exportsDir() === path.join(documents, 'AI Chat Exports') && paths.info().folders.exports === paths.exportsDir());
  paths.ensureLayout();
  check('installed: settings, rules and library folders and a note are made, but no empty exports folder',
    ['settings', 'rules', 'library'].every((f) => fs.existsSync(path.join(profile, 'data', f))) &&
    !fs.existsSync(path.join(profile, 'data', 'exports')) && fs.existsSync(path.join(profile, 'data', 'README.txt')));

  const settings = store.getSettings();
  check('upgrade: the options someone changed are carried over', settings.theme === 'dark');
  check('upgrade: exports keep going where they went', settings.outDir === path.join(documents, 'AI Chat Exports'), settings.outDir);
  check('upgrade: the settings file holds only what was changed',
    JSON.stringify(readJson(paths.file('settings'))) === '{"theme":"dark"}', JSON.stringify(readJson(paths.file('settings'))));
  check('upgrade: rules and library are copied in', store.getSiteRules().sets[0]?.id === 'u-old-1' &&
    store.getLibrary().some((r) => r.id === 'old-1'));
  check('upgrade: the old files are copied, never moved or changed',
    readJson(path.join(profile, 'settings.json')).pageSize === 'A4' &&
    fs.existsSync(path.join(profile, 'site-rules.json')) && fs.existsSync(path.join(profile, 'library.json')));

  await store.saveSettings({ fontSize: 18, selection: [1, 2], quality: 90 });
  check('saving: only real options that differ from the defaults are written',
    JSON.stringify(readJson(paths.file('settings'))) === '{"theme":"dark","fontSize":18}', JSON.stringify(readJson(paths.file('settings'))));

  const after = await store.resetSettings();
  const backups = fs.readdirSync(path.dirname(paths.file('settings'))).filter((f) => f.startsWith('settings.before-reset-'));
  check('reset: every option is back to its default', after.theme === 'light' && after.fontSize === 15 &&
    JSON.stringify(readJson(paths.file('settings'))) === '{}');
  check('reset: the options as they were are kept beside it', backups.length === 1 &&
    readJson(path.join(path.dirname(paths.file('settings')), backups[0])).theme === 'dark', backups.join(', '));
  check('reset: rules and library are not touched', store.getSiteRules().sets.length === 1 && store.getLibrary().length === 1);

  // Moving the data folder.
  const moved = tmp('moved');
  const copied = await store.copyDataTo(moved);
  check('moving: settings, rules and library are copied to the new folder',
    copied.join() === 'settings,rules,library' && paths.filesIn(moved).join() === 'settings,rules,library', copied.join());
  check('moving: the old folder keeps its files', fs.existsSync(paths.file('rules')) && fs.existsSync(paths.file('library')));
  const occupied = tmp('occupied');
  writeJson(path.join(occupied, 'rules', 'site-rules.json'), { version: 3, sets: [], builtins: {}, mine: 'keep me' });
  const intoOccupied = await store.copyDataTo(occupied);
  check('moving: a file already in the new folder is never written over',
    !intoOccupied.includes('rules') && readJson(path.join(occupied, 'rules', 'site-rules.json')).mine === 'keep me', intoOccupied.join());

  // A rules file that cannot be read.
  fs.writeFileSync(paths.file('rules'), '{ this is not json', 'utf8');
  const fallback = store.getSiteRules();
  const aside = fs.readdirSync(path.dirname(paths.file('rules'))).filter((f) => f.startsWith('site-rules.json.unreadable-'));
  check('unreadable rules: read as none, and the file is set aside under another name, not deleted',
    fallback.sets.length === 0 && aside.length === 1 &&
    fs.readFileSync(path.join(path.dirname(paths.file('rules')), aside[0]), 'utf8') === '{ this is not json');

  /* ------------------------------------------------------ other places */

  const portable = tmp('portable');
  ({ paths } = start({ portable }));
  check('portable: the data folder sits beside the .exe, with exports in it',
    paths.dataDir() === path.join(portable, 'AI Chat Extractor data') && paths.exportsDir() === path.join(paths.dataDir(), 'exports'));

  ({ paths } = start());
  const chosen = tmp('chosen');
  paths.choose(chosen);
  ({ paths } = reload());
  check('chosen: a folder chosen in Options is used from the next start, exports included',
    paths.dataDir() === chosen && paths.info().source === 'chosen' && paths.exportsDir() === path.join(chosen, 'exports'));
  paths.choose(null);
  ({ paths } = reload());
  check('chosen: "Use the default" goes back', paths.dataDir() === path.join(app.folders.userData, 'data') &&
    readJson(path.join(app.folders.userData, 'data-location.json')).dir === null);

  ({ paths } = start());
  const blocker = path.join(tmp('blocked'), 'a-file');
  fs.writeFileSync(blocker, '');
  paths.choose(path.join(blocker, 'data'));
  ({ paths } = reload());
  check('chosen: a folder that cannot be written to is not used, and the reason is given',
    paths.dataDir() === path.join(app.folders.userData, 'data') && /cannot be written/.test(paths.info().problem), paths.info().problem);

  const forTests = tmp('env');
  ({ paths } = start({ packaged: false, env: forTests }));
  check('ACE_DATA_DIR: overrides everything, so tests never use real data',
    paths.dataDir() === path.resolve(forTests) && paths.info().source === 'env' && paths.exportsDir() === path.join(forTests, 'exports'));

  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.log(`FAIL  harness threw — ${err.stack || err}`);
  process.exit(1);
});
