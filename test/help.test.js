/**
 * Keeps in-app help, the controls and the manual in step. Pure Node.
 *
 * Every control in both apps carries a `data-help` key, "What's this?" mode
 * explains it from src/shared/help.js, and each explanation links into
 * docs/MANUAL.md. Nothing else stops one of the three drifting from the others
 * — a new button with no explanation, a renamed manual section leaving a dead
 * link — so this checks all of it.
 *
 *   npm test
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { marked } = require('marked');
const help = require('../src/shared/help');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

let failures = 0;
function check(name, cond, extra = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const keysIn = (text) => [...text.matchAll(/data-help="([^"]+)"/g)].map((m) => m[1]);

const desktop = keysIn(read('src/renderer/index.html'));
const extension = keysIn(read('extension/src/panel/panel.html'));
// Rule cards are built by script rather than written in a page.
const scripted = [...read('src/shared/ui.js').matchAll(/dataset\.help = '([^']+)'/g)].map((m) => m[1]);
const used = new Set([...desktop, ...extension, ...scripted]);

check('help: the desktop app labels its controls', desktop.length > 50, String(desktop.length));
check('help: the extension labels its controls', extension.length > 40, String(extension.length));

const unexplained = [...used].filter((key) => !help.topic(key));
check('help: every labelled control is explained', unexplained.length === 0, unexplained.join(', '));

const unused = Object.keys(help.TOPICS).filter((key) => !used.has(key));
check('help: every explanation belongs to a real control', unused.length === 0, unused.join(', '));

const incomplete = Object.entries(help.TOPICS).filter(([, t]) => !t.title || !t.text || !t.section).map(([k]) => k);
check('help: every explanation has a title, words and a manual section', incomplete.length === 0, incomplete.join(', '));

/* --------------------------------------------------------------- manual */

const manual = read('docs/MANUAL.md');
const rendered = help.buildManual(manual, (text) => marked.parse(text));
const anchors = new Set([...rendered.html.matchAll(/<h[1-4] id="([^"]+)"/g)].map((m) => m[1]));

check('manual: renders with a contents list', rendered.toc.length > 20, String(rendered.toc.length));
check('manual: every heading gets an anchor', anchors.size >= rendered.toc.length);

const deadSections = Object.entries(help.TOPICS)
  .filter(([, t]) => !anchors.has(t.section))
  .map(([key, t]) => `${key} -> #${t.section}`);
check('manual: every explanation links to a section that exists', deadSections.length === 0, deadSections.join(', '));

const links = [...manual.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
const deadLinks = links.filter((anchor) => !anchors.has(anchor));
check('manual: every link inside the manual leads somewhere', deadLinks.length === 0, deadLinks.join(', '));

// The in-app viewer cannot follow links to other files; the manual has to
// stand on its own.
const fileLinks = [...manual.matchAll(/\]\((?!#|https?:)([^)]+)\)/g)].map((m) => m[1]);
check('manual: no links to other files, which the in-app viewer cannot open', fileLinks.length === 0, fileLinks.join(', '));

check('slug: matches the anchors GitHub gives headings',
  help.slug('2. Reading a chat') === '2-reading-a-chat' &&
  help.slug('PDF and image style') === 'pdf-and-image-style' &&
  help.slug('What&#39;s this?') === 'whats-this' &&
  help.slug('“Show more” buttons') === 'show-more-buttons',
  [help.slug('2. Reading a chat'), help.slug('What&#39;s this?'), help.slug('“Show more” buttons')].join(' | '));

/* --------------------------------------------- every part is in the manual */

const { PARTS } = require('../src/shared/parts');
const missingParts = PARTS.filter((part) => !manual.includes(`**${part.label.replace(/“|”/g, '"')}**`) && !manual.includes(`**${part.label}**`));
check('manual: every coloured part is described', missingParts.length === 0, missingParts.map((p) => p.label).join(', '));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
