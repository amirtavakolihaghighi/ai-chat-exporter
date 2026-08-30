# Security

## What this software does with your data

Nothing leaves your machine. There is no account, no server, no telemetry, and
no analytics. Neither the desktop app nor the extension makes a network request
of its own — the only fetches are for images inside the chat you are exporting,
and only when image embedding is enabled.

Everything is stored locally:

| | Location |
| --- | --- |
| Desktop | `%APPDATA%\AI Chat Extractor\` |
| Extension | Your browser profile (extension storage and IndexedDB) |

Exported files go where you chose (desktop) or to `Downloads/AI Chat Exports/`
(extension).

## Permissions the extension asks for

| Permission | Why it is needed |
| --- | --- |
| `activeTab`, `scripting` | To read the chat in the tab you are looking at |
| `<all_urls>` | Chats are hosted on many domains, and their images on others |
| `downloads` | To save exported files |
| `storage`, `unlimitedStorage` | Settings, saved site rules, and the library |
| `tabs` | To open the workspace and drive background tabs during a batch |

`<all_urls>` is broad. It is required because the extension cannot know in
advance which domain a chat or its image CDN lives on. On Firefox, host access
is optional under Manifest V3 and you are asked before it is used.

## How untrusted content is handled

Chat pages are untrusted input, and exported files get opened later in other
programs. So:

- Captured markup is stripped of `<script>`, `<iframe>`, `<object>`, `<embed>`,
  inline event handlers and `javascript:` URLs before it is written anywhere.
- The desktop UI runs with `contextIsolation` on and `nodeIntegration` off. The
  renderer has no filesystem access; every write goes through an explicit
  main-process handler over a narrow preload bridge.
- Loaded chat pages run in a separate session partition from the app itself.
- Export documents are rendered in windows with JavaScript disabled.

## Redaction is a convenience, not a guarantee

The redaction feature does find-and-replace on the text before writing. It is
useful for removing an API key or a name you know about. It cannot know what is
sensitive, and it will not catch something you did not think to list. Check
exports before sharing them.

## Reporting a vulnerability

Open an issue describing the problem and how to reproduce it. If you would rather
not do that publicly, say so in an issue without details and a private channel
can be arranged.

Please do include: what an attacker would have to control (a chat page? a file
being merged?), and what they would gain.

## Known limitations

- **Exported files can contain anything the chat contained.** Sanitising removes
  active content, but the text, images and links are whatever the conversation
  had in it. Treat an exported chat as you would the chat itself.
- **The desktop app allows popups in the embedded browser** so third-party
  sign-in works. Popups are confined to the same isolated session partition and
  cannot reach the app's own code.
- **Nothing is signed.** The Windows binaries are unsigned, so SmartScreen will
  warn on first run, and the extension is loaded unpacked. Build from source if
  that matters to you.
