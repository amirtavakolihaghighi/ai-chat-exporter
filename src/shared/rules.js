'use strict';

/**
 * Site rules: which parts of a chat page are messages, and how to read them.
 *
 * A rule set belongs to one site (one or more hostnames, optionally narrowed to
 * pages under a path) and names, per part, the CSS selectors that find it — see
 * src/shared/parts.js for the parts. Built-in rule sets ship with the app (in
 * src/shared/providers.js); the person using the app teaches the rest by
 * pointing at the page, or imports them from a file.
 *
 * Everything here is plain data in, plain data out, so both apps share it and
 * it can be tested without a browser. The desktop app keeps the store in
 * `site-rules.json`; the extension keeps it in extension storage.
 *
 * A site can have several rule sets — the built-in one, and any number of
 * the person's own — and one of them is the site's *default*: the one used to
 * read it. Making another one the default, or going back to the built-in rules,
 * never deletes anything.
 *
 * Two rules matter more than the rest:
 *
 *  - A rule set is self-contained. The old single-selector picker laid its rule
 *    over the built-in one field by field, so a hand-made rule quietly
 *    inherited built-in settings that might not fit it. Nothing is merged now:
 *    editing a built-in rule set makes a complete copy, and that copy is what
 *    runs, visibly.
 *  - Data that is not understood is dropped, never trusted. Rules can arrive in
 *    a shared file, and a selector is the only thing in them that ever reaches
 *    a page.
 */

const { PART_KEYS, MESSAGE_PARTS } = require('./parts');
const { PROVIDERS, hostMatchLength } = require('./providers');

// 3: the person's rule sets say which one is the default for their site.
const STORE_VERSION = 3;
const FILE_FORMAT = 'ai-chat-extractor/site-rules';

const LIMITS = {
  selectorLength: 600,
  selectorsPerPart: 24,
  nameLength: 80,
  hosts: 20,
  sets: 500,
  problems: 12,
};

const now = () => new Date().toISOString();
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/* ---------------------------------------------------------------- cleaning */

/** A bare lowercase hostname, from a hostname or a URL; '' if it is neither. */
function cleanHost(value) {
  let host = String(value || '').trim().toLowerCase();
  if (!host) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(host)) {
    try {
      host = new URL(host).hostname;
    } catch {
      return '';
    }
  }
  host = host.replace(/^\*\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) && /[a-z0-9]/.test(host) ? host : '';
}

/** '' for the whole site, otherwise a path starting with a slash. */
function cleanPathPrefix(value) {
  let prefix = String(value || '').trim();
  if (!prefix || prefix === '/') return '';
  if (!prefix.startsWith('/')) prefix = '/' + prefix;
  return prefix.replace(/[?#].*$/, '').slice(0, 200);
}

/** A selector is never longer than a line and never contains braces. */
function cleanSelector(value) {
  const selector = String(value || '').trim();
  if (!selector || selector.length > LIMITS.selectorLength) return '';
  if (/[{}\n\r]/.test(selector)) return '';
  return selector;
}

function cleanSelectors(list) {
  const items = Array.isArray(list) ? list : typeof list === 'string' ? [list] : [];
  const out = [];
  for (const item of items) {
    const selector = cleanSelector(item);
    if (selector && !out.includes(selector)) out.push(selector);
    if (out.length >= LIMITS.selectorsPerPart) break;
  }
  return out;
}

function cleanParts(parts) {
  const out = {};
  for (const key of PART_KEYS) {
    const list = cleanSelectors(parts && parts[key]);
    if (list.length) out[key] = list;
  }
  return out;
}

function cleanOptions(options) {
  const out = {};
  if (!options || typeof options !== 'object') return out;
  for (const key of ['roleAttr', 'userMarker', 'assistantMarker', 'exchangeAssistant']) {
    const value = cleanSelector(options[key]);
    if (value) out[key] = value;
  }
  if (out.roleAttr && !/^[a-z][a-z0-9_.:-]*$/i.test(out.roleAttr)) delete out.roleAttr;
  if (options.roleMap && typeof options.roleMap === 'object') {
    const map = {};
    for (const [raw, role] of Object.entries(options.roleMap)) {
      if (/^(user|assistant|system|tool)$/.test(String(role))) map[String(raw).slice(0, 40)] = role;
    }
    if (Object.keys(map).length) out.roleMap = map;
  }
  return out;
}

const STATUSES = ['ok', 'warn', 'broken'];

/** A map of small names to whole numbers; anything else is dropped. */
function cleanCounts(raw) {
  const counts = {};
  for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (/^[a-z]{1,16}$/.test(key) && Number.isFinite(value)) counts[key] = Math.max(0, Math.round(value));
  }
  return counts;
}

/**
 * What the last read with a rule set found, as recorded by the apps:
 * `counts` by speaker, `parts` by the part that found them, `found` by what
 * each part's selectors matched at all.
 */
function cleanHealth(health) {
  if (!health || typeof health !== 'object' || !STATUSES.includes(health.status)) return null;
  const counts = cleanCounts(health.counts);
  const problems = (Array.isArray(health.problems) ? health.problems : [])
    .filter((p) => p && /^[a-z-]{2,40}$/.test(String(p.code)))
    .slice(0, LIMITS.problems)
    .map((p) => ({
      code: p.code,
      severity: p.severity === 'error' ? 'error' : 'warn',
      ...(p.part && PART_KEYS.includes(p.part) ? { part: p.part } : {}),
    }));
  return {
    status: health.status,
    at: validDate(health.at) || now(),
    url: typeof health.url === 'string' ? health.url.slice(0, 300) : '',
    counts,
    parts: cleanCounts(health.parts),
    found: cleanCounts(health.found),
    problems,
  };
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function hasMessageParts(parts) {
  return MESSAGE_PARTS.some((key) => Array.isArray(parts[key]) && parts[key].length > 0);
}

function newId() {
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validates and normalises one of the person's own rule sets.
 *
 * @returns {{ok: true, set: object} | {ok: false, error: string}}
 */
function cleanUserSet(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not a rule set' };
  const rawHosts = Array.isArray(raw.hosts) ? raw.hosts : [raw.host];
  const hosts = [...new Set(rawHosts.map(cleanHost).filter(Boolean))].slice(0, LIMITS.hosts);
  if (!hosts.length) return { ok: false, error: 'it does not say which site it is for' };
  const parts = cleanParts(raw.parts);
  if (!hasMessageParts(parts)) return { ok: false, error: 'it does not say where the messages are' };

  const set = {
    id: typeof raw.id === 'string' && /^u-[a-z0-9-]{4,40}$/.test(raw.id) ? raw.id : newId(),
    origin: 'user',
    name: String(raw.name || '').trim().slice(0, LIMITS.nameLength) || hosts[0],
    hosts,
    pathPrefix: cleanPathPrefix(raw.pathPrefix),
    enabled: raw.enabled !== false,
    isDefault: raw.isDefault === true,
    parts,
    options: cleanOptions(raw.options),
    basedOn: PROVIDERS.some((p) => p.id === raw.basedOn) ? raw.basedOn : null,
    createdAt: validDate(raw.createdAt) || now(),
    updatedAt: validDate(raw.updatedAt) || now(),
    health: cleanHealth(raw.health),
  };
  if (raw.legacy === true) set.legacy = true;
  if (validDate(raw.importedAt)) set.importedAt = raw.importedAt;
  return { ok: true, set };
}

/* --------------------------------------------------------------- built-ins */

/** The built-in rule sets, in the same shape as the person's own. */
function builtinSets() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    origin: 'builtin',
    name: p.name,
    hosts: p.hosts.slice(),
    pathPrefix: '',
    parts: clone(p.parts),
    options: clone(p.options || {}),
    verified: Boolean(p.verified),
    genericName: Boolean(p.genericName),
  }));
}

function builtinById(id) {
  return builtinSets().find((b) => b.id === id) || null;
}

/* ------------------------------------------------------------------- store */

function emptyStore() {
  return { version: STORE_VERSION, sets: [], builtins: {} };
}

/**
 * A rule set saved before sets could be a site's default. Then any of the
 * person's own beat the built-in ones, so it is marked default to keep doing
 * exactly that. Copies of built-in rules kept the built-in name then; beside
 * the built-in rules in one list, "My …" tells them apart.
 */
function fromVersion2(item) {
  const builtin = item.basedOn ? builtinById(item.basedOn) : null;
  const name = builtin && item.name === builtin.name ? `My ${builtin.name}` : item.name;
  return { ...item, name, isDefault: item.enabled !== false };
}

/** Reads whatever was persisted, keeping only what is valid. */
function normaliseStore(raw) {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') return store;
  const ids = new Set();
  const before3 = !(Number(raw.version) >= 3);
  for (const item of Array.isArray(raw.sets) ? raw.sets.slice(0, LIMITS.sets) : []) {
    const upgraded = before3 && item && item.isDefault === undefined ? fromVersion2(item) : item;
    const result = cleanUserSet(upgraded);
    if (!result.ok) continue;
    if (ids.has(result.set.id)) result.set.id = newId();
    ids.add(result.set.id);
    store.sets.push(result.set);
  }
  const known = new Set(PROVIDERS.map((p) => p.id));
  for (const [id, state] of Object.entries(raw.builtins || {})) {
    if (!known.has(id) || !state || typeof state !== 'object') continue;
    store.builtins[id] = {
      enabled: state.enabled !== false,
      removed: state.removed === true,
      health: cleanHealth(state.health),
    };
  }
  // When it was last saved, so two copies — the desktop app's file and the
  // extension's — can tell which is newer.
  if (typeof raw.savedAt === 'string' && !Number.isNaN(Date.parse(raw.savedAt))) store.savedAt = raw.savedAt;
  return store;
}

/**
 * Two copies of the rules that changed apart — the extension's, and the file
 * in a folder it shares with the desktop app. Keeps everything from both: every
 * rule set, the later version of one changed in both, and the site defaults
 * and built-in choices of the copy saved last. Nothing is lost, at the price
 * that a rule set deleted in one copy while the other changed comes back.
 */
function mergeStores(a, b) {
  const first = normaliseStore(a);
  const second = normaliseStore(b);
  const savedAt = (store) => Date.parse(store.savedAt || '') || 0;
  const [older, newer] = savedAt(first) <= savedAt(second) ? [first, second] : [second, first];
  const out = newer;
  for (const set of older.sets) {
    const i = out.sets.findIndex((s) => s.id === set.id);
    if (i >= 0) {
      const later = (Date.parse(set.updatedAt) || 0) > (Date.parse(out.sets[i].updatedAt) || 0);
      if (later) out.sets[i] = { ...clone(set), isDefault: out.sets[i].isDefault };
      continue;
    }
    const taken = out.sets.some((s) => s.isDefault && (s.pathPrefix || '') === (set.pathPrefix || '') && sameSite(s, set));
    out.sets.push({ ...clone(set), isDefault: set.isDefault && !taken });
  }
  for (const [id, state] of Object.entries(older.builtins)) {
    if (!out.builtins[id]) out.builtins[id] = clone(state);
  }
  return out;
}

/**
 * Converts rules saved by the old one-click picker.
 *
 * Those were a single selector per host for "all messages", laid over the
 * built-in rules field by field. This reproduces exactly what they did, but as
 * one visible rule set: the built-in parts are copied in, the old selector
 * becomes the message part, and the built-in speaker markers are kept so roles
 * come out as before. Marked `legacy` so the manager can suggest re-teaching.
 */
function migrateLegacyPacks(legacy) {
  const store = emptyStore();
  if (!legacy || typeof legacy !== 'object') return store;
  for (const [key, pack] of Object.entries(legacy)) {
    if (!pack || typeof pack.turnSelector !== 'string') continue;
    const host = cleanHost(pack.host || key);
    if (!host) continue;
    const builtin = resolveBuiltin(host);
    const parts = { ...(builtin ? clone(builtin.parts) : {}) };
    const options = { ...(builtin ? clone(builtin.options) : {}) };
    if (builtin) {
      if (parts.user && !options.userMarker) options.userMarker = parts.user.join(', ');
      if (parts.assistant && !options.assistantMarker) options.assistantMarker = parts.assistant.join(', ');
    }
    delete parts.user;
    delete parts.assistant;
    parts.message = [pack.turnSelector];
    const result = cleanUserSet({
      name: pack.name || host,
      hosts: [host],
      parts,
      options,
      basedOn: builtin ? builtin.id : null,
      createdAt: pack.updatedAt,
      updatedAt: pack.updatedAt,
      legacy: true,
      // The old picker's rule was always used for its site; it still is.
      isDefault: true,
    });
    if (result.ok) store.sets.push(result.set);
  }
  return store;
}

function resolveBuiltin(host) {
  let best = null;
  let bestLen = -1;
  for (const set of builtinSets()) {
    const len = hostMatchLength(set.hosts, host);
    if (len > bestLen) {
      best = set;
      bestLen = len;
    }
  }
  return best;
}

/* -------------------------------------------------------------- resolution */

function parseUrl(url) {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname.toLowerCase(), path: parsed.pathname || '/' };
  } catch {
    return null;
  }
}

/**
 * The rule set that applies to `url`, or null when the site has none.
 *
 * Rules limited to part of a site win on those pages. Otherwise the site's
 * default wins: one of the person's own rule sets if they made one the
 * default, or else the built-in one, or else their most recent. A rule set
 * that is turned off, or a built-in one that has been removed, is skipped as if
 * it did not exist.
 */
function resolve(url, store) {
  const where = parseUrl(url);
  if (!where || !where.host) return { set: null, source: 'none' };
  const data = store || emptyStore();

  let best = null;
  let bestScore = null;
  const consider = (set, score) => {
    if (!best || compareScores(score, bestScore) > 0) {
      best = set;
      bestScore = score;
    }
  };

  for (const set of data.sets) {
    if (!set.enabled) continue;
    // The person's own rules name exact sites, so match them exactly: a rule
    // for "chat.example" must not also fire on "notchat.example".
    const hostLen = hostMatchLength(set.hosts, where.host, { loose: false });
    if (hostLen < 0) continue;
    if (set.pathPrefix && !where.path.startsWith(set.pathPrefix)) continue;
    consider(set, [set.pathPrefix.length, set.isDefault ? 2 : 0, hostLen, Date.parse(set.updatedAt) || 0]);
  }
  for (const set of builtinSets()) {
    const state = data.builtins[set.id] || {};
    if (state.removed || state.enabled === false) continue;
    const hostLen = hostMatchLength(set.hosts, where.host);
    if (hostLen < 0) continue;
    consider(set, [0, 1, hostLen, 0]);
  }
  return best ? { set: clone(best), source: best.origin } : { set: null, source: 'none' };
}

/** Whether two rule sets are for the same site: they share a hostname. */
function sameSite(a, b) {
  const looseA = a.origin === 'builtin';
  const looseB = b.origin === 'builtin';
  return (
    a.hosts.some((host) => hostMatchLength(b.hosts, host, { loose: looseB }) >= 0) ||
    b.hosts.some((host) => hostMatchLength(a.hosts, host, { loose: looseA }) >= 0)
  );
}

/**
 * Whether a rule set covers `url` — regardless of whether it is turned on, or
 * whether another set would win there. The manager uses it to offer "show on
 * this page" only where that makes sense.
 */
function appliesTo(set, url) {
  const where = parseUrl(url);
  if (!set || !where || !where.host) return false;
  const loose = set.origin === 'builtin';
  if (hostMatchLength(set.hosts, where.host, { loose }) < 0) return false;
  return !set.pathPrefix || where.path.startsWith(set.pathPrefix);
}

/** A rule set by id, built-in or the person's own, whatever its state. */
function findSet(store, id) {
  return (store && store.sets.find((s) => s.id === id)) || builtinById(id);
}

function compareScores(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

/** The name an export credits the AI with when this rule set read it. */
function displayName(set, url) {
  if (!set) return '';
  if (set.genericName) return (parseUrl(url) || {}).host || set.name;
  return set.name;
}

/** What the extractor needs from a rule set, and nothing else. */
function compile(set, url) {
  if (!set) return null;
  return {
    id: set.id,
    origin: set.origin,
    name: displayName(set, url),
    providerId: set.origin === 'builtin' ? set.id : set.basedOn || 'custom',
    parts: clone(set.parts),
    options: clone(set.options || {}),
  };
}

/* ---------------------------------------------------------------- changes */

function findUserSet(store, id) {
  return store.sets.find((s) => s.id === id) || null;
}

/** Creates or updates one of the person's rule sets. Returns the saved set. */
function saveUserSet(store, raw) {
  const existing = raw && raw.id ? findUserSet(store, raw.id) : null;
  const result = cleanUserSet({
    ...(existing || {}),
    ...raw,
    createdAt: existing ? existing.createdAt : raw.createdAt,
    updatedAt: now(),
  });
  if (!result.ok) throw new Error(`These rules cannot be saved: ${result.error}.`);
  if (existing) {
    // Re-teaching replaces what the old picker produced, so it is no longer legacy.
    if (raw.legacy !== true) delete result.set.legacy;
    store.sets[store.sets.indexOf(existing)] = result.set;
  } else {
    store.sets.push(result.set);
  }
  return result.set;
}

/**
 * Saves what the teach overlay produced for the site at `url`.
 *
 * Teaching on top of a built-in rule set never edits the built-in one: it saves
 * a complete copy, which then takes precedence, and the built-in stays
 * available to go back to.
 */
function saveTaught(store, { url, baseId, parts, options, pathPrefix, name, asNew = false, makeDefault = true }) {
  const where = parseUrl(url);
  const base = baseId ? findUserSet(store, baseId) : null;
  let saved;
  if (base && !asNew) {
    saved = saveUserSet(store, {
      ...base,
      parts,
      options: options || base.options,
      pathPrefix: pathPrefix === undefined ? base.pathPrefix : pathPrefix,
      name: name || base.name,
    });
  } else {
    const builtin = baseId ? builtinById(baseId) || (base && base.basedOn ? builtinById(base.basedOn) : null) : null;
    const host = where ? where.host : '';
    const hosts = builtin && !pathPrefix ? [host, ...builtin.hosts.filter((h) => h.includes('.'))] : [host];
    const fallback = builtin ? `My ${builtin.name}` : base ? base.name : host.replace(/^www\./, '');
    saved = saveUserSet(store, {
      name: uniqueName(store, name || fallback, hosts),
      hosts,
      pathPrefix,
      parts,
      options: options || (base ? base.options : builtin ? builtin.options : {}),
      basedOn: builtin ? builtin.id : null,
      isDefault: false,
    });
  }
  if (makeDefault) setDefault(store, saved.id);
  return findUserSet(store, saved.id);
}

/** `name`, or "name (2)", "name (3)"… if a rule set for the same site already has it. */
function uniqueName(store, name, hosts) {
  const probe = { origin: 'user', hosts };
  const taken = new Set(
    [...store.sets, ...builtinSets()].filter((set) => sameSite(set, probe)).map((set) => set.name.toLowerCase())
  );
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} (${n})`;
  return candidate;
}

/**
 * Makes `id` the rule set used for its site — on the pages it covers, if it is
 * limited to some. The site's other rule sets stay as they are, ready to be
 * chosen again. For a built-in rule set this is "go back to the built-in
 * rules": it is turned back on if it was off or removed.
 */
function setDefault(store, id) {
  const own = findUserSet(store, id);
  const builtin = own ? null : builtinById(id);
  const target = own || builtin;
  if (!target) return false;
  const scope = own ? own.pathPrefix || '' : '';
  for (const set of store.sets) {
    if (set !== own && (set.pathPrefix || '') === scope && sameSite(set, target)) set.isDefault = false;
  }
  if (own) {
    own.isDefault = true;
    own.enabled = true;
  } else {
    store.builtins[id] = { ...(store.builtins[id] || {}), enabled: true, removed: false };
  }
  return true;
}

/** A copy of any rule set, as a new rule set of the person's own. */
function duplicateSet(store, id, name) {
  const source = findSet(store, id);
  if (!source) throw new Error('There is no rule set with that name.');
  const hosts = source.origin === 'builtin'
    ? source.hosts.filter((h) => h.includes('.')).length ? source.hosts.filter((h) => h.includes('.')) : source.hosts
    : source.hosts;
  return saveUserSet(store, {
    name: uniqueName(store, name || `${source.name} (copy)`, hosts),
    hosts,
    pathPrefix: source.pathPrefix || '',
    parts: source.parts,
    options: source.options,
    basedOn: source.origin === 'builtin' ? source.id : source.basedOn,
    isDefault: false,
  });
}

function deleteUserSet(store, id) {
  const index = store.sets.findIndex((s) => s.id === id);
  if (index >= 0) store.sets.splice(index, 1);
  return index >= 0;
}

/** Turns a rule set on or off, whether it is built-in or the person's own. */
function setEnabled(store, id, enabled) {
  const own = findUserSet(store, id);
  if (own) {
    own.enabled = Boolean(enabled);
    return true;
  }
  if (!builtinById(id)) return false;
  store.builtins[id] = { ...(store.builtins[id] || {}), enabled: Boolean(enabled) };
  return true;
}

/** Hides a built-in rule set from use and from the main list, until restored. */
function removeBuiltin(store, id) {
  if (!builtinById(id)) return false;
  store.builtins[id] = { ...(store.builtins[id] || {}), removed: true };
  return true;
}

function restoreBuiltin(store, id) {
  const ids = id === '*' ? Object.keys(store.builtins) : [id];
  let restored = 0;
  for (const key of ids) {
    if (store.builtins[key] && (store.builtins[key].removed || store.builtins[key].enabled === false)) {
      store.builtins[key] = { ...store.builtins[key], removed: false, enabled: true };
      restored++;
    }
  }
  return restored;
}

/** Makes an editable copy of a built-in rule set. It is not used until made the default. */
function copyBuiltin(store, id) {
  const builtin = builtinById(id);
  if (!builtin) throw new Error('There is no built-in rule set with that name.');
  return duplicateSet(store, id, `${builtin.name} (my copy)`);
}

/** Records what a read found with a rule set, for the manager to show. */
function recordHealth(store, id, health) {
  const clean = cleanHealth(health);
  if (!clean) return false;
  const own = findUserSet(store, id);
  if (own) {
    own.health = clean;
    return true;
  }
  if (!builtinById(id)) return false;
  store.builtins[id] = { ...(store.builtins[id] || {}), health: clean };
  return true;
}

/* ----------------------------------------------------------- import/export */

/** A shareable file. Health, ids and dates stay behind: they are about this machine. */
function exportSets(store, ids) {
  const wanted = ids && ids.length ? new Set(ids) : null;
  const sets = [];
  for (const set of store.sets) {
    if (wanted && !wanted.has(set.id)) continue;
    sets.push(portable(set));
  }
  for (const set of builtinSets()) {
    if (wanted && wanted.has(set.id)) sets.push(portable(set));
  }
  return { format: FILE_FORMAT, version: 1, exportedAt: now(), sets };
}

function portable(set) {
  return {
    name: set.name,
    hosts: set.hosts.slice(),
    ...(set.isDefault ? { isDefault: true } : {}),
    ...(set.pathPrefix ? { pathPrefix: set.pathPrefix } : {}),
    parts: clone(set.parts),
    ...(Object.keys(set.options || {}).length ? { options: clone(set.options) } : {}),
    ...(set.origin === 'builtin' ? { basedOn: set.id } : set.basedOn ? { basedOn: set.basedOn } : {}),
  };
}

function sameRules(a, b) {
  return (
    JSON.stringify([a.hosts, a.pathPrefix || '', a.parts]) ===
    JSON.stringify([b.hosts, b.pathPrefix || '', b.parts])
  );
}

/**
 * Adds the rule sets in a file to the store.
 *
 * Accepts this app's rules file, and also the old `user-packs.json` from
 * before site rules existed, so a backup of either can be brought back.
 * Imported sets are always added as new ones; nothing already here is changed.
 */
function importSets(store, data) {
  let incoming;
  if (data && data.format === FILE_FORMAT && Array.isArray(data.sets)) {
    incoming = data.sets;
  } else if (data && typeof data === 'object' && !Array.isArray(data) && looksLegacy(data)) {
    incoming = migrateLegacyPacks(data).sets;
  } else {
    throw new Error('This file is not an AI Chat Extractor rules file.');
  }

  const result = { added: 0, skipped: 0, invalid: 0, sets: [] };
  for (const raw of incoming.slice(0, LIMITS.sets)) {
    const cleaned = cleanUserSet({ ...raw, id: undefined, health: undefined, enabled: true, importedAt: now() });
    if (!cleaned.ok) {
      result.invalid++;
      continue;
    }
    if (store.sets.some((s) => sameRules(s, cleaned.set))) {
      result.skipped++;
      continue;
    }
    store.sets.push(cleaned.set);
    // A rule set exported as its site's default arrives as the default here too.
    if (cleaned.set.isDefault) setDefault(store, cleaned.set.id);
    result.sets.push(cleaned.set);
    result.added++;
  }
  return result;
}

function looksLegacy(data) {
  const values = Object.values(data);
  return values.length > 0 && values.every((v) => v && typeof v.turnSelector === 'string');
}

/* ----------------------------------------------------------------- display */

/**
 * Everything the rule manager shows, in one structure: the person's rule sets,
 * then the built-in ones with their on/off/removed state and last health. With
 * a `url`, each set also says whether it covers that page.
 */
function managerView(store, url) {
  const data = store || emptyStore();
  const mark = (set) => (url ? { ...set, onThisPage: appliesTo(set, url) } : set);
  const user = data.sets.map((set) => mark(clone(set)));
  const builtins = builtinSets().map((set) => {
    const state = data.builtins[set.id] || {};
    const copy = data.sets.find((s) => s.enabled && s.isDefault && !s.pathPrefix && sameSite(s, set));
    return mark({
      ...set,
      enabled: state.enabled !== false,
      removed: state.removed === true,
      health: state.health || null,
      overriddenBy: copy ? copy.id : null,
    });
  });
  return { user, builtins };
}

/**
 * The rule manager's view, one group per site: every rule set for that site —
 * the built-in one first, then the person's own — and which one is the
 * default. Rule sets limited to part of a site are in their site's group but
 * never its default; they are used on their own pages regardless.
 */
function siteGroups(store, url) {
  const data = store || emptyStore();
  const view = managerView(data, url);
  const groups = [];
  const placed = new Set();
  for (const builtin of view.builtins) {
    const own = view.user.filter((set) => !placed.has(set.id) && (set.basedOn === builtin.id || sameSite(set, builtin)));
    own.forEach((set) => placed.add(set.id));
    groups.push({ key: builtin.id, name: builtin.name, builtin, sets: [builtin, ...own] });
  }
  for (const set of view.user) {
    if (placed.has(set.id)) continue;
    let group = groups.find((g) => !g.builtin && g.sets.some((other) => sameSite(other, set)));
    if (!group) {
      group = { key: `site:${set.hosts[0]}`, name: set.hosts[0].replace(/^www\./, ''), builtin: null, sets: [] };
      groups.push(group);
    }
    group.sets.push(set);
    placed.add(set.id);
  }
  for (const group of groups) {
    const lead = group.builtin || group.sets[0];
    const host = lead.hosts.find((h) => h.includes('.')) || lead.hosts[0];
    group.hosts = [...new Set(group.sets.flatMap((set) => set.hosts.filter((h) => h.includes('.') || set.origin === 'user')))];
    const used = resolve(`https://${host}/`, data).set;
    group.defaultId = used && group.sets.some((set) => set.id === used.id) ? used.id : null;
    group.onThisPage = group.sets.some((set) => set.onThisPage);
    // A group with nothing but a removed built-in belongs with the removed ones.
    group.removed = group.sets.every((set) => set.removed);
  }
  return groups;
}

/**
 * Which rules read `url`, in the shape both apps show: the set with its last
 * health, where it came from and the name to show — or, when none apply, any
 * rules for the site that are switched off or removed, which is worth saying
 * rather than just "no rules".
 */
function siteSummary(url, store) {
  const data = store || emptyStore();
  const { set, source } = resolve(url, data);
  const choices = siteChoices(url, data);
  if (set) {
    const health = set.origin === 'builtin' ? (data.builtins[set.id] || {}).health || null : set.health || null;
    return { set: { ...set, health }, source, name: displayName(set, url), choices };
  }
  const view = managerView(data);
  const off = [...view.user, ...view.builtins].find(
    (s) => appliesTo(s, url) && (s.enabled === false || s.removed)
  );
  return {
    set: null,
    source,
    name: '',
    choices,
    off: off ? { id: off.id, name: displayName(off, url), removed: Boolean(off.removed) } : null,
  };
}

/**
 * The rule sets that could read the whole of this site, for a quick switch
 * where the site is open: the built-in one and the person's own, without
 * those limited to part of the site, which are used on their pages anyway.
 * Choosing one that was turned off turns it back on.
 */
function siteChoices(url, store) {
  const group = siteGroups(store, url).find((g) => g.onThisPage);
  if (!group) return [];
  return group.sets
    .filter((set) => !set.pathPrefix && !set.removed)
    .map((set) => ({ id: set.id, name: set.name, origin: set.origin, isDefault: set.id === group.defaultId }));
}

/**
 * How the teach panel may save: over the rule set it started from (only one
 * of the person's own — built-in rules are never changed), or as a new one
 * with a name ready; and whether to tick "use these from now on", which is
 * ticked unless the person is changing one of their sets that is not in use.
 */
function saveChoices(store, url, baseId) {
  const data = store || emptyStore();
  const base = baseId ? findUserSet(data, baseId) : null;
  const used = resolve(url, data).set;
  return {
    canUpdate: Boolean(base),
    currentName: base ? base.name : '',
    suggestedName: suggestName(data, url, baseId),
    makeDefault: base ? Boolean(used && used.id === base.id) : true,
  };
}

/** A name for a new rule set taught on `url`, not yet used by another for that site. */
function suggestName(store, url, baseId) {
  const where = parseUrl(url) || { host: '' };
  const base = baseId ? findSet(store, baseId) : null;
  const builtin = base ? (base.origin === 'builtin' ? base : builtinById(base.basedOn)) : null;
  const name = builtin ? `My ${builtin.name}` : base ? base.name : where.host.replace(/^www\./, '');
  const hosts = builtin ? builtin.hosts.filter((h) => h.includes('.')) : base ? base.hosts : [where.host];
  return uniqueName(store, name || 'My rules', hosts.length ? hosts : [where.host]);
}

module.exports = {
  STORE_VERSION,
  FILE_FORMAT,
  LIMITS,
  emptyStore,
  normaliseStore,
  mergeStores,
  migrateLegacyPacks,
  builtinSets,
  builtinById,
  resolve,
  appliesTo,
  findSet,
  compile,
  displayName,
  cleanUserSet,
  cleanParts,
  cleanHost,
  cleanPathPrefix,
  cleanHealth,
  saveUserSet,
  saveTaught,
  deleteUserSet,
  setEnabled,
  removeBuiltin,
  restoreBuiltin,
  copyBuiltin,
  duplicateSet,
  setDefault,
  recordHealth,
  exportSets,
  importSets,
  managerView,
  siteGroups,
  siteSummary,
  saveChoices,
  suggestName,
};
