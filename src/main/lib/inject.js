'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const INJECT_DIR = path.join(__dirname, '..', '..', 'inject');

/**
 * The injectable scripts are plain function declarations so that the same
 * files can be imported as modules by the browser extension. To inject one we
 * wrap its source in an IIFE that declares it and immediately calls it with its
 * config, which keeps the whole thing a single expression — executeJavaScript
 * resolves with the value of the last expression, so it has to be one.
 *
 * The matcher (match.js) goes in front of each of them: it decides which
 * elements are messages, and the reader and the teach overlay must agree.
 */
const ENTRY_POINT = '__aceCreateExtractor';
const MATCHER = '__aceMatcher';
const TEACH = '__aceTeach';

async function readInject(name) {
  return fs.readFile(path.join(INJECT_DIR, name), 'utf8');
}

async function withMatcher(file, entry) {
  const [matcher, source] = await Promise.all([readInject('match.js'), readInject(file)]);
  // A renamed function would turn injection into a silent no-op; fail loudly.
  if (!matcher.includes(`function ${MATCHER}`)) {
    throw new Error(`match.js no longer declares ${MATCHER}; injection would silently do nothing.`);
  }
  if (!source.includes(`function ${entry}`)) {
    throw new Error(`${file} no longer declares ${entry}; injection would silently do nothing.`);
  }
  return `${matcher}\n${source}`;
}

async function buildExtractorSource(config) {
  const body = await withMatcher('extract.js', ENTRY_POINT);
  return `(function () {\n${body}\nreturn ${ENTRY_POINT}(${JSON.stringify(config)});\n})()`;
}

async function buildTeachSource(options) {
  const body = await withMatcher('teach.js', TEACH);
  return `(function () {\n${body}\nreturn ${TEACH}(${JSON.stringify(options)});\n})()`;
}

/** Closes a teach overlay left open on the page, if there is one. */
const CLOSE_TEACH_SOURCE =
  '(function () { if (typeof window.__aceTeachClose === "function") window.__aceTeachClose(); return true; })()';

module.exports = {
  buildExtractorSource,
  buildTeachSource,
  CLOSE_TEACH_SOURCE,
  readInject,
  ENTRY_POINT,
};
