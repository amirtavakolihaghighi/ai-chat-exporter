// Dev utility: boots the real app, opens a demo chat, reads it, draws what the
// site's rules find on the page, and saves a screenshot of the window — the
// picture in the README.
const { app, BrowserWindow, session } = require('electron');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
// A throwaway profile and data folder: a screenshot must never read or write
// the real settings, rules or library.
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ace-shot-profile-')));
process.env.ACE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-shot-data-'));
require('../src/main/main.js');

// Optional: --size=1024x600 to check the layout at a small viewport,
// --scroll=bottom to capture the sidebar scrolled to the end.
const sizeArg = /--size=(\d+)x(\d+)/.exec(process.argv.join(' '));
const scrollBottom = process.argv.join(' ').includes('--scroll=bottom');
const suffix = sizeArg ? `-${sizeArg[1]}x${sizeArg[2]}${scrollBottom ? '-bottom' : ''}` : '';

const out = path.join(__dirname, `ui-shot${suffix}.png`);
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'fixture-chatgpt.html'));
// Served at a made-up chatgpt.com address inside the app's browser pane, so
// the pane shows that address — never a local path carrying this machine's
// username, which a screenshot keeps where no text search can find it — and
// the built-in ChatGPT rules apply exactly as they would on the real site.
const DEMO_URL = 'https://chatgpt.com/share/8f21c0de-demo';

app.whenReady().then(async () => {
  session.fromPartition('persist:aichats').protocol.handle('https', () =>
    new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } }));

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let win;
  for (let i = 0; i < 60 && !win; i++) {
    await wait(200);
    [win] = BrowserWindow.getAllWindows();
  }
  await wait(1500);
  win.setSize(sizeArg ? Number(sizeArg[1]) : 1480, sizeArg ? Number(sizeArg[2]) : 900);
  await wait(500);
  const run = (code) => win.webContents.executeJavaScript(code, true);

  await run(`document.getElementById('urlInput').value = ${JSON.stringify(DEMO_URL)};
    document.getElementById('urlForm').requestSubmit(); true`);
  await wait(3000);
  await run(`document.getElementById('extractBtn').click(); true`);
  await wait(8000);
  // Draw what the rules find: blue boxes for your messages, green for the AI's.
  await run(`document.getElementById('showRulesBtn').click(); true`);
  await wait(2500);
  if (scrollBottom) {
    await run(`document.querySelector('.panel.active').scrollTop = 1e6`);
    await wait(400);
  }

  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote ' + out);
  app.exit(0);
});
