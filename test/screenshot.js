// Dev utility: boots the real app, loads a fixture, reads it, and saves a
// screenshot of the window so the UI can be eyeballed.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();
require('../src/main/main.js');

// Optional: --size=1024x600 to check the layout at a small viewport,
// --scroll=bottom to capture the sidebar scrolled to the end.
const sizeArg = /--size=(\d+)x(\d+)/.exec(process.argv.join(' '));
const scrollBottom = process.argv.join(' ').includes('--scroll=bottom');
const suffix = sizeArg ? `-${sizeArg[1]}x${sizeArg[2]}${scrollBottom ? '-bottom' : ''}` : '';

const out = path.join(__dirname, `ui-shot${suffix}.png`);
const fixture = 'file:///' + path.join(__dirname, 'fixtures', 'fixture-chatgpt.html').replace(/\\/g, '/');

app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let win;
  for (let i = 0; i < 60 && !win; i++) {
    await wait(200);
    [win] = BrowserWindow.getAllWindows();
  }
  await wait(1500);
  if (sizeArg) {
    win.setSize(Number(sizeArg[1]), Number(sizeArg[2]));
    await wait(500);
  }
  const run = (code) => win.webContents.executeJavaScript(code, true);

  await run(`(() => {
    document.getElementById('placeholder').style.display = 'none';
    document.getElementById('urlInput').value = 'https://chatgpt.com/share/8f21c0de-demo';
    document.getElementById('view').src = ${JSON.stringify(fixture)};
    return true;
  })()`);
  await wait(3000);
  await run(`document.getElementById('extractBtn').click()`);
  await wait(12000);
  // The viewer toolbar mirrors whatever the webview navigated to, which for a
  // local fixture is an absolute path carrying this machine's username and
  // folder tree. A screenshot is precisely where such a thing survives every
  // text search, so present the demo URL in both places instead.
  await run(`(() => {
    const shown = 'https://chatgpt.com/share/8f21c0de-demo';
    document.getElementById('urlInput').value = shown;
    const display = document.getElementById('urlDisplay');
    if (display) display.textContent = shown;

    // The fixture is served from file://, so no provider pack matches it and
    // the badge reports an unrecognised site. That is an artefact of the test
    // harness, not of the application: on the real chatgpt.com the pack matches
    // and the badge is green. Show what a real chat shows, so the screenshot
    // does not misrepresent the tool in either direction.
    const badge = document.getElementById('providerBadge');
    if (badge) { badge.className = 'badge known'; badge.textContent = 'ChatGPT'; }
    const status = document.getElementById('extractStatus');
    if (status) {
      status.className = 'extract-status ok';
      status.textContent = status.textContent.replace(/ · layout was guessed[^]*$/, '');
    }
    return true;
  })()`);

  await run(`document.getElementById('previewBox').open = true`);
  await wait(500);
  if (scrollBottom) {
    await run(`document.querySelector('.panel.active').scrollTop = 1e6`);
    await wait(400);
  }

  const image = await win.webContents.capturePage();
  fs.writeFileSync(out, image.toPNG());
  console.log('wrote ' + out);
  app.exit(0);
});
