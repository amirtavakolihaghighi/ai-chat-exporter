'use strict';

const { api } = require('../lib/browser');

/**
 * The PDF route for the extension.
 *
 * Extensions have no equivalent of Electron's printToPDF, so the document is
 * rendered into a real page and handed to the browser's own print engine. The
 * important consequence is that fidelity is not lost — this is the same
 * Chromium/Gecko print pipeline, so fonts, page breaks and right-to-left text
 * come out exactly as they would from the desktop app. What is lost is
 * automation: the user picks "Save as PDF" in the dialog, and the custom footer
 * with page numbers is replaced by the browser's own header/footer setting.
 *
 * The HTML is passed through storage rather than the URL because a full
 * conversation is far larger than any URL length limit.
 */

async function main() {
  const params = new URLSearchParams(location.search);
  const key = params.get('key');
  if (!key) {
    document.getElementById('waiting').textContent = 'Nothing to print.';
    return;
  }

  const stored = await api.storage.local.get(key);
  const payload = stored[key];
  if (!payload || !payload.html) {
    document.getElementById('waiting').textContent =
      'That document has expired. Export it again from the workspace.';
    return;
  }

  // One-shot: clear it immediately so printed conversations are not left
  // sitting in extension storage.
  api.storage.local.remove(key);

  document.open();
  document.write(payload.html);
  document.close();

  // Give fonts and inlined images a chance to settle, otherwise the print
  // preview can open before images have decoded.
  const ready = document.fonts?.ready ?? Promise.resolve();
  await ready.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 400));

  window.focus();
  window.print();
}

main().catch((err) => {
  document.body.textContent = `Could not prepare the document: ${err.message}`;
});
