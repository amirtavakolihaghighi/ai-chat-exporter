# Contributing

## Getting set up

```bash
npm install
npm run icon        # once — generates the app and extension icons
npm start           # the desktop app
npm run ext:build   # the browser extension, into extension/dist/
```

## The test suites, and one rule about them

321 checks across four suites: 111 in the core, 61 in the extractor suite, 83
end-to-end, and 66 for the extension. Those numbers are what the suites report
today, not an aspiration.

```bash
npm test               # core: conversion, filenames, selection, merge, bidi
npm run test:electron  # the real extractor against DOM fixtures, PDF and images
npm run test:e2e       # boots the app and drives the real UI to files on disk
npm run test:extension # manifests, the built bundles, browser-side exports
```

**The suites never touch your real data, and they must stay that way.** The
end-to-end suite points the application at a throwaway profile directory before
it boots, and every export is written to a temporary folder. Your settings, your
library and your exported files are never read or written by a test run.

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

**Anything in `src/inject/extract.js`.** It runs inside pages we do not control,
in two different products, and it is the part everything else depends on. Two
specific traps:

- Never call `innerText` in a hot path. It forces a synchronous reflow, and this
  code runs repeatedly for every message.
- Do not replace an event-driven wait with a fixed delay. The waits are bounded
  by design, but a fixed delay is either too short on a slow site or wasted on a
  fast one.

**Anything touching bytes.** The core deals in `Uint8Array`, never Node's
`Buffer`, because the same code runs in a browser. Do not add a `Buffer` shim to
the extension bundle — JSZip detects Node by `typeof Buffer` and takes the wrong
code path if one exists.

**Provider selectors** in `src/shared/providers.js` are a best-effort starting
point, not a contract. A pack that stops matching is expected; the heuristic and
the element picker are the real safety net. Adding a pack for a new site is a
welcome, low-risk contribution.

## Adding a provider

1. Add an entry to `PROVIDERS` in `src/shared/providers.js`.
2. Set `hosts` and `turnSelector` at minimum. Prefer attributes that look
   deliberate (`data-testid`, `data-message-author-role`) over generated class
   names.
3. Test against the real site, then add a fixture to `test/fixtures/` if the site
   does something structurally new.

## Style

- Match the surrounding code; there is no linter to argue with.
- Comments should explain *why*, especially where something looks unnecessary —
  most of the odd-looking code here is odd because of a specific browser
  behaviour, and the comment is what stops it being "simplified" back into a bug.
- Keep user-facing text plain. No exclamation marks, no marketing.

## Reporting bugs

Nearly every extraction bug is provider-specific, so say **which provider** and,
if you can, which scenario number from [docs/TESTING.md](docs/TESTING.md).
