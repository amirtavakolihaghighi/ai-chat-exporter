# Test scenarios

A checklist for testing the app by hand. The automated suites (`npm test`,
`npm run test:electron`, `npm run test:e2e`) cover the internals against local
fixtures; what they **cannot** cover is the thing that matters most — whether
extraction still works against the real, live, frequently-redesigned websites.
That is what this document is for.

Work top to bottom. Sections 1–3 are the core; if those pass the app is usable.

**New in site rules:** sections [11](#11-site-rules) (site rules on real sites),
[18](#18-help-inside-the-app) (help), 12.7–12.9 (batch), 16.21 and 16.26–16.35
(extension) and 17.16–17.17 (regressions). Of those, 11.1–11.5 and 11.19–11.23
matter most: they are the problem this release exists to fix.

**New since then:** [11F](#11f-several-rule-sets-for-one-site) (several rule sets
for one site, and the last step of saving), [19](#19-where-your-files-are-kept)
(the data folder), 16.36–16.45 (the extension's folder) and 17.18–17.22 (file
names, line breaks). For the problems you reported, 17.18–17.21 come first.

**Before you start**

- Run `npm start` from the project folder, or launch the built .exe.
- Set **Export → Save to** to an empty folder you can inspect and delete.
- Have a few real share links ready, ideally one short chat and one long one
  (40+ messages), plus one containing code, one containing images, and one in
  Persian if you export Persian chats.

Legend: ⬜ not tested · ✅ works · ❌ broken (note what happened)

---

## 1. Loading a chat

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 1.1 | Paste a ChatGPT share link, press **Load** | Chat renders in the left pane | ⬜ |
| 1.2 | Paste a link without `https://` (`chatgpt.com/share/…`) | Still loads; the scheme is added | ⬜ |
| 1.3 | Paste a Claude share link | Loads; badge shows **Claude** in green | ⬜ |
| 1.4 | Paste a Gemini / DeepSeek / Grok / Copilot / Perplexity / Poe / Qwen / Le Chat / Kimi link | Loads; badge names the provider | ⬜ |
| 1.5 | Paste a GapGPT (or other proxy) link | Loads; badge shows either the clone pack or "unknown site · will guess" | ⬜ |
| 1.6 | Paste a nonsense URL | Status bar reports the load failure; app stays responsive | ⬜ |
| 1.7 | Use back / forward / reload buttons | Navigate as in a browser | ⬜ |
| 1.8 | Use the zoom −/+ buttons | Page scales; percentage updates | ⬜ |
| 1.9 | Click a link inside the loaded chat | Navigates inside the pane, not in your system browser | ⬜ |

## 2. Reading a chat

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 2.1 | Press **Read this chat** on a short chat | Green ✓ result: message and character count, and which rules read it | ⬜ |
| 2.2 | Open **Preview and choose messages** | One row per message, correct speaker labels, right order | ⬜ |
| 2.3 | **Read a long chat (40+ messages)** — the important one | Count matches the real chat. Scroll the site yourself and count if unsure | ⬜ |
| 2.4 | Read a chat with a reasoning / "thinking" block | Rows show "has reasoning"; the reasoning is not mixed into the answer | ⬜ |
| 2.5 | Read a chat containing code | Rows show "N code blocks" | ⬜ |
| 2.6 | Read a chat containing images | Status reports how many images were embedded | ⬜ |
| 2.7 | Read a chat with maths | Preview shows `$…$` LaTeX, not broken glyphs | ⬜ |
| 2.8 | Read a page that is not a chat at all | Either nothing found (clear message) or obvious junk in the preview — no crash | ⬜ |
| 2.9 | Read while the app window is minimised | Same message count as when visible | ⬜ |
| 2.10 | Read a chat on a site with no rules | Amber result: "the layout was guessed"; a **Teach this site** button | ⬜ |
| 2.11 | Read a chat you exported before, after deleting most of it on the site | Result warns "Last time you exported this chat it had N messages" | ⬜ |

> If 2.3 comes up short, raise **Options → Scroll settle** to 800–1200 ms and
> read again. Report the before/after numbers — that difference is the useful
> diagnostic.

## 3. Exporting

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 3.1 | Export **PDF** (clean) | Opens; selectable text; page numbers in the footer | ⬜ |
| 3.2 | Export **Markdown** | Frontmatter, `## speaker` headings, fenced code with language | ⬜ |
| 3.3 | Export **Word .docx** | Opens in Word; headings, lists, tables, code blocks intact | ⬜ |
| 3.4 | Export **HTML** | Opens in a browser; images visible with no network connection | ⬜ |
| 3.5 | Export **Plain text** | Readable; no HTML tags | ⬜ |
| 3.6 | Export **JSON** | Valid JSON; `messages` array complete | ⬜ |
| 3.7 | Export **PNG** | Whole conversation, not just the visible part | ⬜ |
| 3.8 | Export **JPEG** | Same, smaller file | ⬜ |
| 3.9 | Export **ZIP** | Contains html, md, txt, json, pdf and an `_files` image folder | ⬜ |
| 3.10 | Tick every format at once | All produced; results list shows each file | ⬜ |
| 3.11 | Export a very long chat as PNG | Split into "part 1/2/…" tiles with a note saying so | ⬜ |
| 3.12 | Click **open** and **folder** on a result | Opens the file / reveals it in Explorer | ⬜ |
| 3.13 | Export the same chat twice | Second run adds " (2)"; the first file is not overwritten | ⬜ |
| 3.14 | Switch to **As shown on the site**, export PDF | Looks like the website | ⬜ |
| 3.15 | Export with **Open the folder when done** ticked | Explorer opens afterwards | ⬜ |

## 4. Choosing messages (per-message selection)

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 4.1 | Untick two messages, export Markdown | Those two are absent; the rest are present | ⬜ |
| 4.2 | Click **answers only** | Only assistant rows ticked; counter reads "N of M messages" | ⬜ |
| 4.3 | Click **my prompts** | Only your messages ticked | ⬜ |
| 4.4 | Click **invert** | Selection flips | ⬜ |
| 4.5 | Click **none** | Export button greys out | ⬜ |
| 4.6 | Click **all** | Counter returns to "all N messages" | ⬜ |
| 4.7 | Untick some, then toggle an Options checkbox | Your selection survives; it is not silently reset | ⬜ |
| 4.8 | Select a subset, export PDF and DOCX | Both contain exactly the chosen messages, renumbered from 1 | ⬜ |

## 5. Code extraction

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 5.1 | Export **Code files** from a chat with several snippets | A `<name>_code` folder appears | ⬜ |
| 5.2 | Inspect the extensions | `.py`, `.js`, `.sql` etc. match the languages | ⬜ |
| 5.3 | Open `README.md` in that folder | Table listing every file, language, line count and source message | ⬜ |
| 5.4 | Snippet that starts with a path comment (`# src/app.py`) | File named after that path | ⬜ |
| 5.5 | Run one of the extracted files | Runs as-is; no stray markdown fences | ⬜ |
| 5.6 | Export code from a chat with no code | Note saying no code blocks were found; no empty folder litter | ⬜ |

## 6. Library and search

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 6.1 | Export a few chats, open **Library** | All listed, newest first | ⬜ |
| 6.2 | Search a word you know is in one chat | That chat appears with a snippet showing the match | ⬜ |
| 6.3 | Search two words from different parts of one chat | Still found (all terms must match) | ⬜ |
| 6.4 | Add a word that appears in no chat | No results | ⬜ |
| 6.5 | Search a Persian or non-Latin word | Found | ⬜ |
| 6.6 | Clear the search box | Full list returns | ⬜ |
| 6.7 | **open** / **folder** / **reload chat** on a library row | Opens the export / reveals it / reloads the original chat | ⬜ |
| 6.8 | **Clear library**, then reopen the tab | Empty; the exported files on disk are untouched | ⬜ |

## 7. Merging

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 7.1 | Tick three library chats, merge to Markdown | One file, contents list, all three chats | ⬜ |
| 7.2 | Click a contents entry in the merged HTML | Jumps to that conversation | ⬜ |
| 7.3 | Merge to PDF | Each conversation starts on a new page | ⬜ |
| 7.4 | Merge to DOCX | Contents list; page break per chat; opens cleanly in Word | ⬜ |
| 7.5 | **Add .json files…** and pick earlier JSON exports | Appear in the list as dashed "from file" rows | ⬜ |
| 7.6 | Mix library chats and .json files in one merge | All included | ⬜ |
| 7.7 | Pick a .json that is not a chat export | Clear error; nothing crashes | ⬜ |
| 7.8 | Change the document title, merge again | Title used in the document and the filename | ⬜ |
| 7.9 | **Clear selection** | Merge button greys out | ⬜ |

## 8. Right-to-left (Persian / Arabic / Hebrew)

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 8.1 | Export a Persian chat as HTML | Text reads right-to-left, correctly aligned | ⬜ |
| 8.2 | Same chat as PDF | Same | ⬜ |
| 8.3 | Same chat as DOCX, open in Word | Paragraphs right-aligned and right-to-left | ⬜ |
| 8.4 | A Persian chat containing code | Prose is RTL; code blocks stay left-to-right and readable | ⬜ |
| 8.5 | A Persian message that starts with an English word | Whole paragraph still reads RTL | ⬜ |
| 8.6 | An English message containing one Persian word | Stays left-to-right | ⬜ |
| 8.7 | A Persian chat title | Title displays correctly; filename is usable | ⬜ |
| 8.8 | Persian bullet lists and tables in DOCX | Bullets and columns on the correct side | ⬜ |

## 9. Options

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 9.1 | Untick **Include reasoning**, export | Thinking blocks absent | ⬜ |
| 9.2 | Untick **Include title, source URL and date** | Header block absent | ⬜ |
| 9.3 | Untick **YAML frontmatter**, export Markdown | No `---` block at the top | ⬜ |
| 9.4 | Untick **Download and embed images**, export HTML | Faster; images reference remote URLs | ⬜ |
| 9.5 | Set images to **beside the file**, export HTML | `_files` folder next to the .html | ⬜ |
| 9.6 | Change paper to Letter / margin / landscape, export PDF | Applied | ⬜ |
| 9.7 | Tick **Start every message on a new page**, export PDF | One message per page | ⬜ |
| 9.8 | Tick **Print link targets after link text** | URLs printed after links | ⬜ |
| 9.9 | Change theme to Dark / Serif, export PDF | Styling changes | ⬜ |
| 9.10 | Change the filename template to `{provider} - {title}` | Filenames follow it | ⬜ |
| 9.11 | Restart the app | Every option above is remembered | ⬜ |

## 10. Redaction

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 10.1 | Add a literal rule for a word in the chat, export all formats | Replaced everywhere — md, html, txt, json, docx, pdf | ⬜ |
| 10.2 | Check the marker text | Shows as `[redacted]`, not `\[redacted\]` | ⬜ |
| 10.3 | Add a regex rule (e.g. `sk-[A-Za-z0-9]+`) with **re** ticked | Matches replaced | ⬜ |
| 10.4 | Enter a deliberately broken regex | Export still succeeds; no crash | ⬜ |
| 10.5 | Remove a rule with **×** | Gone after restart | ⬜ |

## 11. Site rules

These need the real sites: the automated suites can only use local copies of
pages, which cannot show whether the built-in rules still fit the live ones. Do
them on the sites you actually use — ChatGPT first. Also look at how things
*look*: colours readable, labels not covering the text, the panel usable on a
small screen and on sites with a dark theme.

### 11A. Reading with built-in rules

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.1 | Load a ChatGPT chat — a share link, or one of your own while signed in | Badge green "ChatGPT · built-in rules"; the **This site** card shows coloured chips | ⬜ |
| 11.2 | Read it | Green ✓ result "read with the built-in rules for ChatGPT"; the count matches the chat | ⬜ |
| 11.3 | Press **Show on page** | Blue boxes "You 1, You 2…" around your messages, green "AI 1…" around the replies, none on the sidebar; panel counts match | ⬜ |
| 11.4 | Close the panel | Page back to normal; the card's chips show the counts | ⬜ |
| 11.5 | Repeat 11.1–11.3 on Claude, Gemini and every other site you use | Same — note any site where the boxes are wrong | ⬜ |

### 11B. Teaching a site the app does not know

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.6 | Load a chat on a site with no rules (a LibreChat or Open WebUI instance, or any other chat site) | Badge amber "no rules · will guess"; the card suggests teaching | ⬜ |
| 11.7 | Press **Teach this site** | Panel opens on the page: "I made a first guess", blue and green boxes | ⬜ |
| 11.8 | If the colours are right, press **Save rules**, then **✓ Save these rules** in the last step | Chat read again by itself; green ✓ "read with your rules "…""; badge blue | ⬜ |
| 11.9 | If not: choose **Your messages**, click one of your messages | Those messages flash; "N boxes found like this" | ⬜ |
| 11.10 | Press **▲ Bigger** and **▼ Smaller**, then the ↑ and ↓ keys | The flashing boxes grow and shrink a level at a time | ⬜ |
| 11.11 | **✓ Add**, then click one of the AI's replies | The panel moved on to **AI replies** by itself; the reply is added | ⬜ |
| 11.12 | With **Your messages** chosen, click an AI reply | The panel says it looks like an AI reply and offers to add it there instead | ⬜ |
| 11.13 | **More parts → Leave out**, click the sidebar | Striped red box; the preview no longer contains sidebar text | ⬜ |
| 11.14 | **↶ Undo**, **✦ Guess for me**, **✋** | Undo takes the last change back; Guess replaces the message parts with a proposal; ✋ lets you click the page normally until ▶ | ⬜ |
| 11.15 | Press Esc after changing something | Asks before throwing the changes away | ⬜ |
| 11.16 | Drag the panel by its title; scroll the page | The panel moves; the boxes stay on their messages | ⬜ |
| 11.17 | Teach on a site where some messages look different (a picture reply, an attachment) | Clicking an unboxed one adds a second "way"; hovering a way shows only its boxes | ⬜ |
| 11.18 | Save with **Where on the site: only pages under …/share/…**, then open a non-share chat on the same site | The share-page rules are not used there; their card says "only /share/… pages" | ⬜ |

### 11C. When a site changes its design — the ChatGPT problem

A real redesign cannot be summoned on demand, so simulate one by breaking your
own copy of the rules:

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.19 | **Site rules → ChatGPT → More ▾ → Make a copy** on the built-in row, then press the copy's round button to use it. On the copy: **More ▾ → Technical details**, replace the "Your messages" and "AI replies" lines with `.nothing-here`, delete the "Messages, speaker guessed" line, **Save changes** | Saved | ⬜ |
| 11.20 | Read a ChatGPT chat | Red result "Your rules "ChatGPT (copy)" found no messages… may have changed its design" with three buttons; badge red "broken"; **nothing from the list of chats is offered for export** | ⬜ |
| 11.21 | **Read once by guessing** | Amber result; the preview holds the conversation, not the list of chats | ⬜ |
| 11.22 | **✎ Fix the rules** | Panel: "The old rules find nothing… I made a new guess", boxes on the real messages | ⬜ |
| 11.23 | **Save rules → ✓ Save these rules** | Read again by itself; green ✓; the card's dot turns green | ⬜ |
| 11.24 | Do 11.19–11.22 again, but press **↶ Undo** in the panel | The broken ways come back | ⬜ |
| 11.25 | Tidy up: **↺ Back to the built-in rules** on the ChatGPT card, then **More ▾ → Delete** on the copy | Built-in rules used again; the copy gone | ⬜ |

### 11D. The Site rules tab

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.26 | Open **Site rules** | Colour key at the top; **Sites with rules of your own**, then **Other sites the app knows**; one card per site, its rule sets as rows; the open site's card first, outlined blue, tagged OPEN NOW | ⬜ |
| 11.27 | **What each colour means** | Opens a short explanation of each colour | ⬜ |
| 11.28 | Type "gem" in **Find a site** | Only Gemini's card | ⬜ |
| 11.29 | On a card with two rule sets, press the round button of the one not in use, then read a chat there | That row gets the green edge and IN USE; badge and result name it | ⬜ |
| 11.30 | Press the round button of the first one again | Back to normal | ⬜ |
| 11.31 | **More ▾ → Remove** on the built-in row of a site with no rules of yours, confirm | Card gone; "Removed built-in rules (1)" at the bottom | ⬜ |
| 11.32 | **Restore** (and **Restore all**) | Back in the list | ⬜ |
| 11.33 | **More ▾ → Rename** on one of your rows, type a name, Enter | Renamed | ⬜ |
| 11.34 | **Technical details** on a built-in row | Selectors shown, read-only | ⬜ |
| 11.35 | Look at a card for a site that is not open | Its rows say which site to open; no Show/Fix buttons | ⬜ |
| 11.36 | Read a chat, then look at its card | Health line "Worked on <today>", chips with counts | ⬜ |

### 11E. Importing, exporting and upgrading

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.37 | **Export…** | Save window; file written; status says how many sets | ⬜ |
| 11.38 | Open the exported file in Notepad | Site names, part names and selectors only — no conversation text | ⬜ |
| 11.39 | Delete your rules, then **Import…** the file | Rules back; status "Imported N" | ⬜ |
| 11.40 | Import the same file again | "N you already had"; nothing doubled | ⬜ |
| 11.41 | Import an exported *chat* .json instead | Clear message; nothing changes | ⬜ |
| 11.42 | **Upgrade:** start this version on a profile from 1.1.5 that has picker rules | Rules tagged **Old picker**, in use for their site; they read as before; `user-packs.json` still exists in `%APPDATA%\AI Chat Extractor` | ⬜ |

### 11F. Several rule sets for one site

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.43 | On a ChatGPT chat, **Fix these rules** (or **Teach this site**), then **Save rules** | A last step, **Save these rules**, opens at the top of the panel: name "My ChatGPT" (selected, ready to type over), **Use them for chatgpt.com from now on** ticked | ⬜ |
| 11.44 | Type a name — "Home" — and press **Enter** | Saved and read again; the ChatGPT card has the built-in row and "Home" (IN USE, green edge) | ⬜ |
| 11.45 | **Fix these rules** again, **Save rules** | The last step offers **changes to "Home"** (chosen) or **a new rule set, keeping that one as it is** | ⬜ |
| 11.46 | Choose the new one, name it "Work", save | Three rows: built-in, Home, Work; Work in use | ⬜ |
| 11.47 | Fix again; in the last step untick **Use them … from now on**, save as new "Trial" | Saved; status says the site is still read with the rules it used before; Work still in use | ⬜ |
| 11.48 | Back on the Export tab, on the **This site** card, open **Rules to use** and pick Home | It lists ChatGPT (built-in), Home, Work and Trial; after picking, the badge says Home and the status suggests reading again | ⬜ |
| 11.49 | Read the chat | Result says "read with your rules "Home"" | ⬜ |
| 11.50 | **↺ Back to the built-in rules** on the ChatGPT card | Built-in row in use; Home, Work and Trial still listed | ⬜ |
| 11.51 | **More ▾ → Make a copy** on the built-in row | New row "ChatGPT (copy)", not in use | ⬜ |
| 11.52 | In the last step, press **Back**, then **Esc** | Back returns to the rules; Esc on the rules asks before throwing changes away | ⬜ |
| 11.53 | Export "Home" alone (**More ▾ → Export**) while it is in use; import it into the other app | Arrives there, and is in use there too | ⬜ |

## 12. Batch

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 12.1 | Paste 3 links, pick formats on Export, **Run batch** | Each processed in turn; log line per chat | ⬜ |
| 12.2 | Check the output folder | One set of files per chat, correctly named | ⬜ |
| 12.3 | Include one bad link | That one marked failed; the others still complete | ⬜ |
| 12.4 | Press **Stop** mid-run | Stops after the current chat | ⬜ |
| 12.5 | Batch with an empty box | Prompted to add links | ⬜ |
| 12.6 | Check the Library after a batch | Every chat indexed and searchable | ⬜ |
| 12.7 | Include a link to a site with no rules, **Also export sites that have no rules** unticked | That one "skipped: no rules for …"; the others export | ⬜ |
| 12.8 | Same, ticked | Exported, marked "layout guessed" | ⬜ |
| 12.9 | Include a site whose rules are broken (11.19) | "skipped: the rules for … found nothing" | ⬜ |

## 13. Signing in (private chats)

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 13.1 | Load `chatgpt.com` and sign in inside the app | Sign-in works; a popup opens if the provider uses one | ⬜ |
| 13.2 | Open one of your own private chats and read it | Works exactly like a share link | ⬜ |
| 13.3 | Close and reopen the app | Still signed in | ⬜ |
| 13.4 | **Session → Sign out of all chat sites**, confirm | Signed out; exported files untouched | ⬜ |

> Google may refuse OAuth inside an embedded browser. If so, use a share link or
> an email/password account — this is Google's policy, not an app bug.

## 14. General robustness

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 14.1 | Export with no chat read | Export button disabled | ⬜ |
| 14.2 | Export with no format ticked | Prompted to pick one | ⬜ |
| 14.3 | Point **Save to** at a non-existent folder | Created automatically | ⬜ |
| 14.4 | Resize the window narrow and wide | Layout holds; no overlap | ⬜ |
| 14.4a | Shrink the window until the right panel is too tall for it | The panel gets its own scrollbar; the Export button stays reachable | ⬜ |
| 14.4b | On a 1366×768 (or smaller) screen, launch the app | Window fits the screen; the status bar at the bottom is visible | ⬜ |
| 14.4c | Scroll the right panel to the very bottom on a short window | Last control fully visible, on every tab including Site rules | ⬜ |
| 14.4d | Maximise, then restore | Layout recovers correctly both ways | ⬜ |
| 14.5 | Keyboard: Ctrl+L, Ctrl+E, Ctrl+S | Focus URL / read / export | ⬜ |
| 14.6 | Read a very long chat and watch the overlay | "Working…" appears and then disappears — never sticks | ⬜ |
| 14.7 | Leave the app open for a while, then export | Still works | ⬜ |
| 14.8 | Check `%APPDATA%\AI Chat Extractor` | settings.json, library.json and, once you have rules, site-rules.json | ⬜ |
| 14.9 | Export in `npm start`, then open the built .exe | Same library — both use the same profile folder | ⬜ |

## 15. The built application

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 15.1 | Run `dist\AI Chat Extractor 1.0.0.exe` (portable) | Starts with no install | ⬜ |
| 15.2 | Check the taskbar and window icon | Chat-bubble icon, not the default Electron one | ⬜ |
| 15.3 | Run the installer, then launch from the Start menu | Installs and runs | ⬜ |
| 15.4 | Repeat scenarios 1.1, 2.1 and 3.1 in the built app | Identical behaviour to `npm start` | ⬜ |
| 15.5 | Copy the portable .exe to another Windows PC | Runs there too | ⬜ |
| 15.6 | Uninstall via Settings → Apps | Removed cleanly | ⬜ |

---

## 16. The browser extension

Build and install first — see [../extension/README.md](../extension/README.md).
Repeat these in **both** Chrome and Firefox; note which browser any failure is in.

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 16.1 | Install unpacked in Chrome | Loads with no manifest errors | ⬜ |
| 16.2 | Install temporary add-on in Firefox | Same; grant site access when asked | ⬜ |
| 16.3 | Open a chat, click the toolbar button | Popup names the provider correctly | ⬜ |
| 16.4 | Click on a non-chat page (e.g. a blank tab) | Says it cannot read that page; does not crash | ⬜ |
| 16.5 | **Read this chat** | Workspace opens, reads, shows a preview | ⬜ |
| 16.6 | **Open one of your own private chats** (not a share link) and read it | Works — this is the extension's main advantage | ⬜ |
| 16.7 | A long chat (40+ messages) | Message count matches the real chat | ⬜ |
| 16.8 | Export Markdown, HTML, TXT, JSON | Land in `Downloads/AI Chat Exports` | ⬜ |
| 16.9 | Export Word .docx | Opens in Word, formatting intact | ⬜ |
| 16.10 | Export code files | One `_code.zip` with correctly-named sources and a README | ⬜ |
| 16.11 | Export ZIP | Contains html, md, txt, json, docx and images | ⬜ |
| 16.12 | Export PDF | New tab opens the print dialog; "Save as PDF" gives a good document | ⬜ |
| 16.13 | Export PNG | Chat tab comes to the front, scrolls, then a full-page image is saved | ⬜ |
| 16.14 | Export PNG of a very long chat | Split into numbered parts; no repeated floating header | ⬜ |
| 16.15 | Untick messages, export | Only the ticked ones appear | ⬜ |
| 16.16 | Redaction rule, export every format | Applied everywhere | ⬜ |
| 16.17 | Library search after a few exports | Finds by content, shows a snippet | ⬜ |
| 16.18 | Merge two library chats to Markdown and PDF | One document, table of contents, page break per chat | ⬜ |
| 16.19 | Merge including an `.json` file exported by the **desktop app** | Accepted and merged | ⬜ |
| 16.20 | A Persian chat → HTML, PDF, DOCX | Right-to-left throughout; code stays left-to-right | ⬜ |
| 16.21 | Unknown site → **Teach this site** | Chat tab comes to the front with the panel; after **Save rules** the workspace returns and reads again | ⬜ |
| 16.22 | Batch with 3 links | Each opened, read, exported, closed | ⬜ |
| 16.23 | Restart the browser | Settings, saved rules and library all still there | ⬜ |
| 16.24 | Export the same chat twice | Second file gets a `(1)` suffix; the first is not overwritten | ⬜ |
| 16.25 | Compare an extension export with a desktop export of the same chat | Same content | ⬜ |
| 16.26 | Popup on a ChatGPT chat | Names ChatGPT and says "Read with the built-in rules." | ⬜ |
| 16.27 | Popup on a site whose rules broke last time | Says they stopped working | ⬜ |
| 16.28 | **Show on page** from the workspace | Chat tab shows the boxes; closing the panel returns to the workspace | ⬜ |
| 16.29 | Move the chat tab to another chat, then **Read** in the workspace | Reads the new chat, with the rules for its address | ⬜ |
| 16.30 | The workspace's **Site rules** tab | Behaves as 11.26–11.36 and 11.43–11.53 | ⬜ |
| 16.31 | **Export…** rules in the extension, import them in the desktop app (and back) | Accepted both ways | ⬜ |
| 16.32 | Upgrade from 1.1.5 with picker rules | Tagged **Old picker**, still work | ⬜ |
| 16.33 | **Read & export with last settings** on a site whose rules are broken | Red result, nothing exported | ⬜ |
| 16.34 | Batch with a site that has no rules, box unticked, then ticked | Skipped with the reason, then exported as "layout guessed" | ⬜ |
| 16.35 | **?** and **Manual** in the workspace; **Manual** in the popup | As section 18 | ⬜ |
| 16.36 | Workspace → **Options → Where your files are kept** | Grey dot, "Only in this browser"; **Choose a folder…** (Chrome/Edge). In Firefox it says it cannot, with no button | ⬜ |
| 16.37 | **Choose a folder…** → pick the project's `data` folder; allow the browser to edit files there | Green dot, "Also in the folder "data""; `data\settings\extension-settings.json` and `data\rules\site-rules.json` exist | ⬜ |
| 16.38 | Site rules tab | Rules taught in the desktop app are there too; the extension's own are in `data\rules\site-rules.json` (the desktop app shows them after its next read or a visit to its Site rules tab) | ⬜ |
| 16.39 | Change an option (theme → Dark) | `extension-settings.json` holds only `"theme": "dark"` | ⬜ |
| 16.40 | Teach or fix rules in the desktop app, then click back into the workspace tab | The change shows in the workspace | ⬜ |
| 16.41 | Export Markdown and HTML | Saved in `data\exports`, not Downloads; the status says where | ⬜ |
| 16.42 | **Export…** rules | Saved in `data\rules` | ⬜ |
| 16.43 | Restart the browser, open the workspace | Amber "waiting for your permission"; an export now goes to Downloads; **Allow access again** → green | ⬜ |
| 16.44 | **Stop using it** | "Only in this browser"; the files in `data` are still there | ⬜ |
| 16.45 | **Reset all options to defaults** | Options back to their defaults; rules and library untouched | ⬜ |

> Firefox drops temporary add-ons on restart — for 16.23 in Firefox, reload the
> add-on first and check that the library survived (it is stored separately).

---

## 17. Regression checks for known fixes

These cover bugs that have already been found and fixed. If one comes back, it
came back here first.

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 17.1 | Read a chat of ~50 messages that is fully in the page | Finishes in a couple of seconds, not a minute | ⬜ |
| 17.2 | Watch the status after reading | Says whether it read without a full scroll pass, or had to scroll | ⬜ |
| 17.3 | Extension: read a chat and do not touch the browser | Chat tab comes forward, then the workspace returns | ⬜ |
| 17.4 | Extension: start a read, then immediately switch tabs | May come back short — this is the documented browser limitation, not a crash | ⬜ |
| 17.5 | Export a chat whose title is in Persian or Arabic | Saves; filename keeps the Persian text | ⬜ |
| 17.6 | Export a chat whose title contains `: / ? " * |` | Saves with those characters replaced | ⬜ |
| 17.7 | Export a chat whose title is only emoji or punctuation | Still saves, under some usable name | ⬜ |
| 17.8 | Watch for a note about a filename fallback | If shown, the file exists under the stated name | ⬜ |
| 17.9 | Run `npm run bench` | All fixtures read completely; no "came back short" warning | ⬜ |
| 17.10 | Read a very long chat and let it hit the time limit | Says it stopped early and suggests raising the limit — never hangs | ⬜ |

| 17.11 | Export from a site that puts one exchange in a single element (e.g. GapGPT) | Both speakers present, alternating correctly | ⬜ |
| 17.12 | Check a code block in the export | No stray language word ("text", "python") at the start of the code | ⬜ |
| 17.13 | Export a chat with collapsed reasoning, then open the file | Reasoning is visible, not present-but-hidden | ⬜ |
| 17.14 | Check the speaker labels | The site's name, never an internal pack name | ⬜ |
| 17.15 | Export a very long chat that loads history as you scroll up | The earliest messages are included | ⬜ |
| 17.16 | A site's rules stop fitting (11.19–11.20) on a chat with a long sidebar of past chats | The read stops with a red message; the list of chats is never exported as the conversation | ⬜ |
| 17.17 | A chat where you sent the same message twice ("continue", "continue") | Both appear in the preview and the export | ⬜ |
| 17.18 | Export a ChatGPT chat — extension and desktop — with the default filename template | Named `<date> - ChatGPT - <the chat's name as in ChatGPT's sidebar>`, never the id from the address | ⬜ |
| 17.19 | Extension: export PDF | The print dialog suggests that same name | ⬜ |
| 17.20 | With IDM or another download manager running, export from the extension | Either the right name, or a note saying something else renamed the file (and naming the download manager as the likely cause) | ⬜ |
| 17.21 | Send a prompt with several lines, a blank line and an indented line; export HTML, Markdown, Word, PDF and text | Your prompt keeps its line breaks, blank line and indentation in every format | ⬜ |
| 17.22 | Read a ChatGPT chat with the sidebar open | No sidebar menu or "more" button is opened by the read | ⬜ |

---

## 18. Help inside the app

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 18.1 | Press **Manual** (or F1) | The manual opens inside the app, contents on the left | ⬜ |
| 18.2 | Click entries in the contents, and a link inside the text | Jumps there, briefly highlighted | ⬜ |
| 18.3 | Search "batch" | Matching sections listed, each with a snippet | ⬜ |
| 18.4 | Esc, or click outside the window | Closes | ⬜ |
| 18.5 | Press **?** (or Shift+F1) | Dashed outlines on the controls; a bar at the bottom | ⬜ |
| 18.6 | Click Export, a format, an option, a tab | Each shows an explanation instead of doing anything | ⬜ |
| 18.7 | **Read more in the manual →** | The manual opens at that topic | ⬜ |
| 18.8 | **Done** or Esc | Mode ends; controls work again | ⬜ |
| 18.9 | **Help → About** | Version number | ⬜ |
| 18.10 | Read the manual through once as if you were new | Note anything unclear, wrong or missing | ⬜ |

---

## 19. Where your files are kept

Desktop app. Do this from the project folder (`npm start`) first.

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 19.1 | **Options → Where your files are kept** | Shows `<project>\data`, "The default place."; rows settings, rules, library, exports in four colours | ⬜ |
| 19.2 | Click each row | Explorer opens that folder | ⬜ |
| 19.3 | Open `data` | `README.txt` says what each folder is | ⬜ |
| 19.4 | **First start after upgrading** from a version that kept files in `%APPDATA%\AI Chat Extractor` | Your options, rules and library are all there; the old files are still in `%APPDATA%` too; **Save to** is now `data\exports` (old exports stay where they were) | ⬜ |
| 19.5 | Look at `data\settings\settings.json`; change the theme; look again; change it back | Only the options you changed are in it — the theme appears, then disappears | ⬜ |
| 19.6 | `git status` in the project | `data` is not listed | ⬜ |
| 19.7 | **Change…** → an empty folder → **Restart now** | The app restarts using it; settings, rules and library copied there; the old folder unchanged | ⬜ |
| 19.8 | **Change…** → a folder that already has the app's files | Asks to use the files there; nothing is overwritten | ⬜ |
| 19.9 | **Use the default** → restart | Back to `<project>\data` | ⬜ |
| 19.10 | **Reset all options to defaults** | Options back to defaults; `settings.before-reset-….json` beside `settings.json`; rules and library untouched | ⬜ |
| 19.11 | In `config\default-settings.json` set `"theme": "dark"`, restart, reset the options | The default theme is now Dark. Set it back afterwards | ⬜ |
| 19.12 | **File → Open data folder**; **Site rules → Export…** | Opens the data folder; the save window suggests the `rules` folder | ⬜ |
| 19.13 | After moving the folder, load a private chat | Still signed in: sign-ins stay in `%APPDATA%`, not in the data folder | ⬜ |
| 19.14 | Built app: run the **portable** .exe from a folder | `AI Chat Extractor data` is created beside the .exe | ⬜ |
| 19.15 | Built app: the **installed** version | Data in `%APPDATA%\AI Chat Extractor\data`, which survives an update; exports still go to `Documents\AI Chat Exports`, and the **exports** row in Options opens that folder | ⬜ |

---

## Reporting a problem

The single most useful thing to include is **which provider and which
scenario number**, because nearly every extraction bug is provider-specific.

Also helpful:

1. The reading result and the status bar text at the moment it went wrong.
2. For a site read wrongly: its rules, exported from its card in **Site rules**.
3. For a wrong or short read: the real message count versus the reported one.
4. For a broken export: the file itself.
5. The developer console — **View → Toggle Developer Tools** for the app, or the
   ⚙ button in the viewer toolbar for the loaded page.
