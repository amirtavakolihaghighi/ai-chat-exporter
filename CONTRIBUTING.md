# Contributing

## Getting set up

```bash
npm install
npm run icon        # once — generates the app and extension icons
npm start           # the desktop app
npm run ext:build   # the browser extension, into extension/dist/
```

## The test suites, and one rule about them

633 checks across four suites: 295 in the core (111 for conversion, 122 for site
rules, 29 for default options and keeping copies in step, 21 for the desktop
app's data folder and every write to it, 12 keeping the help and the manual in
step), 123 in the extractor and teach-overlay suite, 116 end-to-end, and 99 for
the extension. Those numbers are what the suites report today, not an
aspiration.

```bash
npm test               # core: conversion, filenames, selection, merge, bidi,
                       # site rules, options, the data folder, help coverage
npm run test:electron  # the real extractor and teach overlay against DOM fixtures,
                       # PDF and images
npm run test:e2e       # boots the app and drives the real UI to files on disk
npm run test:extension # manifests, the built bundles, browser-side exports,
                       # the workspace page
```

**The suites never touch your real data, and they must stay that way.** The
end-to-end suite points the application at a throwaway profile directory and a
throwaway data folder (`ACE_DATA_DIR`) before it boots, and every export is
written to a temporary folder. This matters more now that the app, run from the
project, keeps its data in the project's own `data/` folder: without
`ACE_DATA_DIR`, a test that boots the app would use yours. Your settings, rules,
library and exported files are never read or written by a test run.

If you add a test that writes anything, redirect it the same way. Discovering
this rule by having your own library wiped is not a good introduction to a
project.

## Before opening a pull request

```bash
npm test              # fast, no browser needed
npm run test:electron
npm run test:e2e
npm run test:extension
npm run bench         # reading speed and completeness
```

All four suites should pass and the benchmark should report every fixture read
completely.

## Where things live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version: the document
builders are shared between the desktop app and the extension, so a change to
`src/main/exporters/` or `src/main/lib/` affects both. Only the final step —
writing a file versus handing a Blob to the browser — is per-product.

## The kind of change that needs care

**Anything in `src/inject/`** — the matcher, the extractor and the teach
overlay. They run inside pages we do not control, in two different products,
and everything else depends on them. Three specific traps:

- Never call `innerText` in a hot path. It forces a synchronous reflow, and this
  code runs repeatedly for every message.
- Do not replace an event-driven wait with a fixed delay. The waits are bounded
  by design, but a fixed delay is either too short on a slow site or wasted on a
  fast one.
- Do not build page-side interface from markup strings. Some sites enforce
  Trusted Types, under which assigning HTML throws; create elements instead.

**Anything touching bytes.** The core deals in `Uint8Array`, never Node's
`Buffer`, because the same code runs in a browser. Do not add a `Buffer` shim to
the extension bundle — JSZip detects Node by `typeof Buffer` and takes the wrong
code path if one exists.

**Built-in rules** in `src/shared/providers.js` are a best-effort starting
point, not a contract. Rules that stop matching are expected — they report it,
and people fix them in the app in a few clicks. Never make a read fall back to
guessing when rules exist: that silent fallback is how a list of past chats was
once exported as a conversation. Adding rules for a new site is a welcome,
low-risk contribution.

**Any new control** in either app needs a `data-help` key, an explanation in
`src/shared/help.js` and a place in `docs/MANUAL.md`. `npm test` fails until all
three line up.

## Adding built-in rules for a site

The quickest route is to teach the site in the app, then export its rules from
its card in the Site rules tab — the file holds exactly what goes in
`src/shared/providers.js`.

1. Add an entry to `PROVIDERS` with `id`, `name` and `hosts`.
2. Give it `parts` (see `src/shared/parts.js`): at least `user` and
   `assistant`, or `message` with `options` that tell the speakers apart.
   Prefer attributes that look deliberate (`data-testid`,
   `data-message-author-role`) over generated class names.
3. Test against the real site, then add a fixture to `test/fixtures/` if the site
   does something structurally new. Set `verified: true` only once a real
   conversation has been exported and checked end to end.

## Style

- Match the surrounding code; there is no linter to argue with.
- Comments should explain *why*, especially where something looks unnecessary —
  most of the odd-looking code here is odd because of a specific browser
  behaviour, and the comment is what stops it being "simplified" back into a bug.
- Keep user-facing text plain. No exclamation marks, no marketing.

## Reporting bugs

Nearly every extraction bug is provider-specific, so say **which provider** and,
if you can, which scenario number from [docs/TESTING.md](docs/TESTING.md).
Attaching that site's rules, exported from the Site rules tab, helps most.
