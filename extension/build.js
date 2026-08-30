#!/usr/bin/env node
'use strict';

/**
 * Builds the browser extension for Chrome and Firefox.
 *
 * Manifest V3 forbids remote code, so every dependency has to be bundled into
 * the extension itself — hence esbuild. The two browsers differ in exactly one
 * structural way that matters here: Chrome runs the background as a service
 * worker, Firefox as an event page. That is why there are two manifests rather
 * than one with conditional keys.
 *
 *   node extension/build.js              # build both
 *   node extension/build.js --zip        # build both and zip for distribution
 *   node extension/build.js --watch      # rebuild on change (chrome only)
 */

const esbuild = require('esbuild');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');
const TARGETS = ['chrome', 'firefox'];

const ENTRIES = {
  'background.js': 'src/background/background.js',
  'content.js': 'src/content/content.js',
  'popup.js': 'src/popup/popup.js',
  'panel.js': 'src/panel/panel.js',
  'print.js': 'src/print/print.js',
};

const STATIC_FILES = [
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/panel/panel.html', 'panel.html'],
  ['src/panel/panel.css', 'panel.css'],
  ['src/print/print.html', 'print.html'],
];

async function copyIcons(outDir) {
  const source = path.join(ROOT, 'icons');
  const target = path.join(outDir, 'icons');
  await fsp.mkdir(target, { recursive: true });
  if (!fs.existsSync(source)) {
    console.warn('! extension/icons is missing — run `npm run icon` first.');
    return;
  }
  for (const file of await fsp.readdir(source)) {
    await fsp.copyFile(path.join(source, file), path.join(target, file));
  }
}

async function buildTarget(target, { watch = false } = {}) {
  const outDir = path.join(OUT, target);
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });

  const options = {
    entryPoints: Object.entries(ENTRIES).map(([out, src]) => ({
      in: path.join(ROOT, src),
      out: out.replace(/\.js$/, ''),
    })),
    outdir: outDir,
    bundle: true,
    format: 'iife',
    // Chromium and Gecko versions that support the MV3 APIs used here.
    target: ['chrome110', 'firefox115'],
    platform: 'browser',
    sourcemap: false,
    minify: false, // reviewable source matters more than a few hundred KB
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': '"production"',
      __ACE_TARGET__: JSON.stringify(target),
    },
    // The shared core is CommonJS written for Node; these shims let the same
    // files run unmodified in a browser bundle.
    inject: [path.join(ROOT, 'src/lib/node-shim.js')],
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log(`watching ${target}…`);
  } else {
    await esbuild.build(options);
  }

  for (const [from, to] of STATIC_FILES) {
    await fsp.copyFile(path.join(ROOT, from), path.join(outDir, to));
  }
  await fsp.copyFile(path.join(ROOT, `manifest.${target}.json`), path.join(outDir, 'manifest.json'));
  await copyIcons(outDir);

  return outDir;
}

async function zipTarget(target) {
  const JSZip = require('jszip');
  const outDir = path.join(OUT, target);
  const zip = new JSZip();

  async function addDir(dir, prefix = '') {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await addDir(full, rel);
      else zip.file(rel, await fsp.readFile(full));
    }
  }

  await addDir(outDir);
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const file = path.join(OUT, `ai-chat-extractor-${target}.zip`);
  await fsp.writeFile(file, buffer);
  return file;
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');
  const zip = args.includes('--zip');
  const only = TARGETS.find((t) => args.includes(`--${t}`));
  const targets = only ? [only] : TARGETS;

  for (const target of targets) {
    const dir = await buildTarget(target, { watch });
    console.log(`built ${target} -> ${path.relative(process.cwd(), dir)}`);
    if (zip) console.log(`zipped -> ${path.relative(process.cwd(), await zipTarget(target))}`);
  }

  if (!watch) {
    console.log('\nLoad unpacked:');
    console.log('  Chrome/Edge  chrome://extensions -> Developer mode -> Load unpacked -> extension/dist/chrome');
    console.log('  Firefox      about:debugging#/runtime/this-firefox -> Load Temporary Add-on -> extension/dist/firefox/manifest.json');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
