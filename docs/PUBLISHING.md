# Publishing and releases

Two parts: the one-time setup to get this repository onto GitHub, and the
routine for every release after that.

Repository: `github.com/amirtavakolihaghighi/ai-chat-exporter`

> The repository is named *exporter* while the application is called **AI Chat
> Extractor**. That is deliberate, not an oversight — renaming the application
> would move the folder holding your settings, library and saved site rules, and
> a cosmetic rename is not worth a data migration.

---

## Part 1 — One-time setup

### 1. Create the repository, completely empty

On GitHub: **New repository** → name `ai-chat-exporter` → **Public**.

**Do not tick "Add a README", ".gitignore" or "Choose a licence".** Any of those
creates a commit on GitHub's side. Your local history and GitHub's would then
share no common ancestor, and the first push is rejected with:

```text
! [rejected] main -> main (fetch first)
```

which is recoverable but a confusing thing to hit on day one. An empty
repository accepts the first push cleanly.

### 2. Push

```bash
git remote add origin https://github.com/amirtavakolihaghighi/ai-chat-exporter.git
git push -u origin main
```

The first push may open a browser window to authenticate, so run it when you
are at the machine. `-u` records origin/main as the default upstream, so later
pushes are just `git push`.

### 3. Settings to enable

In the repository's **Settings**:

| Setting | Where | Why it matters here |
| --- | --- | --- |
| **Private vulnerability reporting** | Settings → Advanced Security | `SECURITY.md` tells people to report privately through it. Without it, that instruction leads nowhere. Public repositories only. |
| **Discussions** | Settings → General → Features | Only needed if you want a place for questions that are not bugs. |
| **Description and topics** | The About panel, main page | How anyone finds the project at all. |

Suggested description:

> Export AI chat conversations to PDF, Word, Markdown, HTML, JSON, images or
> source files. Desktop app and browser extension.

Suggested topics: `chatgpt` `claude` `gemini` `deepseek` `export` `markdown`
`docx` `pdf` `electron` `browser-extension` `chrome-extension` `firefox`
`obsidian` `archive`

### 4. Watch the first CI run

Go to the **Actions** tab. Expect something to fail — the core suite runs on
Linux, macOS and Windows across three Node versions, and this was only ever
developed on one of those nine combinations.

That is CI doing its job. A red first run is information, not a setback.

### 5. Add the badges once CI is green

At the top of `README.md`:

```markdown
[![CI](https://github.com/amirtavakolihaghighi/ai-chat-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/amirtavakolihaghighi/ai-chat-exporter/actions/workflows/ci.yml)
```

Adding it before the first green run just displays "failing" to every visitor.

### 6. A screenshot

The single highest-value addition to the README. People decide whether to try a
tool from one picture. `npm run shot` produces one of the desktop UI.

Put it in `docs/`, reference it near the top, and give it descriptive alt text —
"The workspace, showing a captured conversation with per-message tick boxes",
not "screenshot".

**Check the picture before committing it.** A screenshot carries whatever was on
screen: window titles, file paths, browser tabs, notifications. `git grep` will
never find any of it.

---

## Part 2 — Cutting a release

### Choosing the number

`MAJOR.MINOR.PATCH`, where each part is a promise:

- **PATCH** — bug fixes. Nothing anyone relied on has changed.
- **MINOR** — new features. Everything that worked before still works.
- **MAJOR** — something broke. People have to change how they use it.

The image fixes in 1.1.3 through 1.1.5 were patches: they repaired exports that
were already meant to include pictures. Adding the merge feature was a minor.
Changing the JSON export schema so older files no longer load would be a major.

### The routine

```bash
# 1. Move [Unreleased] to the new version in CHANGELOG.md and add the link
#    reference at the bottom of the file.

# 2. Bump the version in all three places.
npm version 1.2.0 --no-git-tag-version
node -e "for(const f of ['extension/manifest.chrome.json','extension/manifest.firefox.json']){const j=require('fs');const o=JSON.parse(j.readFileSync(f));o.version='1.2.0';j.writeFileSync(f,JSON.stringify(o,null,2)+'\n')}"

# 3. Prove it still works.
npm test && npm run test:electron && npm run test:e2e && npm run test:extension

# 4. Commit the bump.
git add -A
git commit -m "chore(release): 1.2.0"

# 5. Tag it. Annotated, not lightweight - an annotated tag records who made
#    the release and when, and is what GitHub shows on the release page.
git tag -a v1.2.0 -m "1.2.0"

# 6. Push the commit AND the tag. These are two separate things.
git push
git push origin v1.2.0
```

**`git push` does not push tags.** Everyone learns this once, usually by
wondering why the release page is empty.

Worth knowing why releases use tags at all: a branch is a moving pointer, so
"download main" means something different next week. A tag is fixed forever, so
someone reporting a bug against v1.2.0 and you both see identical code.

### Attaching the builds

Do **not** commit the `.exe` files. They are 80 MB each; git stores every
version forever, and every future clone would carry all of them.

```bash
npm run dist      # installer + portable, into dist/
npm run ext:zip   # both browser bundles, into extension/dist/
```

On GitHub: **Releases → Draft a new release**, choose the tag you pushed, then
attach:

- `dist/AI Chat Extractor Setup <version>.exe` — installer
- `dist/AI Chat Extractor <version>.exe` — portable
- `extension/dist/ai-chat-extractor-chrome.zip`
- `extension/dist/ai-chat-extractor-firefox.zip`

### Release notes

Write for someone landing on the page cold, who has never heard of the project.
Open with the problem it solves, not a diff. Structure that works:

1. One sentence on what this is
2. What changed in this release, in plain language
3. How to install — both the app and the extension
4. A link to the full changelog

Say plainly that the binaries are unsigned and Windows SmartScreen will warn on
first run. People trust a project more when it tells them that up front than
when they find out by being alarmed.

---

## A standing note

This tool reads other people's websites, and those websites change without
warning. A provider pack that works today may break next month. That is the
nature of the problem rather than a defect — it is why extraction degrades
through a heuristic, a click-to-teach picker, and a screenshot mode instead of
depending on any one approach.

Saying so in the README is better than implying a guarantee that cannot be kept.
When a site does change, `docs/site-report.js` turns the fix into a ten-minute
job.
