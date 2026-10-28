'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Where the app keeps what it writes: one data folder, with a folder inside it
 * for each kind of file —
 *
 *   settings/   settings.json: the options the person changed, and only those
 *   rules/      site-rules.json: their site rules, shared with the extension
 *   library/    library.json: everything ever exported, for search and merging
 *   exports/    exported chats, unless "Save to" points somewhere else — and
 *               except in the installed app (see exportsDir)
 *
 * The data folder is, in order:
 *   1. ACE_DATA_DIR, when set — the tests use it to stay away from real data;
 *   2. the folder chosen in Options, remembered in data-location.json in
 *      Electron's profile folder (the one place known before any other);
 *   3. by default:
 *      - running from the project (npm start):  <project>/data
 *      - the portable build:   "AI Chat Extractor data" beside the .exe
 *      - the installed build:  <profile>/data — never the install folder,
 *        which every update replaces.
 *
 * Not here: the embedded browser's own profile — sign-ins, cookies, cache.
 * Chromium keeps it in Electron's profile folder (%APPDATA%\AI Chat Extractor)
 * and locks it while the app runs. It holds live sign-ins, which should never
 * sit in a project folder that may be shared, zipped or committed, and its
 * cache grows to hundreds of megabytes.
 */

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const POINTER_FILE = 'data-location.json';

const FOLDERS = ['settings', 'rules', 'library', 'exports'];
const FILES = {
  settings: ['settings', 'settings.json'],
  rules: ['rules', 'site-rules.json'],
  library: ['library', 'library.json'],
};

const README = `AI Chat Extractor — your files

settings\\   your changes to the app's options. settings.json holds only the
            options you changed; the defaults come with the app.
rules\\      your site rules (site-rules.json): which parts of each chat site
            are messages. The browser extension can share this file.
library\\    the list of everything you exported, with its text, for search
            and for merging chats.
exports\\    exported chats, unless you chose another folder under "Save to".
            (The installed app saves them in Documents\\AI Chat Exports.)

Back up this folder to keep everything. To move it, use the app's Options tab,
"Where your files are kept" — the app copies your files to the new place.

Not here: sign-ins to chat sites and the built-in browser's cache. They stay
in Windows' app-data folder (%APPDATA%\\AI Chat Extractor), where the browser
locks them while the app runs, away from files you might share.
`;

function defaultDir() {
  if (!app.isPackaged) return path.join(PROJECT_ROOT, 'data');
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portable) return path.join(portable, 'AI Chat Extractor data');
  return path.join(app.getPath('userData'), 'data');
}

function pointerFile() {
  return path.join(app.getPath('userData'), POINTER_FILE);
}

function chosenDir() {
  try {
    const { dir } = JSON.parse(fs.readFileSync(pointerFile(), 'utf8'));
    return typeof dir === 'string' && path.isAbsolute(dir) ? dir : null;
  } catch {
    return null;
  }
}

/** Whether files can be written in `dir`, creating it if needed. */
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

let current = null;

/** The data folder and how it was decided: 'env', 'chosen', 'default' or 'fallback'. */
function where() {
  if (current) return current;
  if (process.env.ACE_DATA_DIR) {
    current = { dir: path.resolve(process.env.ACE_DATA_DIR), source: 'env', problem: '' };
    return current;
  }
  const chosen = chosenDir();
  if (chosen && writable(chosen)) {
    current = { dir: chosen, source: 'chosen', problem: '' };
    return current;
  }
  const problem = chosen ? `The folder you chose, ${chosen}, cannot be written to right now.` : '';
  const dir = defaultDir();
  if (writable(dir)) {
    current = { dir, source: 'default', problem };
    return current;
  }
  // A project or portable folder the app may not write to, such as a read-only drive.
  current = {
    dir: path.join(app.getPath('userData'), 'data'),
    source: 'fallback',
    problem: problem || `${dir} cannot be written to, so your files are kept in the app's own folder instead.`,
  };
  return current;
}

function dataDir() {
  return where().dir;
}

function folder(name) {
  return path.join(dataDir(), name);
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Where exports go unless "Save to" says otherwise: the exports folder in the
 * data folder — except when the data folder is inside Electron's hidden
 * profile folder, as in the installed app, where nobody would find them. There
 * they go to Documents, as they always have.
 */
function exportsDir() {
  return inside(dataDir(), app.getPath('userData'))
    ? path.join(app.getPath('documents'), 'AI Chat Exports')
    : folder('exports');
}

function file(name) {
  return path.join(dataDir(), ...FILES[name]);
}

/** Creates the folders, and a note saying what each is for, if they are not there yet. */
function ensureLayout() {
  try {
    for (const name of FOLDERS) {
      if (name !== 'exports' || exportsDir() === folder('exports')) fs.mkdirSync(folder(name), { recursive: true });
    }
    const readme = path.join(dataDir(), 'README.txt');
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, README.replace(/\n/g, os.EOL), 'utf8');
  } catch {
    /* every write creates its folder anyway */
  }
}

/** Which of the app's files are already in `dir`, by folder name. */
function filesIn(dir) {
  return Object.entries(FILES)
    .filter(([, parts]) => fs.existsSync(path.join(dir, ...parts)))
    .map(([name]) => name);
}

/** Everything the Options tab shows. */
function info() {
  const { dir, source, problem } = where();
  return {
    dir,
    source,
    problem,
    defaultDir: defaultDir(),
    folders: Object.fromEntries(FOLDERS.map((name) => [name, name === 'exports' ? exportsDir() : folder(name)])),
    browserProfile: app.getPath('userData'),
  };
}

/** Remembers the data folder to use from the next start; `null` means the default. */
function choose(dir) {
  fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
  fs.writeFileSync(pointerFile(), JSON.stringify({ dir: dir || null }, null, 2), 'utf8');
}

module.exports = {
  FILES,
  FOLDERS,
  defaultDir,
  dataDir,
  folder,
  exportsDir,
  file,
  filesIn,
  ensureLayout,
  info,
  choose,
};
