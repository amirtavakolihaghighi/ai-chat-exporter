# User manual

Everything both apps can do, and how. If you read only one section, read
[Reading a chat](#2-reading-a-chat) — that is where things go wrong most.

1. [Which one should I use?](#1-which-one-should-i-use)
2. [Reading a chat](#2-reading-a-chat)
3. [Choosing what to export](#3-choosing-what-to-export)
4. [The formats](#4-the-formats)
5. [Options](#5-options)
6. [Redaction](#6-redaction)
7. [When a site is not recognised](#7-when-a-site-is-not-recognised)
8. [The library and search](#8-the-library-and-search)
9. [Merging chats](#9-merging-chats)
10. [Batch export](#10-batch-export)
11. [Right-to-left languages](#11-right-to-left-languages)
12. [Where your data lives](#12-where-your-data-lives)

---

## 1. Which one should I use?

| | Desktop app | Browser extension |
| --- | --- | --- |
| Getting a chat in | Paste a share link, or sign in inside the app | Already there — you are on the page |
| Private chats | Sign in inside the app once | Works immediately; you are already signed in |
| Where files go | Any folder you choose | Downloads only — browsers allow nothing else |
| PDF | Automatic, with page numbers | Through the print dialog |
| Full-page images | Fast and exact | Slower, stitched from screenshots |
| Batch | Unattended | Needs the browser left alone |

**Use the extension** day to day. **Use the desktop app** when you want automated
PDFs, full-page images, or a specific output folder.

Both write the same JSON, so a chat exported by one can be merged by the other.

---

## 2. Reading a chat

"Reading" means pulling the messages out of the page. Everything else depends on
it, so it is worth understanding.

**Extension** — open the chat, click the toolbar button, **Read this chat**.
**Desktop** — paste the link, **Load**, then **Read this chat**.

### The chat tab has to stay in front

This surprises people, and it is not something the app can work around.

Browsers deliberately starve background tabs: no animation frames, timers slowed
to a crawl. Chat sites redraw their message list using exactly those, so in a
background tab the page stops reacting to scrolling and the read stalls or comes
back short.

The extension therefore **brings the chat tab to the front while it reads** and
returns you to the workspace afterwards. Let it. If you switch tabs mid-read,
expect a short result.

### Why it scrolls at all

Long conversations are *virtualised*: the site deletes off-screen messages from
the page and rebuilds them when you scroll back. Reading the page once would
capture only what is on screen.

So the app checks first. If the whole conversation is already in the page — most
share links, and most chats under a few dozen messages — it reads everything at
once and finishes in about a second. Only when the page recycles messages does it
scroll the whole thread, harvesting as it goes.

Either way it then checks its own work: it looks for vertical gaps between what
it captured that are big enough to hide a message, and re-reads those. If that
finds anything on the fast path, it concludes the page does recycle after all and
does the full pass.

### If a chat comes back short

1. Compare the message count it reports against the real chat.
2. Raise **Scroll settle** to 800–1200 ms and read again.
3. If it says the read was stopped early, raise **Give up reading after**.
4. Still wrong? The site is probably unrecognised — see
   [section 7](#7-when-a-site-is-not-recognised).

---

## 3. Choosing what to export

After reading, the preview lists every message with a tick box. Untick anything
you do not want.

| Button | Does |
| --- | --- |
| **all** / **none** | Select or clear everything |
| **answers only** | Just the assistant's replies |
| **my prompts** | Just what you typed |
| **invert** | Flip the selection |

Exported messages are renumbered from 1, so the result reads as a document rather
than an extract with holes in it. Each row also says whether that message contains
reasoning or code blocks.

---

## 4. The formats

| Format | Use it for |
| --- | --- |
| **Markdown** | Notes, Obsidian, anything text-based. Fenced code keeps its language; optional YAML frontmatter. |
| **Word (.docx)** | Sharing as a document. Real OOXML — headings, lists, tables, code blocks, images, right-to-left where needed. |
| **HTML** | One self-contained file, images included, opens anywhere. |
| **Plain text** | Diffing, grepping, feeding into another tool. |
| **JSON** | Processing chats programmatically; also what the merge feature reads. |
| **Code files** | See below. |
| **PDF** | Reading and sharing. Desktop: automatic, with page numbers. Extension: opens the print dialog — choose "Save as PDF". |
| **PNG / JPEG** | When you want a picture of the conversation. |
| **ZIP** | Everything at once, with images alongside. |

### Code files

Writes every fenced code block as a real source file named by its language —
`.py`, `.ts`, `.sql`, `Dockerfile`. If a snippet opens with a path comment
(`# src/app.py`, `// utils.ts`) that name is used instead. A `README.md` alongside
lists every file with its language, line count, and source message.

The desktop app writes a folder; the extension writes a ZIP, because otherwise a
chat with twenty snippets would trigger twenty download prompts.

### PDF: the two modes (desktop only)

- **Clean document** — retypeset by the app. No site chrome, proper page breaks,
  your chosen theme and paper size.
- **As shown on the site** — a faithful capture of the page as the provider drew
  it. On a long conversation this can only include what the site currently has in
  the page, so a recycling site gives a partial capture. Clean mode has no such
  limit, being built from the full transcript.

---

## 5. Options

**Content** — include or exclude reasoning blocks, system messages, the
title/URL/date header, and YAML frontmatter.

**Images** — whether to download and embed images, and whether they go inside the
file or into a `_files` folder beside it.

Embedding matters more than it sounds: share links hand out signed URLs that stop
working after a while, so an export that merely links to them will eventually show
broken images.

**Document style** — theme (light, dark, serif), body size, a page break per
message, printing link targets after link text.

**Reading**

| Setting | What it does |
| --- | --- |
| **Scroll settle** | How long to wait for the site to redraw. Raise it for slow sites. |
| **Give up reading after** | Safety stop, so a difficult page can never hang the read. Raise it if a long chat is cut short. |
| **Screenshot step delay** | Extension only. Browsers rate-limit screen capture; below about 500 ms, frames start failing. |

**Page setup** (desktop) — paper size, margins, landscape, scale, page numbers.

---

## 6. Redaction

Find-and-replace rules applied to **every** format before anything is written.
Tick **re** to treat the pattern as a regular expression.

Each output is redacted from its own source text rather than derived from an
already-redacted one, so a secret split across markup (`sk-<em>KEY</em>`) is still
caught and the replacement never comes out escaped.

A broken regular expression is ignored rather than failing the export.

---

## 7. When a site is not recognised

The badge tells you which of three things is happening:

| Badge | Meaning |
| --- | --- |
| Green, named | A built-in rule matched this site |
| Blue, "your rule" | Your own saved rule is being used |
| Amber, "unknown site · will guess" | No rule; the layout is being inferred |

Guessing works more often than not, but check the preview.

### Pick a message by hand

This is the fix when guessing gets it wrong.

1. Click **Pick a message by hand**.
2. The page highlights whatever is under your cursor.
3. Click **one single message** — not the whole conversation, and not a paragraph
   inside a message.

It then works out a **CSS selector** matching that element *and its siblings* —
that is, all the messages — preferring stable attributes such as `data-testid`
over generated class names. It reports how many elements the selector matched,
which is your sanity check: that number should be roughly the number of messages
in the chat.

**What is saved:** one rule per website — the selector, keyed by hostname. Nothing
about the conversation itself.

| | Where |
| --- | --- |
| Desktop | `%APPDATA%\AI Chat Extractor\user-packs.json` |
| Extension | The extension's own local storage, inside your browser profile |

**Seeing and removing them:** **Options → Saved site rules**, in both products,
lists every rule you have created — site and selector — each with a **remove**
button. Removing one falls back to the built-in rule, or to guessing if there
isn't one.

Your rules take priority over the built-in ones. That is deliberate: when a
provider redesigns and the built-in rule stops working, you can repair it yourself
in about ten seconds instead of waiting for an update.

---

## 8. The library and search

Every export is indexed automatically, storing the conversation's text along with
when and where it came from. The **Library** tab searches the full text of
everything you have exported.

All words must appear somewhere in the chat, so adding a word narrows the search.
Results show the matching passage so you can tell similar chats apart.

The library stores Markdown and plain text but deliberately not the page HTML —
that would re-store every embedded image and turn a small index into a huge one.

---

## 9. Merging chats

The **Merge** tab combines several conversations into one document with a table of
contents, each chat starting on a new page.

Sources are library entries, `.json` files you exported earlier, or both. Output
as Markdown, HTML, PDF, DOCX or plain text.

---

## 10. Batch export

Paste one chat link per line and press **Run batch**. Each is opened, read,
exported with your chosen formats, and closed.

**Extension** — tabs open in the *foreground*, because a background tab is
throttled too hard to read reliably. Leave the browser alone while it runs. PDF
and images are excluded from batch, as both need attention.

**Desktop** — runs unattended.

---

## 11. Right-to-left languages

Persian, Arabic and Hebrew conversations lay out correctly in HTML, PDF and Word.

HTML and PDF set direction per message and let the browser apply the Unicode bidi
algorithm. Word has no equivalent, so every paragraph, list item and table cell is
measured and explicitly marked right-to-left where its own text calls for it.

Direction is decided by which script most of the block is in, not by its first
character — so a Persian sentence opening with an English product name still reads
right-to-left. Code blocks and inline code always stay left-to-right.

Filenames keep non-Latin characters. Invisible bidi marks are stripped, because
they are legal in text but not in filenames.

---

## 12. Where your data lives

Everything is local. Nothing is uploaded, there is no account, and neither product
makes network requests of its own — the only fetches are for images inside the
chat you are exporting.

**Desktop** — `%APPDATA%\AI Chat Extractor\`

| File | Contains |
| --- | --- |
| `settings.json` | Your options |
| `user-packs.json` | Rules created with the picker |
| `library.json` | The searchable index of exports |

Exported files go wherever you chose. Sign-in cookies for the embedded browser
live in the same folder and are cleared by **Session → Sign out of all chat
sites**.

**Extension** — your browser profile: settings and site rules in extension
storage, the library in IndexedDB. Exports go to `Downloads/AI Chat Exports/`.
Removing the extension removes all of it.
