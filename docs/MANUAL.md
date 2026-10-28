# User manual

AI Chat Extractor saves conversations with AI chat sites — ChatGPT, Claude,
Gemini and many more — as files you keep: PDF, Word, Markdown, web pages,
pictures, or a folder of code files.

This manual covers everything both versions can do, every button and every
option. You do not need to know anything about how web pages are built to use
any of it.

> **Help is always one key away.** In the app, press **F1** or the **Manual**
> button to open this manual. Press **?** (or **Shift+F1**) and then click any
> button, box or tab to see what it does.

The manual is in sixteen parts:

1. [Getting started](#getting-started)
2. [The desktop app](#the-desktop-app)
3. [The browser extension](#the-browser-extension)
4. [Reading a chat](#reading-a-chat)
5. [Site rules](#site-rules)
6. [Choosing what to export](#choosing-what-to-export)
7. [The formats](#the-formats)
8. [Options](#options)
9. [Redaction](#redaction)
10. [The library and search](#the-library-and-search)
11. [Merging chats](#merging-chats)
12. [Batch export](#batch-export)
13. [Right-to-left languages](#right-to-left-languages)
14. [Help inside the app](#help-inside-the-app)
15. [Where your data lives](#where-your-data-lives)
16. [When something goes wrong](#when-something-goes-wrong)

---

## Getting started

### Which one should I use?

There are two versions. They read chats the same way, make the same files, and
can use each other's exports and rules.

| | Desktop app | Browser extension |
| --- | --- | --- |
| Where it runs | Its own window, on Windows | Inside Chrome, Edge or Firefox |
| Getting a chat in | Paste a link, or sign in inside the app | You are already on the chat |
| Private chats | Sign in inside the app once | Work straight away |
| Where files go | Any folder you choose | Your Downloads folder |
| PDF | Made automatically, with page numbers | Through the browser's print window |
| Pictures of the whole chat | Fast and exact | Slower, pieced together from screenshots |
| Batch export | Runs on its own | Needs the browser left alone |

Use **the extension** for everyday saving. Use **the desktop app** when you want
PDFs made for you, pictures of whole chats, or files in a particular folder.

### Your first export with the desktop app

1. Copy the share link of a chat — on ChatGPT, for example, **Share → Copy link**.
2. Paste it into the long box at the top of the window and press **Load**.
3. When the chat appears, press **Read this chat** on the right.
4. Look at the result: a green line means it went well. Open **Preview and
   choose messages** to see what was read.
5. Tick the formats you want (PDF is ticked to begin with) and press **Export**.

### Your first export with the extension

1. Open the chat in your browser.
2. Click the extension's button in the toolbar (or press **Ctrl+Shift+E**).
3. Press **Read this chat**. A workspace tab opens, reads the chat and shows a
   preview.
4. Tick the formats you want and press **Export**. The files go to
   `Downloads/AI Chat Exports`.

---

## The desktop app

### The window at a glance

```text
┌──────────────────────────────────────────────────────────────────────┐
│ [AI] Chat Extractor  [ paste a link here … ] [Load]  rules-badge ? Manual │  ← top bar
├───────────────────────────────────────────┬──────────────────────────┤
│ ← → ⟳  address            −  100%  +  ⚙  │ Export | Site rules | …  │  ← tabs
│                                           │                          │
│          the chat, in a real              │   the controls for the   │
│          browser pane                     │   tab you have open      │
│                                           │                          │
├───────────────────────────────────────────┴──────────────────────────┤
│ status line — what the app is doing                                   │
└──────────────────────────────────────────────────────────────────────┘
```

- **The top bar** holds the link box, the **rules badge**, and the two help
  buttons.
- **The browser pane** on the left is a real web browser. You can click around
  in it, sign in, and scroll, exactly as in your normal browser.
- **The side panel** on the right has six tabs: Export, Site rules, Options,
  Batch, Merge and Library.
- **The status line** at the bottom always says what just happened.

**The rules badge** says how the app will read the site that is open:

| Badge | Meaning |
| --- | --- |
| Green, "built-in rules" | The app knows this site from the rules it came with |
| Blue, "your rules" | Rules you taught it, or imported, are used |
| Red, "… · broken" | The rules stopped working last time — see [When a site changes its design](#when-a-site-changes-its-design) |
| Amber, "no rules · will guess" | The app does not know this site, so it will guess where the messages are |
| Grey, "rules removed" | You removed this site's built-in rules, so the layout will be guessed. **Restore** them at the bottom of the Site rules tab, or choose a rule set of your own (rules turned off in an older version show as "rules turned off"; choose them to use them again) |

### Opening a chat

- **The link box** — paste a chat's share link, or any web address, and press
  **Enter** or **Load**. You can leave out `https://`.
- **Signing in** — load the chat site's home page (`chatgpt.com`, `claude.ai`…)
  and sign in inside the pane, just as in a browser. You stay signed in next
  time. Your own private chats can then be opened and saved without sharing
  them.
- **← and →** go back and forward a page. **⟳** reloads the page.
- **− and +** make the page smaller or larger; the number between them is the
  current size.
- **⚙** opens the browser's developer tools for the page. You only need it when
  reporting a problem.

Some sign-in methods, Google's in particular, refuse to work inside apps. If
that happens, use a share link or sign in with an email address and password.

### The Export tab

From top to bottom:

- **Read this chat** — reads every message of the chat in the pane. See
  [Reading a chat](#reading-a-chat).
- **The reading result** — the box below it, explained in
  [What the reading result tells you](#what-the-reading-result-tells-you).
- **This site** — a card showing which rules read this site and what each
  coloured part found last time, with two buttons:
  - **Show on page** draws coloured boxes over everything the rules find. See
    [Seeing rules on the page](#seeing-rules-on-the-page).
  - **Teach this site** (or **Fix these rules**) opens the teach panel on the
    page. See [Teaching a site](#teaching-a-site).
- **Preview and choose messages** — appears after a read. See
  [Choosing what to export](#choosing-what-to-export).
- **Formats** — tick every kind of file you want. See [The formats](#the-formats).
- **PDF and image style** — see below.
- **Document theme** — light, dark, or a serif style that prints well.
- **Save to** — the folder files are written to. **Browse** chooses it.
- **Filename template** — how files are named; see [Options](#options).
- **Export** — writes the files. Each format is made separately, so one failing
  does not stop the others. The list below shows each file with **open** and
  **folder** buttons.
- **Open the folder when done** — opens the export folder afterwards.

### PDF and image style

- **Clean document** — the app lays the chat out again, neatly, with your
  theme and paper size and proper page breaks. Best for reading and sharing.
- **As shown on the site** — a faithful picture of the page as the chat site
  drew it. On a very long chat this may show only part of it, because many
  sites only keep the part you are looking at loaded.

### Menus and keyboard shortcuts

| Menu | Item | What it does |
| --- | --- | --- |
| File | Open export folder | Opens the folder files are written to |
| File | Quit | Closes the app |
| View | Reload / Force reload | Restarts the app's own window (not the chat page) |
| View | Toggle developer tools | Developer tools for the app itself |
| View | Reset zoom / Zoom in / Zoom out | Size of the app's controls |
| View | Toggle full screen | Full screen on and off |
| Session | Sign out of all chat sites | Forgets every sign-in inside the app. Your files, library and rules are not touched |
| Help | User manual | Opens this manual (F1) |
| Help | What's this? | Click any control to see what it does (Shift+F1) |
| Help | About | Version number |

| Key | Does |
| --- | --- |
| Ctrl+L | Puts the cursor in the link box |
| Ctrl+E | Read this chat |
| Ctrl+S | Export |
| F1 | Open the manual |
| Shift+F1 | Turn "What's this?" on or off |
| Esc | Close the manual, leave "What's this?", or cancel the teach panel |

---

## The browser extension

### The toolbar button

Clicking the extension's button (or **Ctrl+Shift+E**) opens a small window:

- **The site line** names the site and says whether it will be read with
  built-in rules, your rules, or a guess — and warns if its rules stopped
  working last time.
- **Read this chat** opens the workspace and reads the chat straight away.
- **Read & export with last settings** does the same and then exports with the
  formats you used last time, without stopping — unless the read looks broken.
- **Library**, **Site rules**, **Workspace** and **Manual** open the workspace
  at that tab, or at this manual.

The small window closes as soon as you click elsewhere, which is why the real
work happens in the workspace tab: that stays open.

### The workspace

The workspace is a normal browser tab with the same tabs as the desktop app:
**Capture & export**, **Site rules**, **Options**, **Library**, **Merge** and
**Batch**. Everything in this manual applies to it, with these differences:

- **Files always go to `Downloads/AI Chat Exports`.** Browsers do not allow an
  extension to write anywhere else.
- **PDF** opens a print window — choose **Save as PDF** there.
- **Pictures** of a whole chat are pieced together from screenshots, so the
  chat tab is brought to the front while they are taken.
- **Attached to:** under the Read button names the chat tab the workspace
  reads. Open the workspace from the toolbar button while the chat is on
  screen to attach it.
- The **teach panel** opens on the chat tab, which comes to the front; the
  workspace comes back when you save or close the panel.

### Keeping the chat tab in front

Browsers slow background tabs down so much that chat sites stop drawing their
messages. So while it reads, the extension **brings the chat tab to the front**,
and returns you to the workspace afterwards. Let it: if you switch tabs during
a read, it may come back short.

---

## Reading a chat

"Reading" means finding every message on the page and taking it out, with who
said it. Everything else depends on it.

### How reading works

1. **Finding the messages.** The app uses the site's [rules](#site-rules) —
   which parts of the page are your messages, which are the AI's. A site with no
   rules is guessed.
2. **Scrolling.** Long chats only keep part of the conversation loaded at a
   time. If the whole chat is already in the page, it is read in about a second.
   If not, the app scrolls through it from top to bottom, collecting as it goes,
   and loads older messages at the top first.
3. **Unfolding.** Collapsed reasoning, "Show more" sections and similar are
   opened, so nothing hidden is missed.
4. **Checking its own work.** Afterwards it looks for gaps big enough to hide a
   message and reads those places again.
5. **Pictures.** Images in the chat are downloaded and put inside the export,
   because the links chat sites give out stop working after a while.

### What the reading result tells you

The box under **Read this chat** says what happened, in one of three colours:

| Colour | Meaning |
| --- | --- |
| Green, with ✓ | Read with the site's rules, and nothing looked wrong |
| Amber | Read, but check it: the layout was guessed, or something looked off |
| Red | Nothing usable was read, or the rules point at the wrong part of the page |

It also lists anything that looked wrong, in plain words — for example "Only
your messages were found, none from the AI", or "Last time you exported this
chat it had 40 messages; this read found 12". And it offers the button that
fixes it:

- **✎ Fix the rules** — opens the teach panel on the page, to fix the part that
  went wrong. See [When a site changes its design](#when-a-site-changes-its-design).
- **✎ Teach this site** — for a site with no rules: teach it once and it is
  read properly from then on.
- **Read once by guessing** — ignores the rules for this one read and guesses
  instead. Useful to get a chat out straight away; check the preview.
- **Show what they find** / **Show on page** — draws what the rules find on the
  page, so you can see what went wrong.

### If a chat comes back short

1. Compare the number of messages it reports with the real chat.
2. In **Options**, raise **Scroll settle** to 800–1200 and read again.
3. If the result says reading was stopped early, raise **Give up reading after**.
4. Still short? Press **Show on page** and look: a message without a box is one
   the rules do not find. **Fix these rules** and click it to add it.

---

## Site rules

Every chat site builds its pages differently, and changes them whenever it
likes. **Site rules** tell the app which parts of a site's pages are messages —
yours, the AI's, its reasoning — so it reads the conversation and not the menu,
the list of past chats or the buttons around it.

Rules come from three places:

- **Built-in rules** come with the app, for well-known chat sites.
- **Your rules** are the ones you teach the app by pointing at the page — which
  takes a few seconds and needs no technical knowledge.
- **Imported rules** come from a file someone exported.

A site can have **several rule sets** — the built-in one and as many of your
own as you like — and you choose which one reads it. See
[Several rule sets for one site](#several-rule-sets-for-one-site).

Rules never guess behind your back: if they stop finding the messages, the app
tells you, instead of quietly reading the wrong part of the page.

### The parts and their colours

Every kind of thing a rule can point at has its own colour. The colours are the
same everywhere: on the page, in the panel, and in the app.

| Colour | Part | What it marks | Needed? |
| --- | --- | --- | --- |
| Blue | **Your messages** | One box around each message you sent | Yes |
| Green | **AI replies** | One box around each reply from the AI | Yes |
| Purple | **Reasoning** | The AI's "thinking" block, kept apart from the answer | No |
| Red, striped | **Leave out** | Never exported: toolbars, banners, source lists, adverts | No |
| Yellow | **Message text** | Only this part of each message is kept, dropping names, avatars or times around it | No |
| Orange | **Chat title** | Where the conversation's title is | No |
| Pink | **"Show more" buttons** | Buttons pressed before reading, to unfold hidden text | No |
| Grey | **Scrolling area** | The part of the page that scrolls; found automatically | No |
| Cyan | **Messages, speaker guessed** | Messages where the app works out who is speaking by itself | No |

Every box on the page also carries a label — "You 1", "AI 2", "Reasoning" — so
colour is never the only clue.

### Seeing rules on the page

Press **Show on page** (on the Export tab, or on any card in the Site rules
tab). The app draws a coloured, labelled box around everything the rules find,
and a panel appears on the page:

- **The list of parts** says how many of each were found. A red **0 ⚠** next to
  "Your messages" or "AI replies" means that part finds nothing here.
- **Reading this page would give** shows the first few messages exactly as a
  read would take them, marked You or AI.
- **Warnings** say in words what looks wrong.
- **✎ Fix these rules** switches to teaching. **Close** puts the page back as it
  was.

Showing rules changes nothing and saves nothing.

### Teaching a site

Press **Teach this site** (or **Fix these rules**). A panel opens over the chat.

**If the app makes a first guess.** On a site with no rules, the app looks at
the page and proposes rules straight away: blue boxes around what it thinks are
your messages, green around the AI's. Most of the time it is right. Check the
colours, and if they are right, press **Save rules**. That's it.

**If something is wrong, point at it:**

1. In the panel, click the part you want to set — **Your messages**, say.
2. Click one of your messages on the page. While you move the mouse, a dashed
   box shows what a click would pick.
3. Every message that looks like it starts **flashing**, and the panel says how
   many it found.
4. If the flashing box is too small (only a paragraph) press **▲ Bigger**; if it
   is too big (several messages in one box) press **▼ Smaller**. The **↑** and
   **↓** keys do the same.
5. Press **✓ Add** (or **Enter**).
6. Do the same for **AI replies**. The panel moves on to it by itself.
7. Check **Reading this page would give**, then press **Save rules**.
8. A last step, **Save these rules**, opens at the top of the panel. Check it
   and press **✓ Save these rules** (or **Enter**). **Back** (or **Esc**)
   returns to the rules.

**The last step** asks:

- **Name for these rules** — a name is filled in for you ("My ChatGPT", say).
  Change it if you keep more than one rule set for a site, such as "ChatGPT —
  work account".
- If you are fixing a rule set of your own, choose between **changes to "…"**
  (update that rule set) and **a new rule set, keeping that one as it is**.
  Built-in rules are never changed: fixing them always saves a new rule set of
  your own.
- **Where on the site** — shown on pages deeper than the site's front page:
  the whole site, or only pages like this one. Many sites have different
  layouts for shared links and for your own chats, and this lets each have its
  own rules.
- **Use them for … from now on** — ticked, the site is read with these rules
  from now on. Untick it to keep them for later without changing which rules
  read the site; choose them any time in the Site rules tab.

After saving, the app reads the chat again with the new rules, so you see the
result straight away.

**More tools in the panel:**

- **More parts** — shows the optional parts: Reasoning, Leave out, Message
  text, Chat title, "Show more" buttons, Scrolling area.
- **Leave out** — point at anything that should never be exported, such as a
  sidebar or a "sources" list. Its boxes are striped red. Anything inside them
  is dropped, and messages inside them are ignored.
- **Ways** — each time you add, the part gets another "way" of finding things.
  If some messages look different and have no box, just click one of them: it
  is added as another way. Hover over a way to see only its boxes; **×**
  removes it.
- **✦ Guess for me** — asks the app to propose rules for this page.
- **↶ Undo** (or **Ctrl+Z**) — takes back the last change.
- **✋** — pauses picking, so you can use the page normally (to scroll a list
  or open a section). Press **▶** to carry on.
- **✕** or **Esc** — cancel. If you changed something, it asks first.
- The panel can be dragged by its title bar if it covers part of the chat.

If you click something that looks like the other speaker's — an AI reply while
setting "Your messages" — the panel says so, and offers to add it to the right
part instead.

### When a site changes its design

Chat sites redesign often. When that happens, the rules that used to find the
messages find nothing. The app then:

- says so in red: **"The built-in rules for ChatGPT found no messages on this
  page. The site may have changed its design."** (or **"Your rules "…" found
  no messages…"**) — instead of guessing and reading the wrong thing;
- marks the rules as broken: a red badge, and a red dot in the Site rules tab.

To fix it, press **✎ Fix the rules**. The panel notices the old rules find
nothing and makes a **new guess for the new layout** — usually right first
time. Check the colours and press **Save rules**. The old rules are one
**Undo** away if you need them.

Fixing built-in rules never changes the built-in ones: it saves **a rule set
of your own** ("My ChatGPT"), which is used from then on. The built-in rules
stay in the list — **↺ Back to the built-in rules** returns to them.

If you just need the chat now, **Read once by guessing** reads it without the
rules, this once.

### The Site rules tab

One card for every site the app has rules for. Sites with rule sets of your own
are listed first, under **Sites with rules of your own**; the rest under
**Other sites the app knows**.

At the top:

- **The colour key** — what each colour means. **What each colour means**
  opens a short explanation of each.
- **Find a site** — shows only the cards whose name or site contains what you
  type.
- **Import…** and **Export…** — see [Importing and exporting rules](#importing-and-exporting-rules).

**Each site's card** has the site's name and addresses at the top, and one
row for each of its rule sets — the built-in one first, then yours. The row
with the **green edge** and the **In use** tag is the one that reads the site.

**On each row:**

- **The round button** — chooses this rule set for the site. See
  [Several rule sets for one site](#several-rule-sets-for-one-site).
- **The dot** — green: worked last time. Amber: worked, but worth a look. Red:
  broken. Grey: not checked yet.
- **The name and sites** it covers, and "only … pages" if it is limited to
  part of a site. Rule sets limited to part of a site have no round button:
  they are always used on their own pages.
- **Tags** — **In use**, **Yours**, **Built-in**, **Built-in ✓** (checked
  against a real chat by the developers) or **Old picker** (made with the old
  one-click tool; see [Rules from older versions](#rules-from-older-versions)).
- **The coloured chips** — the parts the rules use, with how many each found
  in the last read.
- **The health line** — when the rules last worked, and what they found, or
  what went wrong.
- **Show on page** and **✎ Fix** — appear when the chat that is open belongs to
  that site. Otherwise the row says which site to open first.
- **More ▾** opens the rest:
  - Your rule sets: **Rename**, **Make a copy**, **Export**, **Delete**.
  - Built-in rules: **Make a copy**, **Export**, **Remove**.
  - **Technical details** — the exact page selectors behind each part, for
    people who know web pages. Yours can be edited there; built-in ones are
    read-only. Most people never need this.

Below the rows, **↺ Back to the built-in rules** appears when the site is read
with one of your rule sets.

The card for the site that is open comes first, with a blue outline and the tag
**Open now**.

### Several rule sets for one site

A site can have several rule sets: the built-in one, and any number of your
own. Exactly one of them reads the site — the one marked **In use**. This lets
you keep, say, one rule set for the site's old layout and one for the new, or
one for your work account and one for home, and switch between them in a
click.

- **Choose which one reads the site** — press the round button on its row in
  the Site rules tab, or pick it under **Rules to use** on the "This site"
  card (shown when the open site has more than one). Then read the chat again.
- **Back to the built-in rules** — **↺ Back to the built-in rules** on the
  site's card. Your own rule sets are kept; choose one again any time.
- **Make a new rule set** — **More ▾ → Make a copy** on any row starts a new
  rule set of your own from that one, without using it yet. Press **✎ Fix** on
  it to change it, then choose it. Or teach the site and pick **a new rule
  set** when saving (see [Teaching a site](#teaching-a-site)).
- **Your own rule set as the default** — whichever one you choose stays the
  default for the site until you choose another. Exported rule sets remember
  whether they were the default, and an imported default becomes the default
  in the app it is imported into.

### Built-in rules

The app comes with rules for ChatGPT, Claude, Gemini, DeepSeek, Grok, Microsoft
Copilot, Perplexity, Poe, Qwen, Le Chat (Mistral), Kimi and GapGPT, and for
LibreChat, Open WebUI and similar front-ends.

They are a good start, not a promise: these sites change their pages often.
You can:

- **use a rule set of your own instead** — press **Fix**, which saves your
  changes as a new rule set and uses it, or **Make a copy** to start one;
- **go back to them** any time with **↺ Back to the built-in rules**;
- **remove** them altogether. Removed built-in rules are listed at the bottom of
  the tab under **Removed built-in rules**, where **Restore** or **Restore all**
  brings them back exactly as they shipped.

### Importing and exporting rules

Rules can be saved to a file and loaded into either app:

- **Export…** saves all your rules. **Export** on a single card saves just that
  one. The desktop app asks where to save; the extension saves to
  `Downloads/AI Chat Exports`.
- **Import…** adds the rules in a file. Nothing you already have is changed:
  imported rules are added, rules you already have are skipped, and anything
  unreadable is left out — the status line says how many of each.

Use it to move rules between the desktop app and the extension, to keep a
backup, or to share a fix with someone whose app has the same problem.

A rules file only says which parts of a page are messages. It never contains
any of your conversations.

### Rules from older versions

Older versions had a one-click picker that saved a single rule per site. Those
rules are converted the first time this version starts, and show up in the Site
rules tab tagged **Old picker**. They read exactly as they did before.

The old picker could only find one kind of message, which is why picking your
own messages used to read only your messages. Press **Fix** on a chat from that
site to point at both speakers.

The old rules file is left untouched as a backup.

---

## Choosing what to export

After a read, **Preview and choose messages** lists every message, in order,
with a tick box. The coloured stripe on the left says who sent it — blue for
you, green for the AI — and the label says whether it contains reasoning or
code.

Untick anything you do not want. The quick buttons:

| Button | Does |
| --- | --- |
| **all** / **none** | Tick or clear everything |
| **answers only** | Only the AI's replies |
| **my prompts** | Only your messages |
| **invert** | Swap ticked and unticked |

Exported messages are numbered again from 1, so the file reads as a whole
document rather than an extract with gaps.

---

## The formats

| Format | Use it for |
| --- | --- |
| **PDF** | Reading and sharing. Desktop: made for you, with page numbers. Extension: through the print window — choose "Save as PDF". |
| **Markdown** | Notes apps such as Obsidian, and anything text-based. Code keeps its language. |
| **Word .docx** | A document you can edit — headings, lists, tables, code and pictures included, right-to-left where needed. |
| **HTML** | One web page file, pictures included, that opens anywhere. |
| **Plain text** | Searching, comparing, or pasting somewhere else. |
| **JSON** | For programs; also what [Merging chats](#merging-chats) reads. |
| **PNG / JPEG image** | A picture of the conversation. Very long chats are split into numbered parts. |
| **Code files** | Every code snippet in the chat as its own file — see below. |
| **ZIP** | Everything at once, with pictures alongside. |

### Code files

Each code block in the chat becomes a real file named after its language —
`.py`, `.js`, `.sql`, `Dockerfile`. If a snippet starts with a file name
comment (`# app.py`, `// utils.ts`), that name is used. A `README.md` beside
them lists every file, its language, its length and which message it came from.

The desktop app writes a folder; the extension writes a ZIP, so a chat with
twenty snippets does not start twenty downloads.

---

## Options

### Content

- **Include reasoning / thinking blocks** — keeps the AI's reasoning, set apart
  from its answer.
- **Include system & tool messages** — keeps messages that are neither yours nor
  the AI's answer, such as tool output.
- **Include title, source URL and date** — a short header at the top of the file.
- **YAML frontmatter in Markdown** — a block of properties that note apps such
  as Obsidian read.

### Images

- **Download and embed images** — saves the pictures themselves. Chat sites'
  picture links expire, so without this, pictures eventually stop showing.
- **Where images go** — inside the file (one self-contained file), or beside it
  in a `_files` folder.

### Page and document style

**Page setup (PDF)** — desktop app: paper size, margin, scale, body text size,
landscape, page numbers, background colours.

**Document style** — theme, body text size, **Start every message on a new page**
and **Print link targets after link text** (useful on paper).

### Reading

| Setting | What it does |
| --- | --- |
| **Scroll settle** | How long to wait for the site to redraw after each scroll. Raise it for slow sites. |
| **Give up reading after** | A safety stop, so a difficult page can never make a read run forever. Raise it if a very long chat is cut short. |
| **Screenshot step delay** | Extension only. Browsers limit how fast screenshots can be taken; below about 500 ms, picture exports lose pieces. |
| **JPEG quality** | Sharper and larger, or smaller and softer. 90 is a good balance. |

### Files

**Code files** (extension) — **Ignore snippets shorter than** a number of lines,
and **Only take code from the assistant's replies**.

**Filename template** — how files are named. Words in curly brackets are filled
in:

| Token | Becomes |
| --- | --- |
| `{title}` | The chat's title |
| `{provider}` | The chat site's name |
| `{host}` | The site's address, such as chatgpt.com |
| `{date}` / `{time}` | When it was exported |
| `{count}` | The number of messages |
| `{id}` | A short unique code |

**Privacy** — desktop app: **Sign out of all chat sites** forgets every sign-in
inside the app. Your files, library and rules stay.

---

## Redaction

Find-and-replace rules applied to **every** format before anything is saved —
for removing names, keys or addresses from a chat you are about to share.

- **Add a rule** adds a row: what to find, and what to put instead (normally
  `[redacted]`).
- Tick **re** to treat what to find as a regular expression (a pattern), such
  as `sk-[A-Za-z0-9]+` for API keys.
- **×** removes a row.

Each format is redacted from the original text, so a secret is caught even when
the page split it with formatting. A broken pattern is ignored rather than
stopping the export.

---

## The library and search

Every export is remembered in the **Library**, with its text, so you can find
it again later.

- **Search** finds chats by any words in them. Every word must appear somewhere
  in the chat, so adding a word narrows the search. Each result shows the
  passage that matched.
- **open** / **folder** (desktop) open the exported file or show it in its
  folder. **reload chat** loads the original chat again. **open chat**
  (extension) opens it in a new tab; **remove** forgets one entry.
- **Open export folder** (desktop) opens the folder files are written to.
- **Clear library** forgets every entry. The exported files themselves are not
  touched.

The library keeps the text of each chat, but not its pictures, so it stays small.

---

## Merging chats

The **Merge** tab combines several chats into one document with a table of
contents, each chat starting on a new page.

1. Give the document a **title**; it is also used for the file name.
2. Tick chats from your library, and/or press **Add .json files…** to add chats
   exported earlier as JSON — by either app.
3. Tick the formats: PDF, Markdown, Word, HTML or plain text.
4. Press **Merge**.

**Clear selection** unticks everything.

---

## Batch export

Export many chats in one go:

1. On the **Batch** tab, paste one chat link per line.
2. Choose formats on the first tab as usual.
3. Press **Run batch**. Each link is opened, read, exported and logged.
   **Stop** ends it after the current chat.

So that nothing is exported from a guess nobody checked:

- **A site with no rules is skipped**, and the log says so — unless you tick
  **Also export sites that have no rules**. Exports made by guessing are marked
  "layout guessed" in the log.
- **Rules that find nothing, or point at the wrong part of the page, are
  skipped** too, with the reason. Fix them in the Site rules tab and run the
  batch again.
- Rules that worked but looked off are exported, marked with ⚠ and the reason.

The last line counts what was exported, skipped and failed.

**Extension:** tabs open in the front, because a background tab is slowed down
too much to read reliably — leave the browser alone while it runs. PDF and
pictures are left out of batch runs, as both need the screen.

---

## Right-to-left languages

Persian, Arabic and Hebrew chats come out right-to-left in HTML, PDF and Word.
Direction is decided by which script most of each paragraph is in, so a
Persian sentence that starts with an English product name still reads
right-to-left. Code always stays left-to-right. File names keep their Persian,
Arabic or Hebrew letters.

---

## Help inside the app

- **Manual** (top right) or **F1** opens this manual inside the app. The list on
  the left jumps to any section; the search box finds every section containing
  all the words you type.
- **?** or **Shift+F1** turns on **What's this?**. Every control gets a dashed
  outline; click any of them to see what it does, with a link to the right part
  of this manual. While it is on, clicking explains instead of doing anything.
  Press **Done**, **?** or **Esc** to leave it.
- Most buttons also explain themselves when you rest the mouse on them.

---

## Where your data lives

Everything stays on your computer. Nothing is uploaded, there is no account,
and neither version makes requests of its own — the only things fetched are the
pictures inside the chat you are exporting.

### The data folder (desktop app)

The desktop app keeps what it writes in one **data folder**, with a folder
inside it for each kind of file:

| Folder | Holds |
| --- | --- |
| `settings` | `settings.json` — the options you changed, and only those |
| `rules` | `site-rules.json` — your site rules, and your choices about the built-in ones. Exported rule files are suggested here too |
| `library` | `library.json` — the searchable list of your exports |
| `exports` | Exported chats, unless **Save to** points somewhere else. Not in the installed app, which saves them in `Documents\AI Chat Exports` |

A `README.txt` in the folder says the same. Where the data folder is:

- **Running from the project** (`npm start`): the `data` folder inside the
  project folder. It is listed in `.gitignore`, so your chats and rules are
  never committed.
- **The portable app**: a folder called `AI Chat Extractor data` beside the
  `.exe`, so the app and its files move together.
- **The installed app**: `%APPDATA%\AI Chat Extractor\data`. Not the folder
  the app is installed in: every update replaces that one. That folder is
  hidden, so the installed app saves exports in `Documents\AI Chat Exports`,
  where you can find them.

**Options → Where your files are kept** shows the folder; click a row to open
that part of it. **File → Open data folder** opens it too.

**Not in the data folder:** sign-ins to chat sites and the built-in browser's
cache. They stay in Windows' app-data folder (`%APPDATA%\AI Chat Extractor`).
The browser locks them while the app runs; they hold live sign-ins, which
should never end up in a folder you might share, zip up or commit; and the
cache grows to hundreds of megabytes. **Session → Sign out of all chat sites**
clears them.

**Upgrading from an older version.** Older versions kept their files directly
in `%APPDATA%\AI Chat Extractor`. The first time this version starts, it copies
them into the data folder — copies, never moves: the old files stay where they
were, as a backup. Run from the project or as the portable app, new exports go
to the `exports` folder rather than `Documents\AI Chat Exports`; chats you
exported before stay where they are. The installed app keeps saving them in
`Documents\AI Chat Exports`. Choose any folder under **Save to** to change
that.

### Moving the data folder

**Options → Where your files are kept → Change…** picks another folder — on
another drive, say, or a synced one. The app copies your settings, rules and
library there and uses it from the next start (it offers to restart now). The
old folder is left exactly as it was. If the folder you pick already has the
app's files in it, the app uses those instead and copies nothing over them.

**Use the default** goes back to the default folder in the same way.

### A folder for the extension

The extension keeps your options and site rules in the browser's own storage,
the library in the browser's database, and saves exports to
`Downloads/AI Chat Exports/`. Browsers do not let an extension write anywhere
else on its own — but in **Chrome and Edge** you can give it a folder:

1. In the workspace, open **Options → Where your files are kept**.
2. Press **Choose a folder…** and pick a folder — the desktop app's data
   folder is the natural choice.
3. The browser asks whether the extension may edit files there. Allow it.

From then on, the extension keeps in that folder:

| Folder | Holds |
| --- | --- |
| `settings` | `extension-settings.json` — the options you changed, and only those |
| `rules` | `site-rules.json` — the same file the desktop app uses, so both share one set of site rules. Exported rule files go here too |
| `exports` | Exported chats. PDFs are the exception: you choose where in the print dialog |

The browser's copy stays the working copy, and the two are kept in step: when
the workspace opens or comes back into view, anything the desktop app changed
in the folder is taken in, and every change you make is written there. If both
changed the rules since they were last the same, both sets of changes are kept.

After the browser restarts it asks once more: the card shows the folder in
amber, **waiting for your permission**. Press **Allow access again**. Until you
do, changes stay in the browser and exports go to Downloads.

**Stop using it** stops writing to the folder. The folder and its files are left
as they are.

**Firefox** cannot give extensions a folder. There, **Export…** in Site rules
saves your rules as a file you can keep in the project folder.

Removing the extension removes what it keeps in the browser — options, rules
and library — but never the folder. Export your rules first if you have not
linked a folder.

### Default options and your changes

The options both apps start with are in `config/default-settings.json` in the
project folder: one section for what both apps share, one for each app. Change
a value there to change the default — for example `"theme": "dark"`. A value of
the wrong kind is ignored, and if the file is missing the app uses its own
built-in defaults.

Your own settings files hold only the options you changed. So when a default
changes, you get the new default — unless you had changed that option yourself.

**Reset all options to defaults** (Options) puts every option back. Your rules,
library and exported chats are not touched. In the desktop app the settings as
they were are kept beside the new file, as `settings.before-reset-….json`.

---

## When something goes wrong

| What you see | What to do |
| --- | --- |
| Red: "… rules … found no messages on this page" | The site changed. **✎ Fix the rules** — see [When a site changes its design](#when-a-site-changes-its-design) |
| Amber: "the layout was guessed" | Check the preview. If it is wrong, **✎ Teach this site** |
| "Only your messages were found" (or only the AI's) | One part's rule is missing or broken. **✎ Fix the rules**; the panel starts on the missing part |
| "Most of what was read is in the site's menu" | The rules point at the sidebar. **Fix** them, and use **Leave out** on the sidebar |
| The chat comes back short | See [If a chat comes back short](#if-a-chat-comes-back-short) |
| Pictures missing in the file | Make sure **Download and embed images** is ticked |
| Extension: read comes back short | Do not switch tabs while it reads |
| Google sign-in refused in the desktop app | Use a share link, or an email and password |

The project's `docs/TROUBLESHOOTING.md` covers more cases, and how to report a
problem with a site so it can be fixed for everyone.
