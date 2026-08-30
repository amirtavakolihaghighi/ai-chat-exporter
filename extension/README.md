# AI Chat Extractor — browser extension

The same exporter as the desktop app, running inside your own browser.

That difference matters more than it sounds. The desktop app embeds its own
browser with its own cookie jar, which is why it leans on share links and why
signing in inside it is awkward. The extension runs in the session you are
already using, so **any chat you can open, you can export** — no share link, no
second login, no OAuth refusals.

Works in Chrome, Edge and Firefox.

Full documentation lives in [../docs](../docs): the
[manual](../docs/MANUAL.md), [troubleshooting](../docs/TROUBLESHOOTING.md), and
the [testing checklist](../docs/TESTING.md).

---

## Building and installing

```bash
npm install          # from the project root
npm run icon         # once, to generate the icons
npm run ext:build    # builds extension/dist/chrome and extension/dist/firefox
```

**Chrome / Edge**
1. Open `chrome://extensions` (or `edge://extensions`)
2. Turn on **Developer mode**
3. **Load unpacked** → choose `extension/dist/chrome`

**Firefox**
1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → choose `extension/dist/firefox/manifest.json`

Firefox unloads temporary add-ons when it restarts; that is a Firefox rule for
unsigned extensions, not a limitation of this one. For a permanent install it
has to be signed through addons.mozilla.org.

`npm run ext:zip` produces store-ready archives if you go that route.

---

## Using it

1. Open a chat — ChatGPT, Claude, Gemini, whatever.
2. Click the toolbar button → **Read this chat**.
3. The workspace opens in a new tab, reads the conversation, and shows a preview.
4. Untick anything you don't want, choose formats, **Export**.

**Read & export with last settings** skips straight to the end using whatever you
chose last time.

Two things that look odd and are deliberate:

**The chat tab comes to the front while it reads**, then you are returned to the
workspace. Browsers throttle background tabs hard enough that chat sites stop
redrawing as the page is scrolled, so a read in a background tab stalls or comes
back short. Let it finish before switching away.

**Everything opens in a tab rather than a popup**, because a popup closes the
moment it loses focus, which would abandon a long read halfway through.

---

## What it can do

Everything the desktop app does, with three exceptions noted further down.

| | |
| --- | --- |
| **Reading** | Auto-scrolls virtualised chats, harvests continuously, then re-reads any gap big enough to hide a message. Expands collapsed reasoning blocks. Same engine as the desktop app. |
| **Formats** | Markdown, HTML, plain text, JSON, Word `.docx`, code files, ZIP, PDF, PNG, JPEG |
| **Choosing messages** | Tick boxes per message, with presets for answers-only, your prompts, invert |
| **Code files** | Every snippet as a real source file, named by language, in a ZIP with a manifest |
| **Library and search** | Every export indexed; full-text search across all of them |
| **Merging** | Several chats into one document with a table of contents |
| **Redaction** | Find/replace, literal or regex, applied before anything is saved |
| **Unknown sites** | Structural heuristic, plus click-to-teach a selector that is then saved for that site |
| **Right-to-left** | Persian, Arabic and Hebrew lay out correctly in HTML, PDF and Word |
| **Batch** | A list of links, each opened, read, exported and closed. Tabs open in the foreground, for the throttling reason above. |

---

## Where it is worse than the desktop app

Three things, all forced by what a browser lets an extension do.

**Files go to Downloads.** Extensions cannot write to an arbitrary folder — the
downloads API only accepts paths inside the browser's download directory. So
everything lands in `Downloads/AI Chat Exports/`. Multi-file exports (code
files) are bundled into one ZIP rather than triggering a download per file.

**PDF goes through the print dialog.** There is no `printToPDF` for extensions.
The document is rendered and handed to the browser's own print engine, so you
pick "Save as PDF" yourself. Worth being precise about the trade-off: the
*quality is identical* — same print engine, so fonts, page breaks and
right-to-left text come out exactly as they do from the desktop app. What is
lost is automation and the custom footer with page numbers, because browsers do
not support CSS paged-media margin boxes. For one chat this is a single extra
click; for a large batch it is a dialog per chat, which is why batch mode
excludes PDF.

**Images are stitched from screen captures.** `captureVisibleTab` only returns
what is on screen, so the page is scrolled a viewport at a time and the frames
composited. Consequences: the chat tab is brought to the front while it happens,
it is slow (browsers rate-limit capture to roughly two frames per second), and
fixed or sticky elements are hidden first so a floating header does not appear
in every tile.

If those three matter to you, use the desktop app for them. They share a library
format, so a JSON export from either can be merged by the other.

---

## Permissions, and why each is needed

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | To read the chat in the tab you are looking at |
| `<all_urls>` | Chats live on many domains, and images are fetched from CDNs on others |
| `downloads` | To save the exported files |
| `storage`, `unlimitedStorage` | Settings, saved site rules, and the searchable library |
| `tabs` | To open the workspace, and to drive background tabs during a batch run |

Nothing is uploaded anywhere. The only network requests the extension makes are
fetches for images inside the chat you are exporting.

On Firefox, host permissions are optional by default under Manifest V3, so you
will be asked to grant access the first time.

---

## Layout

```text
extension/
  manifest.chrome.json     service-worker background
  manifest.firefox.json    event-page background + gecko id
  build.js                 esbuild bundling for both targets
  src/
    background/            image fetching, tab capture, workspace opening
    content/               runs in the chat page: extraction and the picker
    popup/                 thin launcher
    panel/                 the workspace: preview, export, library, merge, batch
    print/                 renders a document and opens the print dialog
    lib/                   browser API shim, storage, downloads, screenshots, exporters
  test/                    manifest validation + real-bundle tests in Chromium
```

The document builders are **not** duplicated here. `src/lib/exporters.js` imports
the same Markdown, HTML, DOCX, code and merge modules the desktop app uses, from
`../../src/`. Only the final step differs: the desktop writes to a folder, this
hands a Blob to the downloads API.

## Tests

```bash
npm run test:extension
```

Validates both manifests, checks no Node built-in or remote script leaked into a
bundle, runs the **built** content script against a fixture page in Chromium, and
exercises the export pipeline in a real browser context — which is the only way
to catch browser-only breakage such as DOCX generation without `Buffer`.
