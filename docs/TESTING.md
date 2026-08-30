# Test scenarios

A checklist for testing the app by hand. The automated suites (`npm test`,
`npm run test:electron`, `npm run test:e2e`) cover the internals against local
fixtures; what they **cannot** cover is the thing that matters most — whether
extraction still works against the real, live, frequently-redesigned websites.
That is what this document is for.

Work top to bottom. Sections 1–3 are the core; if those pass the app is usable.

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
| 2.1 | Press **Read this chat** on a short chat | Green status: message count and character count | ⬜ |
| 2.2 | Open **Preview and choose messages** | One row per message, correct speaker labels, right order | ⬜ |
| 2.3 | **Read a long chat (40+ messages)** — the important one | Count matches the real chat. Scroll the site yourself and count if unsure | ⬜ |
| 2.4 | Read a chat with a reasoning / "thinking" block | Rows show "has reasoning"; the reasoning is not mixed into the answer | ⬜ |
| 2.5 | Read a chat containing code | Rows show "N code blocks" | ⬜ |
| 2.6 | Read a chat containing images | Status reports how many images were embedded | ⬜ |
| 2.7 | Read a chat with maths | Preview shows `$…$` LaTeX, not broken glyphs | ⬜ |
| 2.8 | Read a page that is not a chat at all | Either nothing found (clear message) or obvious junk in the preview — no crash | ⬜ |
| 2.9 | Read while the app window is minimised | Same message count as when visible | ⬜ |

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

## 11. Unrecognised sites and the picker

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 11.1 | Load a chat site with no pack | Badge: "unknown site · will guess" | ⬜ |
| 11.2 | Read it | Heuristic finds the messages, or says clearly that it did not | ⬜ |
| 11.3 | Click **Pick a message by hand**, click one message | Blue highlight follows the cursor; status reports the saved rule and match count | ⬜ |
| 11.4 | Read again | Uses your rule; badge turns blue "your rule" | ⬜ |
| 11.5 | **Options → Saved site rules** | Rule listed for that host | ⬜ |
| 11.6 | Remove the rule | Badge reverts to guessing | ⬜ |
| 11.7 | Press Esc during picking | Cancels cleanly | ⬜ |

## 12. Batch

| # | Scenario | Expected | Result |
| --- | --- | --- | --- |
| 12.1 | Paste 3 links, pick formats on Export, **Run batch** | Each processed in turn; log line per chat | ⬜ |
| 12.2 | Check the output folder | One set of files per chat, correctly named | ⬜ |
| 12.3 | Include one bad link | That one marked failed; the others still complete | ⬜ |
| 12.4 | Press **Stop** mid-run | Stops after the current chat | ⬜ |
| 12.5 | Batch with an empty box | Prompted to add links | ⬜ |
| 12.6 | Check the Library after a batch | Every chat indexed and searchable | ⬜ |

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
| 14.4c | Scroll the right panel to the very bottom on a short window | Last control ("Pick a message by hand") fully visible | ⬜ |
| 14.4d | Maximise, then restore | Layout recovers correctly both ways | ⬜ |
| 14.5 | Keyboard: Ctrl+L, Ctrl+E, Ctrl+S | Focus URL / read / export | ⬜ |
| 14.6 | Read a very long chat and watch the overlay | "Working…" appears and then disappears — never sticks | ⬜ |
| 14.7 | Leave the app open for a while, then export | Still works | ⬜ |
| 14.8 | Check `%APPDATA%\AI Chat Extractor` | settings.json, library.json, user-packs.json | ⬜ |
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
| 16.21 | Unknown site → **Pick a message by hand** | Highlight follows cursor; rule saved; re-read works | ⬜ |
| 16.22 | Batch with 3 links | Each opened, read, exported, closed | ⬜ |
| 16.23 | Restart the browser | Settings, saved rules and library all still there | ⬜ |
| 16.24 | Export the same chat twice | Second file gets a `(1)` suffix; the first is not overwritten | ⬜ |
| 16.25 | Compare an extension export with a desktop export of the same chat | Same content | ⬜ |

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

---

## Reporting a problem

The single most useful thing to include is **which provider and which
scenario number**, because nearly every extraction bug is provider-specific.

Also helpful:

1. The status bar text at the moment it went wrong.
2. For a wrong or short read: the real message count versus the reported one.
3. For a broken export: the file itself.
4. The developer console — **View → Toggle Developer Tools** for the app, or the
   ⚙ button in the viewer toolbar for the loaded page.
