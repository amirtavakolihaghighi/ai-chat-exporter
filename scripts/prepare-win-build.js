#!/usr/bin/env node
'use strict';

/**
 * Works around an electron-builder packaging failure on Windows.
 *
 * electron-builder downloads winCodeSign-2.6.0.7z for every Windows build, even
 * an unsigned one. That archive carries macOS symlinks:
 *
 *   darwin/10.12/lib/libcrypto.dylib
 *   darwin/10.12/lib/libssl.dylib
 *
 * Creating a symlink on Windows requires either an elevated shell or Developer
 * Mode, so on an ordinary account 7-Zip fails with "A required privilege is not
 * held by the client" and the build dies — four times, once per retry.
 *
 * Those files are macOS code-signing libraries and are of no use to a Windows
 * build. So we populate the cache directory ourselves, skipping the darwin
 * folder entirely. electron-builder finds the directory already present and
 * never runs the extraction that would fail.
 *
 * Idempotent: does nothing when the cache is already good. Runs automatically
 * before `npm run dist` via the `predist` script.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const NAME = 'winCodeSign';
const VERSION = '2.6.0';
const DIR_NAME = `${NAME}-${VERSION}`;
const URL = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${DIR_NAME}/${DIR_NAME}.7z`;

function cacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache');
  }
  return path.join(os.homedir(), '.cache', 'electron-builder');
}

function sevenZipPath() {
  const bundled = path.join(__dirname, '..', 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  return fs.existsSync(bundled) ? bundled : '7za';
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects fetching the signing tools.'));
    https
      .get(url, { headers: { 'User-Agent': 'ai-chat-extractor-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, dest, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Not Windows — nothing to prepare.');
    return;
  }

  const toolDir = path.join(cacheRoot(), NAME);
  const finalDir = path.join(toolDir, DIR_NAME);

  // The Windows signing tool is the thing electron-builder actually needs.
  const marker = path.join(finalDir, 'windows-10', 'x64', 'signtool.exe');
  if (fs.existsSync(marker)) {
    console.log(`Signing tools already prepared at ${finalDir}`);
    return;
  }

  await fsp.mkdir(toolDir, { recursive: true });

  // Reuse an archive a previous failed run already downloaded, if there is one.
  const existing = (await fsp.readdir(toolDir).catch(() => []))
    .filter((f) => f.endsWith('.7z'))
    .map((f) => path.join(toolDir, f));

  let archive = existing[0];
  if (archive) {
    console.log(`Reusing archive from an earlier attempt: ${path.basename(archive)}`);
  } else {
    archive = path.join(toolDir, `${DIR_NAME}.7z`);
    console.log(`Downloading ${URL}`);
    await download(URL, archive);
  }

  await fsp.rm(finalDir, { recursive: true, force: true });

  // -xr!darwin is the whole point: skip the macOS tree holding the symlinks.
  const result = spawnSync(
    sevenZipPath(),
    ['x', archive, `-o${finalDir}`, '-xr!darwin', '-y', '-bd'],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    throw new Error(`7-Zip exited with status ${result.status} while extracting the signing tools.`);
  }
  if (!fs.existsSync(marker)) {
    throw new Error(`Extraction finished but ${marker} is missing — the archive layout may have changed.`);
  }

  // Clean up every stray archive and half-extracted retry directory.
  for (const entry of await fsp.readdir(toolDir)) {
    const full = path.join(toolDir, entry);
    if (entry === DIR_NAME) continue;
    await fsp.rm(full, { recursive: true, force: true });
  }

  console.log(`Prepared Windows signing tools at ${finalDir} (macOS files skipped).`);
}

main().catch((err) => {
  console.error(`\nCould not prepare the Windows build tools: ${err.message}`);
  console.error('Alternative: enable Windows Developer Mode, or run the build from an elevated terminal.');
  process.exit(1);
});
