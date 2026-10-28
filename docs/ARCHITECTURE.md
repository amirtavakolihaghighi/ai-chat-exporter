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
| `src/shared/` | Site rules and the built-in ones, default options, the interface pieces both apps share, help, text direction, byte helpers. No runtime assumptions. |
| `config/` | `default-settings.json`: the options both apps start with. |
| `src/inject/` | Scripts that run inside the chat page: the matcher, the extractor and the teach overlay. |
| `src/main/lib/` | Conversion (HTML→Markdown/text), document rendering, capture, storage and the data folder, injection. |
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

### Site rules, and why a rule never falls back to guessing

Which elements of a page are messages is described by **site rules**
(`src/shared/rules.js`): per site, a set of CSS selectors for each *part* —
your messages, the AI's replies, reasoning, areas to leave out and so on
(`src/shared/parts.js`). The rules the app ships with (`src/shared/providers.js`)
are written in exactly the same shape as the ones a person teaches it, so the
rule manager can show, check, choose and remove them like any other.

Three decisions shape the system, each the answer to a failure:

- **No silent fallback.** The old reader, finding that a site's selectors
  matched nothing, quietly switched to a layout heuristic. After a ChatGPT
  redesign that heuristic picked the sidebar of past chats — it holds more text
  than a short conversation — and the export was the list of chats, reported as
  a success. Now rules that find nothing stop the read with
  `reason: 'rules-found-nothing'`, and guessing is only ever done for a site
  with no rules, or when the person asks for it once.
- **Self-contained rule sets.** The old picker laid one selector over the
  built-in pack field by field, so a hand-made rule silently inherited built-in
  settings that might not fit it. Nothing is merged now: teaching on top of a
  built-in set saves a complete copy of the person's own.
- **Health on every read.** The extractor reports what each part found and
  what looked wrong (`health`: a part that found nothing, only one speaker,
  messages inside navigation landmarks, invalid selectors). The apps store it
  against the rule set, which is what lets the manager say "worked on 27 Oct" or
  "broken", and lets a broken rule be fixed from the message that reports it.

A site can have several rule sets — the built-in one and any number of the
person's own — and exactly one is its **default** (`isDefault` on a person's
set; the built-in one when none is). Resolution is: the narrowest page scope
first (sets limited to part of a site are used on their pages regardless), then
the default, then a built-in set, then the most specific hostname; removed sets
are skipped. Rule sets saved before defaults existed are marked default when
read, so nothing that was in use stops being used. `siteGroups()` is the
manager's view of all this: one group per site, with which set is the default.

### One matcher, two consumers

`src/inject/match.js` decides which elements are messages and who sent each.
Both the extractor and the teach overlay (`src/inject/teach.js`) use it, so the
coloured boxes a person sees while teaching are exactly what a read captures.

It resolves the awkward cases once, for everyone: an element claimed by two
parts (a part that names the speaker beats one that does not, then the narrower
rule wins), elements inside "leave out" areas, and messages nested in messages.
A message of the same speaker inside another is part of its content; one of a
different speaker is read on its own and *cut out* of the one containing it —
which is how pointing at both halves of a combined question-and-answer element
splits it correctly.

### The teach overlay

`src/inject/teach.js` draws everything the rules find as coloured, labelled
boxes over the page, in a shadow root so the site's styles cannot reach it,
with styles from a constructed stylesheet so strict Content Security Policies
do not block them. It builds its interface from elements, never from markup
strings, because some sites enforce Trusted Types.

Picking turns a click into a selector by scoring candidates built from the
element's stable attributes and classes: attribute values that name a speaker
score highest, per-instance values (`conversation-turn-7`) are generalised to a
prefix, utility and hashed classes are ignored, and a candidate that would also
catch another part's boxes is narrowed with `:not(…)` where something tells
them apart. A site with no rules — or rules that find nothing on the page —
starts from a proposal built the same way from the layout heuristic, so most of
the time teaching is checking colours and saving.

### Reading degrades in stages

1. **Site rules** — built-in, taught or imported.
2. **A structural heuristic**, only for a site with no rules — pick the
   container whose children look most like a message list. Navigation
   landmarks, narrow side panels and lists of links are excluded, and inline
   script text is not counted as page text.
3. **Teaching** — point at the page; the app proposes, the person confirms.
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

A rule set can therefore set `options.exchangeAssistant`, and `splitExchange()`
walks down to the level where the halves are siblings and groups the children
around that marker. `test/fixtures/fixture-exchange.html` reproduces the layout.
A person teaching such a site needs none of this: pointing at the two halves as
separate parts gets the same result through the matcher's cut-outs.

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

### Two messages can say the same thing

Every message is seen many times during a read — on each scroll step it stays on
screen, and again whenever a virtualised list re-creates it — so sightings are
matched to messages. Matching by content alone merged messages that merely said
the same words: "continue", sent twice, came out once. A second sighting with
the same content is now only taken for the first message drawn again when the
first one's element has left the page or changed; while both are on the page at
once, they are two messages.

### One interface, two apps

The desktop app reaches its data over IPC and the extension through extension
storage, but they show the same things: the reading result, the coloured part
chips, the rule cards, the colour legend, the manual viewer and "What's this?"
mode all come from `src/shared/ui.js` and `src/shared/ui.css`, which take the
data and actions they need as arguments. Help texts for every control live in
`src/shared/help.js` and link into `docs/MANUAL.md`, which both apps render
inside themselves; `test/help.test.js` keeps the three in step.

### Where files are kept

The desktop app writes into one **data folder** (`src/main/lib/paths.js`), a
folder per kind of file: `settings/settings.json`, `rules/site-rules.json`,
`library/library.json`, and `exports/` as the default output folder. Run from
the project it is `<project>/data` (git-ignored); the portable build keeps it
beside the .exe; the installed build in `%APPDATA%\AI Chat Extractor\data` —
never the install folder, which updates replace — and, that folder being
hidden, keeps exports in `Documents\AI Chat Exports`. `ACE_DATA_DIR` overrides it,
which is how every test keeps away from real data, and a folder chosen in
Options is remembered in `data-location.json` in Electron's profile folder,
the one place known before any other. Files from the older flat layout are
copied in on first start, never moved.

The embedded browser's profile — sign-ins, cookies, cache — stays in Electron's
profile folder: Chromium locks it while running, it holds live sign-ins that
must not land in a folder that may be shared or committed, and it is large.

Default options live in `config/default-settings.json`, laid over a built-in
copy in `src/shared/settings.js` that also decides what each option's type is.
Settings files store only what differs from the defaults (`changedFrom`), so a
changed default reaches everyone who never changed that option.

The extension cannot write files on its own. In Chrome and Edge the person can
give it a folder through the File System Access API (`extension/src/lib/folder.js`):
the handle is kept in IndexedDB, permission is asked again after a restart, and
`storage.js` keeps the browser's copies of options and rules in step with
`settings/extension-settings.json` and `rules/site-rules.json` there — the same
rules file the desktop app uses. A three-way comparison of save times against
the last time both agreed decides between writing, taking the folder's copy, or
merging (`rules.mergeStores`, which keeps every rule set from both). Exports go
to the folder's `exports/` instead of Downloads while it is allowed.

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
| `npm test` | Node | Conversion, filenames, selection, code extraction, merge, bidi, DOCX; site rules (resolution, defaults, groups, validation, migration, import/export); default options and what is saved of them; folder sync decisions and merges; the desktop data folder and every write to it, with Electron stood in for; help coverage |
| `npm run test:electron` | Electron | The real extractor and teach overlay against DOM fixtures; PDF and image capture |
| `npm run test:e2e` | Electron | Boots the real app and drives the real UI to files on disk, including the repair of rules after a redesign, switching between rule sets, and the data folder (moving files in from the old location) |
| `npm run test:extension` | Electron | Manifests, the *built* bundles, browser-side exports, the workspace page, and a linked folder backed by a real temporary directory |
| `npm run bench` | Electron | Reading speed and completeness against fixtures |

The fixtures in `test/fixtures/` are not decorative — each reproduces a specific
failure mode: a virtualised list that recycles messages, an unknown layout with
no useful attributes, collapsed reasoning, clamped text, a long conversation, a
redesign beside a sidebar of past chats, and the same prompt sent twice.

The end-to-end suite serves fixtures at real chat-site addresses inside the
app's browser pane (intercepting only that session), so built-in rules apply
exactly as they would on the live site.

Automated tests cannot cover the thing most likely to break: extraction from real,
frequently-redesigned provider sites. That is what [TESTING.md](TESTING.md) is for.
