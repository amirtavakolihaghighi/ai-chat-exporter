/**
 * Test-only bundle entry. Exposes the browser-side export pipeline on `window`
 * so the Electron harness can drive it from a real page context — which is the
 * only way to prove the DOCX and ZIP paths work outside Node.
 */
'use strict';

const convert = require('../../src/main/lib/convert.js');
const { renderHtml } = require('../../src/main/lib/render.js');
const { buildDocument } = require('../../src/main/exporters/docx.js');
const { extractCodeBlocks } = require('../../src/main/exporters/code.js');
const merge = require('../../src/main/exporters/merge.js');
const { Packer } = require('docx');
const JSZip = require('jszip');

// The real module reaches for chrome.downloads at import time via ./download,
// so stub just enough of the extension API for it to load.
globalThis.chrome = globalThis.chrome || {
  downloads: { download: async () => 1, show() {} },
  storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
  runtime: { getURL: (p) => p, onMessage: { addListener() {} } },
};

const exporters = require('../src/lib/exporters.js');

window.ACE = {
  convert,
  renderHtml,
  buildDocument,
  extractCodeBlocks,
  merge,
  Packer,
  JSZip,
  exporters,
};
