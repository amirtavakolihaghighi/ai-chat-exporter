# Architecture

Two front-ends over one shared core. This document explains the split, and why
the parts that look over-engineered are the way they are.

## The shape of it

```
                   ┌──────────────────────────────┐
                   │        shared core           │
                   │  extraction · conversion ·   │
                   │  rendering · document build  │
                   └───────────┬──────────────────┘
                   ┌───────────┴──────────────┐
        ┌──────────┴─────────┐      ┌─────────┴──────────┐
        │    Desktop app     │      │ Browser extension  │
        │  Electron, own     │      │  MV3, runs in your │
        │  embedded browser  │      │  own session       │
        └────────────────────┘      └────────────────────┘
             writes to any folder        hands Blobs to
                                         chrome.downloads
```

The core is genuinely shared — not copied. `extension/src/lib/exporters.js`
imports the same Markdown, HTML, DOCX, code and merge modules from `../../src/`
that the desktop app uses. A fix to the extractor fixes both products.

## Directory map

| Path | What lives there |
| --- | --- |
| `src/shared/` | Provider selector packs, text-direction detection, byte helpers. No runtime assumptions. |
| `src/inject/` | Scripts that run inside the chat page: the extractor and the element picker. |
| `src/main/lib/` | Conversion (HTML→Markdown/text), document rendering, capture, storage, injection. |
| `src/main/exporters/` | One module per output: docx, code, merge, plus the desktop orchestrator. |
| `src/preload/` | The only bridge between the desktop UI and the main process. |
| `src/renderer/` | The desktop UI. |
| `extension/src/` | Background worker, content script, popup, workspace, print page, browser-side libs. |
| `scripts/` | Build helpers: signing-tool workaround, icon generation. |
| `test/` | Desktop suites, fixtures, benchmark. |
| `extension/test/` | Extension suites. |

## Decisions worth knowing

### The core is runtime-agnostic

It deals in `Uint8Array`, never Node's `Buffer`, and document *construction* is
separated from *packing* — Node wants a Buffer, browsers want a Blob, and only
the caller knows which. See `src/shared/bytes.js`.

This is also why there is no `Buffer` shim in the extension bundle. JSZip picks
between its Node and browser code paths with `typeof Buffer !== "undefined"`;
defining a Buffer, however faithful, sends it down the Node path where
`Uint8Array.slice()` returns a plain array and zip entry names come out as
comma-separated character codes. Leaving it undefined is what makes it work.

### The injectable scripts are dual-use

`src/inject/extract.js` declares a plain function and exports it behind a
`typeof module` guard. The guard is false in a web page, so the desktop app can
inject the file as text and call the function; it is true under a bundler, so the
extension imports it as a normal module. One file, two delivery mechanisms.

### Extraction degrades in stages

Provider markup changes constantly, so no single strategy is trusted:

1. **A provider pack** — known selectors for a known site.
2. **A structural heuristic** — pick the container whose children look most like
   a message list.
3. **The element picker** — the user clicks one message; a selector is derived
   and saved for that host, overriding the built-ins.
4. **Capture "as shown"** — a screenshot needs no parsing and cannot be broken by
   a redesign.

### One element can hold two speakers

Most sites give each message its own element. Some — Vue and Quasar apps in
particular — wrap the question and the answer together in one element carrying
no classes at all, only build-generated scoped-style attributes that change
whenever the site is rebuilt. Nothing marks who is speaking except that the
answer half is rendered markdown.

Read as a single turn, the user's words get swallowed into the reply. Matched on
the markdown alone, the user's words vanish entirely. Both were observed in real
exports before this was handled.

A pack can therefore set `exchangeAssistantSelector`, and `splitExchange()` walks
down to the level where the halves are siblings and groups the children around
that marker. `test/fixtures/fixture-exchange.html` reproduces the layout.

### Reading is fast-path first, then self-checking

The expensive strategy — scroll a viewport at a time, harvesting continuously —
exists only because long chats are virtualised. Most pages are not, and paying
that cost for them is what made reading feel slow.

So the extractor probes: jump to the bottom and watch for evidence of a
re-render (the first turn dropped, the turn count changed, the last turn is
different content). No evidence means everything is in the DOM, and one harvest
gets the lot.

Then it checks its own work regardless, looking for vertical gaps larger than the
typical spacing between messages and re-reading those. If the fast path finds
anything that way, the probe was wrong and it falls through to the full pass.

Every wait is bounded, and the whole read is bounded by a deadline, so a hostile
page can be slow but never hang.

### Waiting is event-driven, not timed

`waitForQuiet` uses a MutationObserver rather than polling. When a re-render is
expected — every step of a virtualised scroll — the quiet countdown does not
start until something actually changes, because otherwise the wait returns during
the gap between setting `scrollTop` and the scroll event being dispatched, and a
stale DOM gets read.

Nothing in the hot path calls `innerText`: it forces a synchronous reflow, and it
was being called for every turn on every poll.

### The extension does its work where it can survive

| Job | Runs in | Why |
| --- | --- | --- |
| Reading the chat | Content script | Lives as long as the page |
| Exporting | Workspace tab | Lives as long as the user leaves it open |
| Image fetching, tab capture | Background | Only it has host permissions and `captureVisibleTab` |
| Nothing long-running | Background | MV3 kills the service worker after ~30 s idle |

A popup was the obvious home for the UI and is the wrong one: it closes the
moment focus moves, abandoning any read in progress.

The chat tab is also brought to the foreground during a read, because background
tabs are throttled hard enough that the site stops re-rendering.

## Testing

| Suite | Runs under | Covers |
| --- | --- | --- |
| `npm test` | Node | Conversion, filenames, selection, code extraction, merge, bidi, DOCX |
| `npm run test:electron` | Electron | The real extractor against DOM fixtures; PDF and image capture |
| `npm run test:e2e` | Electron | Boots the real app and drives the real UI to files on disk |
| `npm run test:extension` | Electron | Manifests, the *built* bundles, browser-side exports |
| `npm run bench` | Electron | Reading speed and completeness against fixtures |

The fixtures in `test/fixtures/` are not decorative — each reproduces a specific
failure mode: a virtualised list that recycles messages, an unknown layout with
no useful attributes, collapsed reasoning, clamped text, a long conversation.

Automated tests cannot cover the thing most likely to break: extraction from real,
frequently-redesigned provider sites. That is what [TESTING.md](TESTING.md) is for.
