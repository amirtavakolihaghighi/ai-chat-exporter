/**
 * Site-rule model tests. Pure Node, like the pipeline suite: which rule set
 * applies to a page, how the person's rules are validated and stored, how old
 * picker rules carry over, and what goes in and out of a rules file.
 *
 *   npm test
 */
'use strict';

const rules = require('../src/shared/rules');
const { PARTS, PART_KEYS, MESSAGE_PARTS, STATUS } = require('../src/shared/parts');
const { PROVIDERS, matchProvider } = require('../src/shared/providers');

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}
function throws(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err;
  }
}

/* --------------------------------------------------------------- parts */

check('parts: every part has a key, label, colour and help text',
  PARTS.every((p) => p.key && p.label && /^#[0-9a-f]{6}$/i.test(p.color) && p.help && p.pick));
check('parts: colours are all different', new Set(PARTS.map((p) => p.color)).size === PARTS.length);
check('parts: message parts are user, assistant and message',
  MESSAGE_PARTS.join(',') === 'user,assistant,message', MESSAGE_PARTS.join(','));
check('parts: status colours defined', ['ok', 'warn', 'broken', 'unknown', 'off'].every((k) => STATUS[k]?.color));

/* ----------------------------------------------------------- built-ins */

const builtins = rules.builtinSets();
check('built-in: one rule set per provider', builtins.length === PROVIDERS.length);
check('built-in: every set says where messages are',
  builtins.every((b) => MESSAGE_PARTS.some((k) => b.parts[k]?.length)),
  builtins.filter((b) => !MESSAGE_PARTS.some((k) => b.parts[k]?.length)).map((b) => b.id).join(','));
check('built-in: only known parts used',
  builtins.every((b) => Object.keys(b.parts).every((k) => PART_KEYS.includes(k))));
check('built-in: GapGPT keeps its exchange splitting',
  rules.builtinById('gapgpt')?.options?.exchangeAssistant === '[class*="markdown"]');
check('built-in: GapGPT marked verified', rules.builtinById('gapgpt')?.verified === true);
check('built-in: copies are independent of the definitions', (() => {
  const a = rules.builtinById('chatgpt');
  a.parts.user.push('x');
  return !rules.builtinById('chatgpt').parts.user.includes('x');
})());

/* ---------------------------------------------------------- resolution */

const empty = rules.emptyStore();
check('resolve: chatgpt uses the built-in rules',
  rules.resolve('https://chatgpt.com/c/123', empty).set?.id === 'chatgpt');
check('resolve: reports the source', rules.resolve('https://chatgpt.com/c/123', empty).source === 'builtin');
check('resolve: unknown site has no rules',
  rules.resolve('https://totally-unknown.example/chat', empty).set === null);
check('resolve: malformed url has no rules', rules.resolve('not a url', empty).source === 'none');
check('resolve: subdomain of a built-in host', rules.resolve('https://www.claude.ai/chat/1', empty).set?.id === 'claude');
check('resolve: longest host wins', rules.resolve('https://chat.mistral.ai/chat/1', empty).set?.id === 'mistral');

const own = rules.emptyStore();
const mine = rules.saveUserSet(own, {
  name: 'My ChatGPT',
  hosts: ['chatgpt.com'],
  parts: { user: ['article[data-turn="user"]'], assistant: ['article[data-turn="assistant"]'] },
});
check('resolve: a rule set of your own is not used just because it exists',
  rules.resolve('https://chatgpt.com/c/1', own).set?.id === 'chatgpt');
check('default: making it the default puts it in use', rules.setDefault(own, mine.id) &&
  rules.resolve('https://chatgpt.com/c/1', own).set?.id === mine.id);
check('resolve: your rules report source "user"', rules.resolve('https://chatgpt.com/c/1', own).source === 'user');
check('resolve: your rules match exact hosts only',
  rules.resolve('https://notchatgpt.com/c/1', own).set === null);
check('resolve: built-in hostnames are not matched as substrings either',
  rules.resolve('https://blog.company.com/', empty).set === null &&
  rules.resolve('https://notchatgpt.com/', empty).set === null);
check('resolve: built-in fragments still match self-hosted copies',
  rules.resolve('https://chat.librechat.example.org/c/1', empty).set?.id === 'openui-clone' &&
  rules.resolve('https://my-openwebui.lan/c/1', empty).set?.id === 'openui-clone');
check('resolve: your rules cover subdomains', rules.resolve('https://www.chatgpt.com/c/1', own).set?.id === mine.id);

rules.setEnabled(own, mine.id, false);
check('resolve: a rule turned off is skipped', rules.resolve('https://chatgpt.com/c/1', own).set?.id === 'chatgpt');
rules.setEnabled(own, mine.id, true);

const scoped = rules.saveUserSet(own, {
  name: 'Shared pages', hosts: ['chatgpt.com'], pathPrefix: 'share/',
  parts: { message: ['.shared-turn'] },
});
check('resolve: path prefix normalised', scoped.pathPrefix === '/share/', scoped.pathPrefix);
check('resolve: page-scoped rules win on their pages',
  rules.resolve('https://chatgpt.com/share/abc', own).set?.id === scoped.id);
check('resolve: page-scoped rules ignored elsewhere',
  rules.resolve('https://chatgpt.com/c/abc', own).set?.id === mine.id);

const quiet = rules.emptyStore();
rules.setEnabled(quiet, 'chatgpt', false);
check('resolve: built-in turned off is skipped', rules.resolve('https://chatgpt.com/c/1', quiet).set === null);
const removed = rules.emptyStore();
rules.removeBuiltin(removed, 'claude');
check('resolve: removed built-in is skipped', rules.resolve('https://claude.ai/chat/1', removed).set === null);
check('restore: brings a removed built-in back', rules.restoreBuiltin(removed, '*') === 1 &&
  rules.resolve('https://claude.ai/chat/1', removed).set?.id === 'claude');

check('appliesTo: a set covers its own site', rules.appliesTo(mine, 'https://chatgpt.com/c/1'));
check('appliesTo: not another site', !rules.appliesTo(mine, 'https://claude.ai/chat/1'));
check('appliesTo: respects the page scope', rules.appliesTo(scoped, 'https://chatgpt.com/share/x') &&
  !rules.appliesTo(scoped, 'https://chatgpt.com/c/x'));
check('appliesTo: whether or not it is turned on', (() => {
  rules.setEnabled(own, mine.id, false);
  const covered = rules.appliesTo(mine, 'https://chatgpt.com/c/1');
  rules.setEnabled(own, mine.id, true);
  return covered;
})());
check('findSet: finds your sets and built-ins by id',
  rules.findSet(own, mine.id)?.id === mine.id && rules.findSet(own, 'gemini')?.origin === 'builtin' &&
  rules.findSet(own, 'u-missing') === null);

/* ------------------------------------------------------------- compile */

const generic = rules.compile(rules.resolve('https://librechat.example.org/c/1', empty).set,
  'https://librechat.example.org/c/1');
check('compile: a category rule is named after the site', generic.name === 'librechat.example.org', generic.name);
check('compile: carries parts and options', Boolean(generic.parts.message?.length && generic.options.roleAttr));
const compiledMine = rules.compile(mine, 'https://chatgpt.com/c/1');
check('compile: own rules credit "custom" unless based on a built-in', compiledMine.providerId === 'custom');
check('compile: nothing for no rules', rules.compile(null, 'https://x.example') === null);

/* ---------------------------------------------------------- validation */

check('validate: needs a site', rules.cleanUserSet({ parts: { user: ['a'] } }).ok === false);
check('validate: needs a message part',
  rules.cleanUserSet({ hosts: ['x.example'], parts: { title: ['h1'] } }).ok === false);
const cleaned = rules.cleanUserSet({
  hosts: ['https://Chat.Example.com/some/page', 'bad host!', ''],
  parts: {
    user: ['.me', '.me', ' ', 'div { color: red }', 'x'.repeat(700)],
    assistant: '.them',
    unknownPart: ['.x'],
  },
  options: { roleAttr: 'data-role', roleMap: { human: 'user', evil: 'root' }, exchangeAssistant: 'a{}' },
  id: 'not-a-valid-id',
});
check('validate: host taken from a pasted url', cleaned.set?.hosts?.join(',') === 'chat.example.com',
  cleaned.set?.hosts?.join(','));
check('validate: duplicate, blank and brace-containing selectors dropped',
  cleaned.set?.parts?.user?.join('|') === '.me', cleaned.set?.parts?.user?.join('|'));
check('validate: a single selector string is accepted', cleaned.set?.parts?.assistant?.[0] === '.them');
check('validate: unknown parts dropped', !('unknownPart' in (cleaned.set?.parts || {})));
check('validate: options kept only when sane',
  cleaned.set?.options?.roleAttr === 'data-role' && cleaned.set?.options?.roleMap?.human === 'user' &&
  !('evil' in (cleaned.set?.options?.roleMap || {})) && !cleaned.set?.options?.exchangeAssistant);
check('validate: invalid id replaced', /^u-/.test(cleaned.set?.id || ''), cleaned.set?.id);

/* ----------------------------------------------------------- migration */

check('upgrade: rule sets saved before defaults existed stay in use', (() => {
  const before = rules.normaliseStore({
    version: 2,
    sets: [{ id: 'u-before-1', name: 'Mine', hosts: ['chatgpt.com'], parts: { user: ['.u'], assistant: ['.a'] } }],
    builtins: {},
  });
  return before.sets[0].isDefault === true && rules.resolve('https://chatgpt.com/c/1', before).set?.id === 'u-before-1';
})());
check('upgrade: a copy named like the built-in rules it copies is called "My …"', (() => {
  const before = rules.normaliseStore({
    version: 2,
    sets: [
      { name: 'ChatGPT', basedOn: 'chatgpt', hosts: ['chatgpt.com'], parts: { user: ['.u'], assistant: ['.a'] } },
      { name: 'Work', basedOn: 'chatgpt', hosts: ['chatgpt.com'], parts: { user: ['.u'], assistant: ['.a'] } },
    ],
    builtins: {},
  });
  return before.sets[0].name === 'My ChatGPT' && before.sets[1].name === 'Work';
})());
check('upgrade: a rule set that was turned off is not made the default', (() => {
  const before = rules.normaliseStore({
    version: 2,
    sets: [{ name: 'Off', enabled: false, hosts: ['chatgpt.com'], parts: { user: ['.u'] } }],
    builtins: {},
  });
  return before.sets[0].isDefault === false;
})());

const migrated = rules.migrateLegacyPacks({
  'chatgpt.com': { name: 'chatgpt.com', turnSelector: 'div.user-bubble', hosts: ['chatgpt.com'], updatedAt: '2026-10-01T10:00:00.000Z' },
  'odd.example': { turnSelector: '.msg' },
  'broken.example': { selector: 'nope' },
});
const legacyGpt = migrated.sets.find((s) => s.hosts[0] === 'chatgpt.com');
check('migrate: one set per old rule', migrated.sets.length === 2, String(migrated.sets.length));
check('migrate: old selector becomes the message part', legacyGpt?.parts?.message?.join('|') === 'div.user-bubble');
check('migrate: built-in parts carried over, as the old overlay did',
  legacyGpt?.parts?.thinking?.length > 0 && legacyGpt?.parts?.body?.length > 0);
check('migrate: still the one used for its site, as before', legacyGpt?.isDefault === true);
check('migrate: built-in speakers kept as markers',
  legacyGpt?.options?.userMarker === '[data-message-author-role="user"]' && legacyGpt?.options?.roleAttr);
check('migrate: built-in user/assistant parts not duplicated', !legacyGpt?.parts?.user && !legacyGpt?.parts?.assistant);
check('migrate: marked legacy, based on the built-in', legacyGpt?.legacy === true && legacyGpt?.basedOn === 'chatgpt');
check('migrate: dates kept', legacyGpt?.updatedAt === '2026-10-01T10:00:00.000Z');
const legacyStore = rules.normaliseStore({ version: 2, sets: migrated.sets, builtins: {} });
check('migrate: migrated rules resolve and win', rules.resolve('https://chatgpt.com/c/1', legacyStore).set?.legacy === true);

/* ------------------------------------------------------------- teaching */

const taughtStore = rules.emptyStore();
const fromBuiltin = rules.saveTaught(taughtStore, {
  url: 'https://chatgpt.com/c/42', baseId: 'chatgpt',
  parts: { user: ['article[data-turn="user"]'], assistant: ['article[data-turn="assistant"]'] },
});
check('teach: on a built-in site saves your own copy', fromBuiltin.origin === 'user' && fromBuiltin.basedOn === 'chatgpt');
check('teach: the copy is named as yours', fromBuiltin.name === 'My ChatGPT', fromBuiltin.name);
check('teach: and becomes the default for the site', fromBuiltin.isDefault === true &&
  rules.resolve('https://chatgpt.com/c/42', taughtStore).set?.id === fromBuiltin.id);
check('teach: the copy covers the built-in sites', fromBuiltin.hosts.includes('chat.openai.com'));
check('teach: the built-in itself is untouched', rules.builtinById('chatgpt').parts.user[0] === '[data-message-author-role="user"]');
const updated = rules.saveTaught(taughtStore, {
  url: 'https://chatgpt.com/c/42', baseId: fromBuiltin.id,
  parts: { user: ['.u'], assistant: ['.a'] },
});
check('teach: re-teaching your own rules updates them in place',
  updated.id === fromBuiltin.id && taughtStore.sets.length === 1 && updated.parts.user[0] === '.u');
const fresh = rules.saveTaught(taughtStore, {
  url: 'https://www.newchat.example/room/9', parts: { user: ['.q'], assistant: ['.a'] }, pathPrefix: '/room/',
});
check('teach: a new site gets a new rule set for that host',
  fresh.hosts.join(',') === 'www.newchat.example' && fresh.name === 'newchat.example' && fresh.pathPrefix === '/room/',
  `${fresh.hosts} ${fresh.name} ${fresh.pathPrefix}`);
check('teach: refuses rules with no messages',
  throws(() => rules.saveTaught(taughtStore, { url: 'https://a.example/', parts: { title: ['h1'] } })) !== null);

/* ------------------------------------------------------- rule profiles */

const prof = rules.emptyStore();
const gptUrl = 'https://chatgpt.com/c/7';
const parts = (tag) => ({ user: [`.${tag}-u`], assistant: [`.${tag}-a`] });
const home = rules.saveTaught(prof, { url: gptUrl, baseId: 'chatgpt', parts: parts('home'), name: 'Home layout' });
check('profiles: saving from teach mode makes it the default', rules.resolve(gptUrl, prof).set?.id === home.id);
const work = rules.saveTaught(prof, { url: gptUrl, baseId: home.id, parts: parts('work'), name: 'Work layout', asNew: true });
check('profiles: "save as new" keeps the one it started from',
  prof.sets.length === 2 && work.id !== home.id && prof.sets.find((x) => x.id === home.id).parts.user[0] === '.home-u');
check('profiles: the new one is the default now, the old one is not',
  rules.resolve(gptUrl, prof).set?.id === work.id && prof.sets.find((x) => x.id === home.id).isDefault === false);
check('profiles: switching back', rules.setDefault(prof, home.id) && rules.resolve(gptUrl, prof).set?.id === home.id);
rules.setDefault(prof, 'chatgpt');
check('profiles: back to the built-in rules, without deleting yours',
  rules.resolve(gptUrl, prof).set?.id === 'chatgpt' && prof.sets.length === 2);
const trial = rules.saveTaught(prof, { url: gptUrl, baseId: 'chatgpt', parts: parts('trial'), name: 'Home layout', makeDefault: false });
check('profiles: saving without making it the default leaves the default alone',
  rules.resolve(gptUrl, prof).set?.id === 'chatgpt' && trial.isDefault === false);
check('profiles: names stay unique for a site', trial.name === 'Home layout (2)', trial.name);
const homeAgain = rules.saveTaught(prof, { url: gptUrl, baseId: home.id, parts: parts('home2'), makeDefault: false });
check('profiles: saving changes keeps the same rule set', homeAgain.id === home.id && prof.sets.length === 3 &&
  homeAgain.parts.user[0] === '.home2-u');
rules.removeBuiltin(prof, 'chatgpt');
check('profiles: a removed built-in comes back when made the default',
  rules.setDefault(prof, 'chatgpt') && !prof.builtins.chatgpt.removed && rules.resolve(gptUrl, prof).set?.id === 'chatgpt');
const dup = rules.duplicateSet(prof, 'chatgpt');
check('profiles: a copy of the built-in rules is a new rule set of your own, not yet used',
  dup.origin === 'user' && dup.basedOn === 'chatgpt' && dup.isDefault === false && /copy/.test(dup.name), dup.name);
const shared = rules.saveTaught(prof, { url: 'https://chatgpt.com/share/1', parts: parts('share'), name: 'Shared', pathPrefix: '/share/', makeDefault: false });
check('profiles: rules for part of a site are used there even when not the default',
  rules.resolve('https://chatgpt.com/share/1', prof).set?.id === shared.id &&
  rules.resolve('https://chatgpt.com/c/1', prof).set?.id === 'chatgpt');

const groups = rules.siteGroups(prof, 'https://chatgpt.com/c/7');
const gptGroup = groups.find((g) => g.key === 'chatgpt');
check('groups: one per site, the built-in rules first', gptGroup?.sets?.[0]?.id === 'chatgpt' && gptGroup.sets.length === 6,
  gptGroup?.sets?.map((x) => x.name).join(' | '));
check('groups: says which one reads the site', gptGroup?.defaultId === 'chatgpt', gptGroup?.defaultId);
check('groups: knows the site is open', gptGroup?.onThisPage === true && groups.find((g) => g.key === 'claude')?.onThisPage === false);
rules.saveTaught(prof, { url: 'https://chat.example.org/room/1', parts: parts('ex'), name: 'Example chat' });
const exampleGroup = rules.siteGroups(prof, '').find((g) => g.key === 'site:chat.example.org');
check('groups: a site with no built-in rules gets a group of its own',
  exampleGroup?.sets?.length === 1 && exampleGroup.defaultId === exampleGroup.sets[0].id, JSON.stringify(exampleGroup?.key));
check('groups: a site whose only rules are removed is marked removed', (() => {
  const s2 = rules.emptyStore();
  rules.removeBuiltin(s2, 'kimi');
  return rules.siteGroups(s2, '').find((g) => g.key === 'kimi')?.removed === true;
})());
check('groups: a site with no built-in rules is named by its address', exampleGroup?.name === 'chat.example.org', exampleGroup?.name);

const choices = rules.siteSummary(gptUrl, prof).choices;
check('choices: the site card can switch between the built-in rules and each of yours for the whole site',
  choices.length === 5 && choices.filter((c) => c.isDefault).length === 1 && choices[0].origin === 'builtin' &&
  !choices.some((c) => c.id === shared.id), choices.map((c) => c.name).join(' | '));
check('choices: none for a site with no rules', rules.siteSummary('https://nowhere.example/x', prof).choices.length === 0);

const newFromBuiltin = rules.saveChoices(prof, gptUrl, 'chatgpt');
check('save choices: the built-in rules are never changed — a new set, with a free name, used from now on',
  !newFromBuiltin.canUpdate && newFromBuiltin.makeDefault && !rules.siteGroups(prof, gptUrl).find((g) => g.key === 'chatgpt').sets
    .some((x) => x.name === newFromBuiltin.suggestedName), JSON.stringify(newFromBuiltin));
rules.setDefault(prof, home.id);
const ofDefault = rules.saveChoices(prof, gptUrl, home.id);
check('save choices: your set in use can be changed in place, and stays in use',
  ofDefault.canUpdate && ofDefault.currentName === 'Home layout' && ofDefault.makeDefault, JSON.stringify(ofDefault));
check('save choices: one of yours not in use is changed without being put in use',
  rules.saveChoices(prof, gptUrl, work.id).makeDefault === false);

/* ------------------------------------------------------------- changes */

const changes = rules.emptyStore();
const copy = rules.copyBuiltin(changes, 'claude');
check('copy: makes an editable copy of a built-in', copy.basedOn === 'claude' && copy.parts.user.length === 2);
check('copy: only real hostnames, not fragments', copy.hosts.every((h) => h.includes('.')));
check('copy: a copy is not used until it is made the default',
  rules.resolve('https://claude.ai/chat/1', changes).set?.id === 'claude' &&
  !rules.managerView(changes).builtins.find((b) => b.id === 'claude').overriddenBy);
rules.setDefault(changes, copy.id);
check('manager: built-in shows when your default is used instead',
  rules.managerView(changes).builtins.find((b) => b.id === 'claude').overriddenBy === copy.id);
check('delete: removes your rule set', rules.deleteUserSet(changes, copy.id) && changes.sets.length === 0);
check('delete: unknown id is a no-op', rules.deleteUserSet(changes, 'u-nothing') === false);
check('enable: unknown id refused', rules.setEnabled(changes, 'nope', false) === false);
check('remove: only built-ins can be removed', rules.removeBuiltin(changes, 'u-whatever') === false);

const health = {
  status: 'warn', at: '2026-10-27T09:00:00.000Z', url: 'https://chatgpt.com/c/1',
  counts: { user: 6, assistant: 0, total: 6, 'bad key!': 3, nan: 'x' },
  parts: { user: 6, thinking: 2, '<script>': 1 },
  found: { user: 6, message: 6 },
  problems: [{ code: 'part-empty', severity: 'warn', part: 'assistant' }, { code: 'BAD CODE' }],
};
check('health: recorded on a built-in', rules.recordHealth(changes, 'chatgpt', health) &&
  changes.builtins.chatgpt.health.status === 'warn');
check('health: cleaned', (() => {
  const h = changes.builtins.chatgpt.health;
  return h.counts.user === 6 && !('bad key!' in h.counts) && !('nan' in h.counts) &&
    h.problems.length === 1 && h.problems[0].part === 'assistant';
})());
check('health: per-part counts kept for the coloured chips', (() => {
  const h = changes.builtins.chatgpt.health;
  return h.parts.thinking === 2 && !('<script>' in h.parts) && h.found.message === 6;
})());
check('health: nonsense refused', rules.recordHealth(changes, 'chatgpt', { status: 'fine' }) === false);

/* --------------------------------------------------------- site summary */

const summaryStore = rules.emptyStore();
check('summary: built-in rules with their name', (() => {
  const s = rules.siteSummary('https://claude.ai/chat/1', summaryStore);
  return s.set?.id === 'claude' && s.source === 'builtin' && s.name === 'Claude' && s.set.health === null;
})());
rules.recordHealth(summaryStore, 'claude', { status: 'ok', counts: { total: 4 } });
check('summary: carries the last health of a built-in', rules.siteSummary('https://claude.ai/chat/1', summaryStore).set?.health?.status === 'ok');
rules.setEnabled(summaryStore, 'claude', false);
const offSummary = rules.siteSummary('https://claude.ai/chat/1', summaryStore);
check('summary: says when the rules are switched off', offSummary.set === null && offSummary.off?.id === 'claude' && !offSummary.off.removed,
  JSON.stringify(offSummary));
check('summary: a site with no rules at all', rules.siteSummary('https://nothing.example/', summaryStore).off === null);
const marked = rules.managerView(summaryStore, 'https://claude.ai/chat/1');
check('manager: marks the sets that cover the open page',
  marked.builtins.find((b) => b.id === 'claude').onThisPage === true && marked.builtins.find((b) => b.id === 'gemini').onThisPage === false);

/* --------------------------------------------------------- import/export */

const source = rules.emptyStore();
const a = rules.saveUserSet(source, { name: 'A', hosts: ['a.example'], parts: { user: ['.u'], assistant: ['.a'] } });
rules.recordHealth(source, a.id, health);
const file = rules.exportSets(source, []);
check('export: file is marked', file.format === rules.FILE_FORMAT && file.sets.length === 1);
check('export: health and ids stay behind', !('health' in file.sets[0]) && !('id' in file.sets[0]));
const withBuiltin = rules.exportSets(source, ['chatgpt']);
check('export: a built-in can be exported as a starting point',
  withBuiltin.sets.length === 1 && withBuiltin.sets[0].basedOn === 'chatgpt');

const target = rules.emptyStore();
const first = rules.importSets(target, JSON.parse(JSON.stringify(file)));
check('import: adds the sets', first.added === 1 && target.sets.length === 1);
const second = rules.importSets(target, file);
check('import: identical rules skipped', second.added === 0 && second.skipped === 1);
const mixed = rules.importSets(target, { format: rules.FILE_FORMAT, sets: [{ name: 'no host', parts: { user: ['.x'] } }, null] });
check('import: invalid entries counted, not added', mixed.invalid === 2 && target.sets.length === 1);
const legacyImport = rules.importSets(rules.emptyStore(), { 'old.example': { turnSelector: '.m' } });
check('import: old user-packs.json accepted', legacyImport.added === 1);
check('import: anything else refused', throws(() => rules.importSets(rules.emptyStore(), { hello: 'world' })) !== null);
check('import: a rule set exported as its site\'s default arrives as the default', (() => {
  const from = rules.emptyStore();
  const chosen = rules.saveTaught(from, { url: 'https://claude.ai/chat/1', baseId: 'claude', parts: parts('c') });
  const into = rules.emptyStore();
  rules.importSets(into, rules.exportSets(from, [chosen.id]));
  return into.sets[0]?.isDefault === true && rules.resolve('https://claude.ai/chat/1', into).set?.id === into.sets[0].id;
})());
check('import: arrays refused', throws(() => rules.importSets(rules.emptyStore(), [1, 2])) !== null);

/* ---------------------------------------------------------- persistence */

const persisted = rules.normaliseStore({
  version: 2,
  sets: [a, a, { hosts: ['x.example'] }],
  builtins: { chatgpt: { enabled: false }, madeup: { enabled: false } },
});
check('store: invalid sets dropped on load', persisted.sets.length === 2, String(persisted.sets.length));
check('store: duplicate ids repaired', persisted.sets[0].id !== persisted.sets[1].id);
check('store: unknown built-in ids ignored', !('madeup' in persisted.builtins) && persisted.builtins.chatgpt.enabled === false);
check('store: garbage gives an empty store', rules.normaliseStore('garbage').sets.length === 0);

/* -------------------------------------------- the providers module itself */

check('providers: matchProvider still works', matchProvider('https://gapgpt.app/c/1')?.id === 'gapgpt');
check('providers: unknown site', matchProvider('https://nothing.example/') === null);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
