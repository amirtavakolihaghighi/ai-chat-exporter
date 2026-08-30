#!/usr/bin/env node
'use strict';

/**
 * Generates build/icon.ico for the packaged app.
 *
 * Rather than pull in an image library, the icon is drawn as HTML, rendered by
 * the Chromium already in the project, and packed into an ICO by hand. Windows
 * accepts PNG-compressed ICO entries, so each size is just a resized PNG with a
 * 16-byte directory record in front of it.
 *
 *   npm run icon
 */

const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const ICON_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  html, body { margin:0; padding:0; width:256px; height:256px; background:transparent; }
  .tile {
    width:256px; height:256px; border-radius:56px;
    background:linear-gradient(135deg,#4f9cf9 0%,#6f6cf7 52%,#8b5cf6 100%);
    display:flex; align-items:center; justify-content:center; position:relative;
    font-family:"Segoe UI",system-ui,sans-serif;
  }
  /* A speech bubble, to say "chat" without any text that would blur at 16px. */
  .bubble {
    width:150px; height:112px; background:#fff; border-radius:30px; position:relative;
    box-shadow:0 10px 26px rgba(0,0,0,.22);
  }
  .bubble::after {
    content:""; position:absolute; left:34px; bottom:-20px;
    border-width:24px 22px 0 0; border-style:solid; border-color:#fff transparent transparent transparent;
    border-bottom-left-radius:6px;
  }
  .lines { position:absolute; inset:0; display:flex; flex-direction:column;
    justify-content:center; gap:15px; padding:0 28px; }
  .lines i { display:block; height:13px; border-radius:7px; background:#5b7cf7; opacity:.9; }
  .lines i:nth-child(1) { width:100%; }
  .lines i:nth-child(2) { width:74%; }
  .lines i:nth-child(3) { width:88%; }
  /* The download arrow is what makes it read as "export", not just "chat". */
  .arrow { position:absolute; right:26px; bottom:24px; width:66px; height:66px;
    background:#0f1115; border-radius:50%; display:flex; align-items:center; justify-content:center;
    box-shadow:0 6px 18px rgba(0,0,0,.35); }
  .arrow::before { content:""; width:11px; height:26px; background:#fff; border-radius:3px;
    position:absolute; top:15px; }
  .arrow::after { content:""; position:absolute; top:33px;
    border-width:17px 14px 0 14px; border-style:solid; border-color:#fff transparent transparent transparent; }
</style></head>
<body><div class="tile">
  <div class="bubble"><div class="lines"><i></i><i></i><i></i></div></div>
  <div class="arrow"></div>
</div></body></html>`;

/** Packs PNG buffers into a single .ico container. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;

  images.forEach((image, i) => {
    const at = i * 16;
    // 0 in the size byte means 256 — the format has only one byte for it.
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 0);
    directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(image.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.data)]);
}

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, 'icon-source.html');
  fs.writeFileSync(file, ICON_HTML, 'utf8');

  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true },
  });

  try {
    await win.loadFile(file);
    win.setOpacity(0);
    win.showInactive(); // a hidden window produces no frame to capture
    await new Promise((r) => setTimeout(r, 600));

    const full = await win.webContents.capturePage();
    const png = full.toPNG();
    fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);

    const base = nativeImage.createFromBuffer(png);
    const images = SIZES.map((size) => ({
      size,
      data: base.resize({ width: size, height: size, quality: 'best' }).toPNG(),
    })).filter((i) => i.data.length > 0);

    const ico = buildIco(images);
    fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), ico);
    console.log(`Wrote build/icon.ico (${images.length} sizes, ${ico.length} bytes) and build/icon.png`);

    // The browser extension wants loose PNGs at the sizes its manifest lists.
    const extensionIcons = path.join(__dirname, '..', 'extension', 'icons');
    fs.mkdirSync(extensionIcons, { recursive: true });
    for (const size of [16, 32, 48, 128]) {
      const match = images.find((i) => i.size === size);
      if (match) fs.writeFileSync(path.join(extensionIcons, `icon-${size}.png`), match.data);
    }
    console.log('Wrote extension/icons/icon-{16,32,48,128}.png');
  } catch (err) {
    console.error('Icon generation failed: ' + (err.stack || err));
    app.exit(1);
    return;
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(file, { force: true });
  }

  app.exit(0);
});
