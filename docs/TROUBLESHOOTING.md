# Troubleshooting

## Site rules

Most reading problems come down to a site's rules — which parts of its pages the
app treats as messages. The [manual](MANUAL.md#site-rules) explains them; these
are the problems people actually run into.

### "… rules … found no messages on this page"

The site has changed its design, and the rules no longer fit it. Earlier
versions guessed instead when this happened, and on ChatGPT the guess picked
the sidebar of past chats — exporting the list of chats as if it were the
conversation, and reporting success. Rules now stop and say so.

Press **✎ Fix the rules**. The teach panel opens on the page, notices that the
old rules find nothing, and proposes rules for the new layout: blue boxes
around your messages, green around the AI's. If the colours are right, press
**Save rules**. The chat is read again straight away.

For a chat you need right now, **Read once by guessing** reads it without the
rules, this once — check the preview.

### Only my messages come out (or only the AI's)

One of the two message parts is missing or broken. The reading result says
which: "Only your messages were found, none from the AI". Press **✎ Fix the
rules** — the panel starts on the missing part — and click one of those
messages on the page.

Rules from the old one-click picker cause this on every read: that tool could
only point at one kind of message. They are tagged **Old picker** in the Site
rules tab; fixing them once solves it.

### The sidebar, menu or buttons end up in the export

The rules point at page furniture. The reading result says "Most of what was
read is in the site's menu or sidebar". Open **Show on page** to see the boxes,
then **Fix these rules**: point at a real message, and use **Leave out** on the
sidebar so nothing in it is ever read.

### Some messages have no box on the page

Those messages look different from the rest — an image reply, a message with an
attachment, a reply in a different layout. In the teach panel, choose the part
they belong to and click one of them: it is added as another *way*, alongside
the first. Each way can be checked by hovering over it.

### The box covers only a paragraph, or several messages at once

After clicking, use **▲ Bigger** or **▼ Smaller** (or the arrow keys) until one
box covers exactly one message, then **✓ Add**.

### Rules work on shared links but not my own chats (or the reverse)

Many sites lay out shared links and private chats differently. In the last step
of saving, choose **Where on the site: only pages under …** to keep separate
rules for each kind of page. Both can exist at once; the narrower one wins on its
own pages.

### I want the built-in rules back

In the Site rules tab, on the site's card:

- **↺ Back to the built-in rules** — the site is read with them again. Your own
  rule sets for it stay in the list, ready to choose again;
- or press the round button on the **Built-in** row;
- a built-in set you removed is under **Removed built-in rules** at the bottom:
  **Restore**.

### I want two sets of rules for one site, and to switch between them

Keep both: when saving in the teach panel, choose **a new rule set, keeping that
one as it is**, and give it a name. Or **More ▾ → Make a copy** on any row in
the Site rules tab. Then switch with the round buttons there, or with **Rules to
use** on the "This site" card. See
[Several rule sets for one site](MANUAL.md#several-rule-sets-for-one-site).

### Rules I deleted in the extension came back

That happens when the extension and the desktop app share a folder and both
changed the rules before they were next compared: the extension keeps
everything from both copies rather than risk losing a rule set. Delete it again;
it stays deleted once both copies agree.

### Moving rules to another computer, or between the desktop app and the extension

**Export…** in the Site rules tab saves your rules to a file; **Import…** in the
other app adds them. A rules file never contains your conversations.

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
4. Check the badge — an amber "no rules · will guess" badge means the layout was
   guessed. Teach the site.
5. Press **Show on page**: a message with no box is one the rules do not find.

### Nothing was found at all

The site has no rules and the guess failed. Press **✎ Teach this site** (see the
[manual](MANUAL.md#teaching-a-site)). If the site is genuinely hostile to
parsing, export as PDF or PNG in "as shown" mode, which needs no parsing.

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

Fixed in 1.1.4. Attachments sit outside the element a rule names as the message
text, and were being dropped while the site still displayed them.

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

### Teaching the site does not fix it

Some sites give their messages nothing to tell them apart by — no names, no
stable labels, a different arrangement every time the site is rebuilt. Rules
cannot be made reliable for those, however carefully they are taught.

To get built-in rules written for such a site, send two things in an issue:

1. **Your rules**, from **Site rules → More ▾ → Export** on the site's card,
   even if they only half work.
2. **A site report**: run [`docs/site-report.js`](site-report.js) in the browser
   console on the chat page. It describes the page structure, with message text
   cut to 40 characters, so it says how the site is built without carrying your
   conversation with it.

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

### The file is named after the chat's address, or a long string of letters and digits

The name comes from the **Filename template** — `{date} - {provider} - {title}`
by default — and `{title}` is the chat's name as the site shows it in its list
of chats (on ChatGPT, the name it gave the chat). Two things used to get in the
way, and both are fixed:

- When the browser refused a name, the extension's last resort could leave the
  browser to name the file after the download's internal address — a long string
  of letters and digits that looks like an id. It now always offers the proper
  name.
- PDFs from the extension are named in the print dialog, which suggested the
  page's title. It now suggests the same name every other format gets.

If a file is still named wrongly, look at the note in the results: **"Saved as …,
not …: something else renamed it"** means another program took the download
over. Download managers such as **IDM** do this, and name the file after the
download's address. Tell the download manager to leave the browser's downloads
alone, at least from this extension — or choose a folder for the extension in
Options, which it writes to directly, without downloads.

### My message's line breaks are missing in the export

They are kept now: your prompts come out with the line breaks and indentation you
typed, in every format. If one site still loses them, that site shows your
message in an unusual way — please report it (see below), with the site's name.

### Where did my files go?

**Desktop:** wherever **Save to** points — by default the `exports` folder in the
data folder (see [Where your data lives](MANUAL.md#where-your-data-lives)). The
results list has **open** and **folder** buttons.

**Extension:** `Downloads/AI Chat Exports/` — or, if you chose a folder in
Options, its `exports` folder. Without a folder, extensions cannot write anywhere
but the browser's download folder.

### Where are my settings and rules?

**Desktop:** in the data folder — **Options → Where your files are kept** shows
it, and **File → Open data folder** opens it. Running from the project, that is
the project's `data` folder.

**Extension:** in the browser's own storage, and in the folder you chose in
Options, if you chose one. See
[A folder for the extension](MANUAL.md#a-folder-for-the-extension).

### The extension's folder says "waiting for your permission"

The browser asks again after it restarts. Press **Allow access again** in
Options. Until you do, changes stay in the browser and exports go to Downloads;
nothing is lost, and the folder catches up once allowed.

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

1. The reading result and the status bar text when it went wrong.
2. For a site read wrongly: the site's rules, exported from its card in the Site
   rules tab.
3. For a short read: the real message count versus the reported one.
4. For a broken export: the file itself.
5. Console output — desktop: **View → Toggle Developer Tools**, or the gear button
   in the viewer toolbar for the loaded page. Extension: right-click the workspace
   and **Inspect**.
