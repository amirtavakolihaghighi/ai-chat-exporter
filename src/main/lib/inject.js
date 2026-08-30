'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const INJECT_DIR = path.join(__dirname, '..', '..', 'inject');

/**
 * The extractor is a plain function declaration so that the same file can be
 * imported as a module by the browser extension. To inject it we wrap the
 * source in an IIFE that declares it and immediately calls it with the config,
 * which keeps the whole thing a single expression — executeJavaScript resolves
 * with the value of the last expression, so it has to be one.
 */
const ENTRY_POINT = '__aceCreateExtractor';

async function readInject(name) {
  return fs.readFile(path.join(INJECT_DIR, name), 'utf8');
}

async function buildExtractorSource(config) {
  const template = await readInject('extract.js');
  if (!template.includes(`function ${ENTRY_POINT}`)) {
    throw new Error(`extract.js no longer declares ${ENTRY_POINT}; injection would silently do nothing.`);
  }
  return `(function () {\n${template}\nreturn ${ENTRY_POINT}(${JSON.stringify(config)});\n})()`;
}

async function buildPickerSource() {
  const template = await readInject('picker.js');
  return `(function () {\n${template}\nreturn __aceStartPicker();\n})()`;
}

module.exports = { buildExtractorSource, buildPickerSource, readInject, ENTRY_POINT };
