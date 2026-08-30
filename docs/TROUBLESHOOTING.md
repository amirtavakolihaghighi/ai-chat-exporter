# Troubleshooting

## Reading

### The read is slow

A read of a chat that is fully in the page should take about a second. If it is
taking much longer, the site is virtualising — deleting off-screen messages — and
the whole thread has to be scrolled. The status line says which path it took.

Things that legitimately make it slower: a very long conversation, a slow site, a
high **Scroll settle**, and embedding a lot of images.

### It stalls, or comes back short, when I switch tabs

**Extension.** Expected, and unavoidable. Browsers starve background tabs of
animation frames and slow their timers, and chat sites redraw their message lists
using exactly those. In a background tab the page stops reacting to scrolling.

The extension brings the chat tab to the front while it reads for this reason.
Let it finish before switching away.

### A long chat comes back short

1. Compare the reported count with the real chat.
2. Raise **Scroll settle** to 800–1200 ms.
3. If the status mentions the read being stopped early, raise **Give up reading
   after**.
4. Check the badge — an amber "unknown site" badge means the layout was guessed.

### Nothing was found at all

The site is not recognised and the guess failed. Use **Pick a message by hand**
(see the [manual](MANUAL.md#pick-a-message-by-hand)). If the site is genuinely
hostile to parsing, export as PDF or PNG in "as shown" mode, which needs no
parsing.

### Images show as broken in the exported file

If a picture is broken in the export but opens fine when you choose "open image
in new tab", the file kept a **link** instead of embedding the picture. The link
works in the browser you are signed into, because it sends your cookies, and
nowhere else.

Fixed in 1.1.5. To confirm an export is self-contained, open it with the network
disconnected — every picture should still appear. In the file itself, an embedded
picture has `src="data:image/…"`; one that only links has `src="https://…"`.

If it still happens, the read status line reports how many images could not be
fetched. Check that **Download and embed images** is on, and that you are signed
in to the provider in the same browser.

### A screenshot I attached is missing from the export

Fixed in 1.1.4. Attachments sit outside the element a provider pack names as the
message body, and were being dropped while the site still displayed them.

Two things worth knowing about attachments generally:

- What gets captured is the **thumbnail as displayed**, not the full-resolution
  original, which usually lives behind a click.
- Their URLs are signed and expire. **Download and embed images** (on by
  default) fetches them at export time so the file keeps working.

### An image the model generated is missing from the export

Fixed in 1.1.3. If you still see it, the picture is probably wrapped in
something unusual. Run [`docs/site-report.js`](site-report.js) on the chat — it
reports where pictures sit and what wraps them — and include the output in an
issue.

Note that generated images are served from URLs that expire. **Download and
embed images** (on by default) fetches them at export time so the file keeps
working; with it off, the export references a link that will eventually die.

### The site is read wrongly and the picker does not fix it

The picker teaches the app *which elements are messages*. It does not teach it
*who said them* — if a site gives no usable signal for that, roles fall back to
assuming the conversation alternates, and any stray element captured as a
message throws that alternation out.

To get a proper rule written for the site, run
[`docs/site-report.js`](site-report.js) in the browser console on the chat page
and include its output in an issue. It describes the page structure, with message
text truncated to 40 characters, so it says how the site is built without
carrying your conversation with it.

### The wrong things were captured — page furniture, sidebars

Same fix: **Pick a message by hand**, and click one message rather than a
container around it. The match count it reports should be roughly the number of
messages in the chat; if it says 1, or several hundred, you picked too deep or too
shallow.

## Saving

### "Invalid filename" when exporting from the extension

Should no longer happen. The browser's download API rejects names containing
characters it dislikes and reports only "Invalid filename" with no indication of
which one — invisible bidi marks in Persian and Arabic titles are a common cause,
as they are legal in text but not in filenames.

Filenames are now built from an allowlist of letters, numbers, marks, spaces and
safe punctuation, and if a name is still rejected the export retries with an
ASCII-only name and finally with the Save-as dialog. If you see a note saying a
file was saved under a different name, that is this working.

### Where did my files go?

**Extension:** `Downloads/AI Chat Exports/`. Extensions cannot write anywhere
else — the download API only accepts paths inside the browser's download folder.

**Desktop:** wherever **Save to** points; the results list has **open** and
**folder** buttons.

### Images are missing from an old export

Share links hand out signed URLs that expire. Turn on **Download and embed
images** so exports keep working after the link rots.

## PDF

### The extension opens a print dialog instead of saving a PDF

By design — extensions have no equivalent of the desktop app's `printToPDF`, so
the document goes to the browser's own print engine. Choose "Save as PDF".

Quality is identical, including right-to-left text, because it is the same print
engine. What you lose is automation and the page-number footer, since browsers do
not support CSS paged-media margin boxes. For bulk PDFs, use the desktop app.

### The "as shown" PDF only covers part of a long chat

It captures the live page, so it can only include what the site currently has in
it. Use **Clean document** mode, which is built from the full transcript.

## Images

### Full-page image capture is slow in the extension

Browsers rate-limit screen capture to roughly two frames a second, and only what
is on screen can be captured, so the page is scrolled a viewport at a time and the
frames stitched together. A long chat takes a while. The desktop app does this in
one operation.

### A floating header repeats down the image

Fixed and sticky elements are hidden before capture for this reason. If one still
repeats, report the site — its header is probably positioned in a way the check
misses.

## Signing in

### Google refuses to sign in inside the desktop app

Google blocks OAuth in embedded browsers on some flows. Use a share link, sign in
with an email/password account, or use the extension, which runs in your real
browser session and has no such problem.

## Building and installing

### `npm run dist` fails with "Cannot create symbolic link"

electron-builder downloads a signing-tools archive containing macOS symlinks, and
creating symlinks on Windows needs an elevated shell or Developer Mode.

`npm run dist` runs `scripts/prepare-win-build.js` first, which populates the
cache itself and skips the macOS files. If you are running electron-builder
directly, run that script first, or enable Developer Mode, or use an
administrator terminal.

### The build fails with "zip: not a valid zip file"

electron-builder caches the Electron archive under
`%LOCALAPPDATA%\electron\Cache`, and a download interrupted partway leaves a
corrupt file there that it will keep reusing.

The build config now sets `electronDist` to `node_modules/electron/dist`, so
packaging uses the Electron that npm already installed and never downloads that
archive at all. If you hit this on an older checkout, delete the cache folder and
build again.

### The desktop window is blank, or the app crashes on launch

Some Windows GPU drivers do not get on with Chromium. Launch with `--disable-gpu`.

### Firefox forgets the extension when it restarts

Firefox unloads temporary add-ons on restart. That is Firefox's rule for unsigned
extensions. A permanent install has to be signed through addons.mozilla.org. Your
library and settings survive — reload the add-on and they are still there.

## Reporting a problem

The most useful thing to include is **which provider** and **which scenario
number** from [TESTING.md](TESTING.md), because nearly every extraction bug is
provider-specific.

Also helpful:

1. The status bar text when it went wrong.
2. For a short read: the real message count versus the reported one.
3. For a broken export: the file itself.
4. Console output — desktop: **View → Toggle Developer Tools**, or the gear button
   in the viewer toolbar for the loaded page. Extension: right-click the workspace
   and **Inspect**.
