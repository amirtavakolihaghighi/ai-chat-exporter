/**
 * Options and where they are kept: the defaults file, the split between the
 * defaults and what a person changed, and how the extension decides which copy
 * of its options and rules is newer when it shares a folder with the desktop
 * app. Pure Node.
 *
 *   npm test
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const settings = require('../src/shared/settings');
const rules = require('../src/shared/rules');
const folder = require('../extension/src/lib/folder');

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

/* -------------------------------------------------------- the defaults file */

const FILE = path.join(__dirname, '..', 'config', 'default-settings.json');
let file = null;
try {
  file = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (err) {
  check('defaults file: is valid JSON', false, err.message);
}
if (file) {
  check('defaults file: has a section for both apps and one for each', ['shared', 'desktop', 'extension'].every((k) => file[k]));
  for (const which of ['desktop', 'extension']) {
    const builtIn = { ...settings.BUILT_IN.shared, ...settings.BUILT_IN[which] };
    const listed = { ...file.shared, ...file[which] };
    const unknown = Object.keys(listed).filter((k) => !(k in builtIn));
    const missing = Object.keys(builtIn).filter((k) => !(k in listed));
    check(`defaults file: names only real ${which} options`, unknown.length === 0, unknown.join(', '));
    check(`defaults file: lists every ${which} option`, missing.length === 0, missing.join(', '));
    check(`defaults file: matches the built-in ${which} defaults`,
      JSON.stringify(settings.defaultsFor(which, file)) === JSON.stringify(settings.defaultsFor(which, null)));
  }
}

/* ------------------------------------------------------- defaults, changes */

const desktop = settings.defaultsFor('desktop', null);
check('defaults: each app gets the shared options and its own',
  desktop.pageSize === 'A4' && desktop.theme === 'light' && !('screenshotDelayMs' in desktop) &&
  settings.defaultsFor('extension', null).screenshotDelayMs === 550);
check('defaults: the defaults file can change one',
  settings.defaultsFor('desktop', { shared: { theme: 'dark' } }).theme === 'dark' &&
  settings.defaultsFor('extension', { shared: { theme: 'dark' } }).theme === 'dark');
check('defaults: an app section beats the shared one',
  settings.defaultsFor('desktop', { shared: { fontSize: 14 }, desktop: { fontSize: 18 } }).fontSize === 18);
check('defaults: a value of the wrong kind is ignored',
  settings.defaultsFor('desktop', { shared: { fontSize: 'big', redactions: 'none' } }).fontSize === 15 &&
  Array.isArray(settings.defaultsFor('desktop', { shared: { redactions: 'none' } }).redactions));
check('defaults: so is a name that is not an option', !('nonsense' in settings.defaultsFor('desktop', { shared: { nonsense: 1 } })));
check('defaults: a broken file falls back to the built-in ones',
  JSON.stringify(settings.defaultsFor('desktop', 'not json')) === JSON.stringify(desktop));
const a = settings.defaultsFor('desktop', null);
a.redactions.push({ find: 'x' });
check('defaults: each copy is its own', settings.defaultsFor('desktop', null).redactions.length === 0);

const mine = { ...desktop, theme: 'dark', fontSize: 15, selection: [1, 2], quality: 90 };
check('changes: only what differs from the defaults is kept',
  JSON.stringify(settings.changedFrom(mine, desktop)) === '{"theme":"dark"}', JSON.stringify(settings.changedFrom(mine, desktop)));
check('changes: lists compare by content', JSON.stringify(settings.changedFrom({ lastFormats: ['pdf'] }, desktop)) === '{}' &&
  settings.changedFrom({ lastFormats: ['md'] }, desktop).lastFormats[0] === 'md');
const back = settings.withDefaults({ theme: 'dark', fontSize: 'huge', junk: true }, desktop);
check('saved: laid over the defaults, leaving out what is not an option of the right kind',
  back.theme === 'dark' && back.fontSize === 15 && !('junk' in back));
check('saved: a default that changed reaches people who never changed that option',
  settings.withDefaults(settings.changedFrom(mine, desktop), { ...desktop, pageSize: 'Letter' }).pageSize === 'Letter');

/* ------------------------------------------------- keeping copies in step */

const t = (minutes) => new Date(Date.UTC(2026, 9, 28, 12, minutes)).toISOString();
check('sync: nothing in the folder yet — write it', folder.decide({ localAt: t(1), fileAt: null, syncedAt: null, fileExists: false }) === 'write');
check('sync: never compared — keep what is in both', folder.decide({ localAt: t(1), fileAt: t(2), syncedAt: null, fileExists: true }) === 'merge');
check('sync: only the folder changed — take it', folder.decide({ localAt: t(1), fileAt: t(5), syncedAt: t(1), fileExists: true }) === 'adopt');
check('sync: only the browser changed — write it', folder.decide({ localAt: t(5), fileAt: t(1), syncedAt: t(1), fileExists: true }) === 'write');
check('sync: both changed — keep what is in both', folder.decide({ localAt: t(5), fileAt: t(6), syncedAt: t(1), fileExists: true }) === 'merge');
check('sync: neither changed — nothing to do', folder.decide({ localAt: t(1), fileAt: t(1), syncedAt: t(1), fileExists: true }) === 'none');

const url = 'https://chatgpt.com/c/1';
const browser = rules.emptyStore();
const home = rules.saveTaught(browser, { url, baseId: 'chatgpt', parts: { user: ['.h-u'], assistant: ['.h-a'] }, name: 'Home' });
browser.savedAt = t(10);
const shared = rules.emptyStore();
const work = rules.saveTaught(shared, { url, baseId: 'chatgpt', parts: { user: ['.w-u'], assistant: ['.w-a'] }, name: 'Work' });
rules.saveTaught(shared, { url: 'https://claude.ai/chat/1', baseId: 'claude', parts: { user: ['.c-u'] }, name: 'Mine' });
rules.removeBuiltin(shared, 'kimi');
shared.savedAt = t(20);
const merged = rules.mergeStores(browser, shared);
check('merge: every rule set from both copies is kept', merged.sets.length === 3, merged.sets.map((x) => x.name).join(', '));
check('merge: the copy saved last decides which one a site uses',
  rules.resolve(url, merged).set?.id === work.id && merged.sets.find((x) => x.id === home.id).isDefault === false);
check('merge: choices about built-in rules are kept', merged.builtins.kimi?.removed === true);
const edited = JSON.parse(JSON.stringify(browser));
edited.sets[0].name = 'Home, renamed later';
edited.sets[0].updatedAt = new Date(Date.parse(browser.sets[0].updatedAt) + 60_000).toISOString();
edited.savedAt = t(5);
const both = rules.mergeStores(edited, { ...JSON.parse(JSON.stringify(browser)), savedAt: t(25) });
check('merge: a rule set changed in both keeps the later change', both.sets.length === 1 && both.sets[0].name === 'Home, renamed later',
  both.sets.map((x) => x.name).join(', '));
check('merge: says when it was saved', rules.normaliseStore({ ...rules.emptyStore(), savedAt: t(3) }).savedAt === t(3) &&
  !('savedAt' in rules.normaliseStore({ ...rules.emptyStore(), savedAt: 'yesterday' })));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
