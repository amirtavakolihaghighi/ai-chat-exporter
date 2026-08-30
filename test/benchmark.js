/**
 * Times a read against local fixtures.
 *
 * Reading speed is a real feature here — a chat that takes a minute to read is
 * one people stop exporting — so it gets measured rather than eyeballed.
 *
 *   npm run bench
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { PROVIDERS, COMMON_STRIP, COMMON_EXPAND } = require('../src/shared/providers');
const inject = require('../src/main/lib/inject');

const REPORT = path.join(__dirname, 'benchmark.txt');
const lines = [];
const say = (l) => {
  console.log(l);
  lines.push(l);
};

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

async function timeFixture(win, fixture, pack, label) {
  await win.loadFile(path.join(__dirname, 'fixtures', fixture));
  await new Promise((r) => setTimeout(r, 300));

  const source = await inject.buildExtractorSource({
    pack: pack || {},
    commonStrip: COMMON_STRIP,
    commonExpand: COMMON_EXPAND,
    embedImages: false,
    settleMs: 450,
    maxScrollSteps: 400,
    maxImageBytes: 0,
    maxTotalImageBytes: 0,
  });

  const started = Date.now();
  const result = await win.webContents.executeJavaScript(source, true);
  const elapsed = Date.now() - started;

  say(
    `${label.padEnd(34)} ${String(result.messages?.length ?? 0).padStart(3)} messages  ` +
      `${String(elapsed).padStart(6)} ms  ${result.log?.find((l) => /DOM|recycles/.test(l)) || ''}`
  );
  return { elapsed, count: result.messages?.length ?? 0 };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });

  const chatgpt = PROVIDERS.find((p) => p.id === 'chatgpt');
  say('fixture                            messages     time  path');
  say('-'.repeat(96));

  const long = await timeFixture(win, 'fixture-long.html', chatgpt, '80 messages, all in the DOM');
  const virtual = await timeFixture(win, 'fixture-virtual.html', chatgpt, '24 messages, virtualised');
  const short = await timeFixture(win, 'fixture-chatgpt.html', chatgpt, '6 messages, all in the DOM');
  const unknown = await timeFixture(win, 'fixture-unknown.html', {}, '6 messages, unknown layout');

  say('');
  const ok =
    long.count === 80 && virtual.count === 24 && short.count === 6 && unknown.count === 6;
  say(ok ? 'All fixtures read completely.' : 'WARNING: a fixture came back short.');
  say(`Long non-virtualised chat: ${long.elapsed} ms for 80 messages ` +
      `(${(long.elapsed / long.count).toFixed(1)} ms per message).`);

  fs.writeFileSync(REPORT, lines.join('\n') + '\n', 'utf8');
  win.destroy();
  app.exit(ok ? 0 : 1);
});
