# Changelog

All notable changes to this project are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `.gitattributes`, so text files are stored with LF and binaries are never
  rewritten by line-ending conversion. Without it, a script committed from
  Windows fails on Linux with `bad interpreter`.
- `CODE_OF_CONDUCT.md`.
- The core suite now runs in CI across Linux, macOS and Windows on Node 18, 20
  and 22 — the range `package.json` claims to support.

### Changed

- Test fixtures no longer contain content taken from real conversations. Where a
  real chat prompted a fixture, the structure that made it useful was kept and
  the words replaced with invented equivalents; the mixed-script case that
  exercises text-direction detection is preserved.

## [1.1.5] — 2026-08-21

### Fixed

- **Images are actually embedded now, rather than left as links.** Pictures are
  served from a separate, authenticated CDN, and both products were failing to
  fetch them for different reasons: the extension asked without cookies and got
  a 403, while the desktop app fetched from inside the page, where a request to
  another origin is blocked by CORS. Either way the export silently kept the
  remote address.

  That failure is worse than it sounds, because it hides itself. The link still
  resolves in the browser you are signed into, so a quick check looks fine; it
  breaks when the file is opened later, moved to another machine, or once the
  signed URL expires — showing as a broken image, which reads like a rendering
  fault rather than a fetch one.

  The extension now sends cookies (falling back to an anonymous request for
  hosts that refuse credentialed ones), and the desktop app fetches through the
  browsing session in the main process, which has the cookies and is not subject
  to page CORS. The original address is kept on `data-original-src`.

## [1.1.4] — 2026-08-21

### Fixed

- **Attachments are no longer dropped.** A provider pack names the element
  holding a message's *text*; a screenshot attached to a question sits beside
  that element, not inside it, so narrowing a turn to its content selector threw
  every attached picture away. The site still showed the thumbnail, so the chat
  looked complete on screen while the export was missing images. Attachments are
  now collected alongside the text and reassembled in the order they appear.

## [1.1.3] — 2026-08-21

### Fixed

- **Image replies are no longer lost.** A reply from an image model is entirely a
  picture and carries no text, and messages with no text were being discarded
  silently — the prompt was exported and the answer simply was not there. This
  affected every provider, not just the one it was noticed on.
- **Pictures survive the strip list.** A generated image is usually wrapped in a
  button so it can be clicked to enlarge, and buttons were removed as chrome,
  taking the picture with them. Nothing containing media is stripped now.
- **Exchanges holding a picture split correctly.** On sites that put a question
  and its answer in one element, the two halves are told apart by the answer
  being rendered markdown — which an image reply has none of. Those now fall
  back to position, since a question always precedes its answer.

### Changed

- `docs/site-report.js` reports media: where pictures sit, what wraps them, and
  the structure of the first exchange containing one. Image sources are reported
  by kind and host, never as the signed URL itself.

## [1.1.2] — 2026-08-21

### Added

- **Support for sites that put a whole exchange in one element.** Some Vue and
  Quasar front-ends wrap the question and the answer together, with no classes
  distinguishing them — only the fact that the answer is rendered markdown. Read
  naively that yields the questions alone, the answers alone, or both fused into
  one blob under a guessed speaker. A pack can now mark the assistant half and
  the two are split apart.
- **A dedicated GapGPT pack** using that mechanism.
- **Older messages are now loaded** on infinite-scroll chats, which previously
  lost the start of a long conversation.
- `docs/site-report.js` — paste it into the browser console on a chat page to
  produce a structural description of the site, which is what is needed to write
  a pack for it. Message text is truncated to 40 characters.

### Fixed

- **Content the site had collapsed is now visible in the export.** Reasoning
  blocks were captured correctly but kept the site's inline `display: none`, so
  they were present in the file and invisible when it was opened — which defeats
  the point of expanding them.
- The clickable header of a collapsible section ("show reasoning steps" and its
  chevron) is no longer captured as if it were content.
- HTML comments are stripped from captured markup.
- Code-block toolbars are read for their language and then removed. Sites that
  put the language label inside the `<pre>` were leaving a stray word such as
  "text" at the start of every snippet.
- The generic front-end pack's internal name no longer appears as the speaker in
  exported documents; the site's hostname is used instead.

## [1.1.0] — 2026-08-21

### Added

- **Browser extension** for Chrome, Edge and Firefox, sharing the desktop app's
  extraction engine and document builders. Runs in your own browser session, so
  private chats export without a share link or a second sign-in.
- **Per-message selection** — tick boxes in the preview with presets for
  answers-only, your prompts, and invert.
- **Code file export** — every fenced snippet written as a real source file named
  by language, with a manifest.
- **Library with full-text search** across everything you have exported.
- **Merging** several chats into one document with a table of contents.
- **Right-to-left support in Word** — paragraphs, list items and table cells are
  measured and marked individually.
- **Reading time limit** so a difficult page can never hang a read.
- Reading-speed benchmark (`npm run bench`).
- Application icon; the built executables no longer use the default Electron one.

### Changed

- **Reading is dramatically faster.** It now checks whether a page keeps its
  whole conversation in the DOM and, when it does — which is most of the time —
  reads it in one pass instead of scrolling the entire thread. Waiting is
  event-driven rather than a fixed budget per step, `innerText` is gone from the
  hot path, and already-read messages are not re-processed.
- Gap detection now measures against the typical spacing between messages rather
  than the viewport, so a single missing message is caught.
- The extension brings the chat tab to the front while reading; background tabs
  are throttled too hard for a site to re-render as it scrolls.
- Batch runs open tabs in the foreground for the same reason.
- Repository restructured for publication: `docs/`, `LICENSE`, `CONTRIBUTING.md`,
  `SECURITY.md`, CI.
- Packaging uses the locally installed Electron rather than re-downloading a
  116 MB archive, so building works offline and cannot fail on a corrupt cache.

### Fixed

- **"Invalid filename" when saving from the extension.** Filenames are now built
  from an allowlist, so invisible bidi marks in Persian and Arabic titles no
  longer produce a name the browser rejects. If a name is still refused, the
  export falls back to an ASCII name and then to the Save-as dialog rather than
  failing.
- Screenshot capture no longer hangs in a background tab; the reply to a scroll
  request no longer depends on an animation frame that never arrives.
- Reasoning blocks outside the content selector are no longer dropped.
- The right-hand panel scrolls on short screens instead of being clipped, and the
  window is sized to fit the display it opens on.
- The welcome panel no longer clips its own text at both ends on a short window.
- Legacy history records no longer break library search after upgrading.
- Desktop and packaged builds now share one settings folder.

## [1.0.0] — 2026-08-04

First release: the Windows desktop app.

- Loads an AI chat share link in an embedded browser and exports it.
- Formats: PDF, Markdown, Word, HTML, plain text, JSON, PNG, JPEG, ZIP.
- Handles virtualised conversations by scrolling and harvesting continuously,
  then re-reading any gap large enough to hide a message.
- Provider packs, a structural heuristic, and a click-to-teach element picker.
- Embeds images, so exports survive expiring share links.
- Redaction, batch export, export history, filename templates.
