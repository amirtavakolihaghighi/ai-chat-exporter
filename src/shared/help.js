/**
 * In-app help: what every control does, and the user manual.
 *
 * Every button, tab, box and option in both apps carries a `data-help` key.
 * "What's this?" mode looks the key up here and shows the explanation beside
 * the control, with a link into the manual at the section that covers it. The
 * manual itself is docs/MANUAL.md, rendered inside the app, so the copy in the
 * repository and the copy in the app are the same document.
 *
 * test/help.test.js checks that every key used in the apps is explained here,
 * and that every section named here exists in the manual — so neither can
 * silently fall out of step with the other.
 *
 * Loaded like src/shared/parts.js: a CommonJS module, or a plain <script> in
 * the desktop renderer, where it defines `AceHelp`.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.AceHelp = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * key -> { title, text, section }
   * `section` is a heading anchor in docs/MANUAL.md.
   */
  const TOPICS = {
    /* ------------------------------------------------------------ both apps */
    read: {
      title: 'Read this chat',
      text: 'Reads every message in the open chat, scrolling through it if the site only shows part of it at a time. Nothing is saved yet — you see a preview first.',
      section: 'reading-a-chat',
    },
    'read-status': {
      title: 'Reading result',
      text: 'What the last read found: how many messages, whether the site’s rules were used or the layout was guessed, and anything that looked wrong. Buttons here fix the problem in one click.',
      section: 'what-the-reading-result-tells-you',
    },
    'site-card': {
      title: 'This site',
      text: 'Which rules are reading this site, and what each coloured part found the last time. “Show on page” draws the boxes over the chat; “Teach / fix” lets you point at the right things.',
      section: 'site-rules',
    },
    'show-rules': {
      title: 'Show on page',
      text: 'Draws a coloured box around everything the rules find on the open page — blue for your messages, green for the AI’s — without changing anything.',
      section: 'seeing-rules-on-the-page',
    },
    teach: {
      title: 'Teach / fix this site',
      text: 'Opens the teach panel over the chat. Choose a part, click it on the page, make the box bigger or smaller until it is right, then save. On a site with no rules the app makes a first guess for you to check.',
      section: 'teaching-a-site',
    },
    'rules-badge': {
      title: 'Rules badge',
      text: 'Green: built-in rules. Blue: your own rules. Amber: no rules, so the layout will be guessed. Grey: the rules for this site were removed, or turned off in an older version.',
      section: 'site-rules',
    },
    preview: {
      title: 'Preview and choose messages',
      text: 'Every message the read found, in order, marked with who sent it. Untick anything you do not want in the export.',
      section: 'choosing-what-to-export',
    },
    'select-presets': {
      title: 'Quick selections',
      text: '“all” and “none” tick or clear everything, “answers only” keeps the AI’s replies, “my prompts” keeps yours, “invert” flips the ticks.',
      section: 'choosing-what-to-export',
    },
    formats: {
      title: 'Formats',
      text: 'Tick every kind of file you want. Each one is made from the same read, so you can export several at once.',
      section: 'the-formats',
    },
    export: {
      title: 'Export',
      text: 'Writes the ticked messages in every ticked format.',
      section: 'the-formats',
    },
    'filename-template': {
      title: 'Filename template',
      text: 'How exported files are named. Words in curly brackets are filled in: {title}, {provider}, {host}, {date}, {time}, {count} (messages) and {id}.',
      section: 'options',
    },
    'tab-export': {
      title: 'Export tab',
      text: 'Read the open chat, check the preview and export it.',
      section: 'the-export-tab',
    },
    'tab-rules': {
      title: 'Site rules tab',
      text: 'Every set of rules the app knows — yours and the built-in ones — with whether each is working. Turn them on or off, fix, remove, import and export them here.',
      section: 'the-site-rules-tab',
    },
    'tab-options': {
      title: 'Options tab',
      text: 'What goes into an export and how it looks, how patiently pages are read, and find-and-replace redaction.',
      section: 'options',
    },
    'tab-batch': {
      title: 'Batch tab',
      text: 'Export many chats in one go from a list of links.',
      section: 'batch-export',
    },
    'tab-merge': {
      title: 'Merge tab',
      text: 'Combine several exported chats into one document with a table of contents.',
      section: 'merging-chats',
    },
    'tab-library': {
      title: 'Library tab',
      text: 'Everything you have exported, searchable by its full text.',
      section: 'the-library-and-search',
    },
    'rules-import': {
      title: 'Import rules',
      text: 'Adds the rules in a file someone exported — from the other app, a friend or a bug report. Nothing you already have is changed.',
      section: 'importing-and-exporting-rules',
    },
    'rules-export': {
      title: 'Export rules',
      text: 'Saves your rules to a file, to back them up, move them between the desktop app and the extension, or share them.',
      section: 'importing-and-exporting-rules',
    },
    'rules-filter': {
      title: 'Find a site',
      text: 'Shows only the rules whose name or site contains what you type.',
      section: 'the-site-rules-tab',
    },
    'rules-legend': {
      title: 'What the colours mean',
      text: 'Each kind of thing a rule can point at has its own colour, the same in the app and on the page.',
      section: 'the-parts-and-their-colours',
    },
    'rule-card': {
      title: 'A site and its rules',
      text: 'One card per site, with every rule set it has — the built-in one and yours. The green row is the one that reads the site. Each dot says whether those rules worked last time: green working, amber worth a look, red broken, grey not checked yet.',
      section: 'the-site-rules-tab',
    },
    'rules-use': {
      title: 'Use these rules',
      text: 'Chooses which of the site’s rule sets reads it from now on. The others stay in the list, ready to switch back to.',
      section: 'several-rule-sets-for-one-site',
    },
    'rules-copy': {
      title: 'Make a copy',
      text: 'A new rule set of your own that starts as a copy of this one, to change without touching the original. The copy is not used until you choose it.',
      section: 'several-rule-sets-for-one-site',
    },
    'rules-reset': {
      title: 'Back to the built-in rules',
      text: 'Reads this site with the rules the app came with again. Your own rule sets for it are kept, ready to choose again.',
      section: 'several-rule-sets-for-one-site',
    },
    'site-switch': {
      title: 'Rules to use',
      text: 'Shown when this site has more than one rule set: pick the one that reads it. Read the chat again to see what the new choice finds.',
      section: 'several-rule-sets-for-one-site',
    },
    'rules-restore': {
      title: 'Removed built-in rules',
      text: 'Built-in rules you removed. Restore brings them back exactly as they shipped.',
      section: 'built-in-rules',
    },
    'opt-thinking': {
      title: 'Include reasoning',
      text: 'Keeps the AI’s “thinking” or reasoning blocks in the export, set apart from the answer.',
      section: 'options',
    },
    'opt-system': {
      title: 'Include system & tool messages',
      text: 'Keeps messages that are neither yours nor the AI’s answer, such as tool output.',
      section: 'options',
    },
    'opt-meta': {
      title: 'Include title, source and date',
      text: 'Puts a short header at the top of the export saying what the chat is, where it came from and when.',
      section: 'options',
    },
    'opt-frontmatter': {
      title: 'YAML frontmatter',
      text: 'Adds a block of properties at the top of Markdown files, which note apps such as Obsidian read.',
      section: 'options',
    },
    'opt-embed': {
      title: 'Download and embed images',
      text: 'Saves the pictures themselves. Links from chat sites expire, so without this, pictures eventually stop showing.',
      section: 'options',
    },
    'opt-assets': {
      title: 'Where images go',
      text: 'Inside the file keeps everything in one file. Beside the file puts pictures in a folder next to it.',
      section: 'options',
    },
    'opt-theme': {
      title: 'Document theme',
      text: 'How PDF, HTML and image exports look: light, dark, or a serif style for printing.',
      section: 'options',
    },
    'opt-font': {
      title: 'Body size',
      text: 'Text size in the exported document.',
      section: 'options',
    },
    'opt-break': {
      title: 'Every message on a new page',
      text: 'Starts each message on a fresh page in PDFs.',
      section: 'options',
    },
    'opt-links': {
      title: 'Print link targets',
      text: 'Writes the web address after each link, so a printed copy still says where links go.',
      section: 'options',
    },
    'opt-settle': {
      title: 'Scroll settle',
      text: 'How long to wait for the site to redraw after each scroll. Raise it if long chats come back short on a slow site.',
      section: 'if-a-chat-comes-back-short',
    },
    'opt-maxread': {
      title: 'Give up reading after',
      text: 'A safety stop, so a difficult page can never make a read run forever. Raise it if a very long chat is cut short.',
      section: 'if-a-chat-comes-back-short',
    },
    'opt-jpeg': {
      title: 'JPEG quality',
      text: 'Higher is sharper and larger. 90 is a good balance.',
      section: 'options',
    },
    redaction: {
      title: 'Redaction',
      text: 'Find-and-replace rules applied to every format before anything is saved — for removing names, keys or addresses from a chat you are about to share.',
      section: 'redaction',
    },
    'redaction-add': {
      title: 'Add a redaction rule',
      text: 'Adds a row: what to find, and what to put instead. Tick “re” to use a regular expression.',
      section: 'redaction',
    },
    'settings-reset': {
      title: 'Reset all options to defaults',
      text: 'Puts every option back to its default — the defaults in config/default-settings.json. Your rules, library and exported chats are not touched.',
      section: 'default-options-and-your-changes',
    },
    'batch-urls': {
      title: 'Links to export',
      text: 'One chat link per line.',
      section: 'batch-export',
    },
    'batch-guess': {
      title: 'Also export sites with no rules',
      text: 'Normally a link to a site with no rules is skipped, so nothing is exported from a guess nobody checked. Tick this to export those too.',
      section: 'batch-export',
    },
    'batch-run': {
      title: 'Run batch',
      text: 'Opens, reads and exports each link in turn with the formats chosen on the first tab. Sites whose rules fail are skipped and listed.',
      section: 'batch-export',
    },
    'batch-stop': {
      title: 'Stop',
      text: 'Stops after the chat currently being exported.',
      section: 'batch-export',
    },
    'merge-title': {
      title: 'Document title',
      text: 'The title of the merged document, also used for its file name.',
      section: 'merging-chats',
    },
    'merge-files': {
      title: 'Add .json files',
      text: 'Adds chats from JSON files exported earlier, by either app.',
      section: 'merging-chats',
    },
    'merge-clear': {
      title: 'Clear selection',
      text: 'Unticks everything chosen for the merge.',
      section: 'merging-chats',
    },
    'merge-list': {
      title: 'Chats to merge',
      text: 'Tick the exported chats to combine. They appear in the order listed.',
      section: 'merging-chats',
    },
    'merge-formats': {
      title: 'Merged formats',
      text: 'The kinds of file to make from the merged chats.',
      section: 'merging-chats',
    },
    'merge-run': {
      title: 'Merge',
      text: 'Builds one document from the ticked chats, with a table of contents.',
      section: 'merging-chats',
    },
    'library-search': {
      title: 'Search',
      text: 'Finds exported chats by any words in them. Every word must appear somewhere in the chat.',
      section: 'the-library-and-search',
    },
    'library-clear': {
      title: 'Clear library',
      text: 'Forgets every exported chat in the library. Your exported files are not touched.',
      section: 'the-library-and-search',
    },
    'help-manual': {
      title: 'User manual',
      text: 'The full manual: every part of the app, step by step. Also on the F1 key.',
      section: 'help-inside-the-app',
    },
    'help-whats-this': {
      title: 'What’s this?',
      text: 'Turns on this mode: click anything in the app to see what it does. Press Esc or click this button again to leave it.',
      section: 'help-inside-the-app',
    },

    /* ----------------------------------------------------- desktop only */
    'url-input': {
      title: 'Chat link',
      text: 'Paste a chat’s share link, or any address. Press Enter or Load to open it in the browser pane below. You can also sign in to a chat site there and open your private chats.',
      section: 'opening-a-chat',
    },
    load: {
      title: 'Load',
      text: 'Opens the address typed on the left.',
      section: 'opening-a-chat',
    },
    'nav-back': { title: 'Back', text: 'Goes back a page in the browser pane.', section: 'opening-a-chat' },
    'nav-forward': { title: 'Forward', text: 'Goes forward a page in the browser pane.', section: 'opening-a-chat' },
    'nav-reload': { title: 'Reload', text: 'Loads the page again.', section: 'opening-a-chat' },
    'zoom-out': { title: 'Zoom out', text: 'Makes the page in the browser pane smaller.', section: 'opening-a-chat' },
    'zoom-in': { title: 'Zoom in', text: 'Makes the page in the browser pane larger.', section: 'opening-a-chat' },
    devtools: {
      title: 'Inspect the page',
      text: 'Opens the browser’s developer tools for the loaded page. Only needed when reporting a problem.',
      section: 'opening-a-chat',
    },
    'capture-mode': {
      title: 'PDF & image style',
      text: 'Clean document retypesets the chat neatly. As shown on the site captures the page as the site drew it — but on a long chat only what the site had loaded.',
      section: 'pdf-and-image-style',
    },
    'save-to': {
      title: 'Save to',
      text: 'The folder exports are written to.',
      section: 'options',
    },
    browse: { title: 'Browse', text: 'Chooses the folder exports are written to.', section: 'options' },
    'open-after': {
      title: 'Open the folder when done',
      text: 'Opens the export folder once the files are written.',
      section: 'options',
    },
    'opt-page': {
      title: 'Page setup',
      text: 'Paper size, margins, scale, landscape and page numbers for PDF exports.',
      section: 'options',
    },
    'sign-out': {
      title: 'Sign out of all chat sites',
      text: 'Clears every sign-in and cookie in the app’s browser pane. Your exports, library and rules are not touched.',
      section: 'where-your-data-lives',
    },
    'library-folder': {
      title: 'Open export folder',
      text: 'Opens the folder exports are written to.',
      section: 'the-library-and-search',
    },
    'data-folder': {
      title: 'Where your files are kept',
      text: 'The data folder: your changed options, site rules and library, each in a folder of its own, and exports unless “Save to” says otherwise (the installed app keeps them in Documents\\AI Chat Exports). Click a row to open that folder.',
      section: 'the-data-folder-desktop-app',
    },
    'data-open': {
      title: 'Open folder',
      text: 'Opens the data folder in Explorer.',
      section: 'the-data-folder-desktop-app',
    },
    'data-change': {
      title: 'Change…',
      text: 'Keeps your files in another folder from the next start. Your settings, rules and library are copied there; the old folder is left as it was.',
      section: 'moving-the-data-folder',
    },
    'data-default': {
      title: 'Use the default',
      text: 'Goes back to the default data folder from the next start, copying your files there if it has none.',
      section: 'moving-the-data-folder',
    },

    /* --------------------------------------------------- extension only */
    'ext-folder': {
      title: 'Where your files are kept',
      text: 'Your options and site rules are kept in the browser. Choose a folder to keep them there too — and exports — such as the project’s data folder, which the desktop app uses.',
      section: 'a-folder-for-the-extension',
    },
    'ext-folder-choose': {
      title: 'Choose a folder…',
      text: 'Picks the folder to keep files in. Choosing the desktop app’s data folder shares one set of site rules between the two. Chrome and Edge only.',
      section: 'a-folder-for-the-extension',
    },
    'ext-folder-allow': {
      title: 'Allow access again',
      text: 'After a restart the browser asks once more before the extension may write to the folder. Until then, changes stay in the browser.',
      section: 'a-folder-for-the-extension',
    },
    'ext-folder-forget': {
      title: 'Stop using it',
      text: 'The extension stops writing to the folder. The folder and its files are left as they are.',
      section: 'a-folder-for-the-extension',
    },
    'ext-target': {
      title: 'Attached chat',
      text: 'The browser tab this workspace reads from. Open the workspace from the toolbar button while the chat is on screen to attach it.',
      section: 'the-browser-extension',
    },
    'ext-shot-delay': {
      title: 'Screenshot step delay',
      text: 'Browsers limit how often an extension may take screenshots. Below about 500 ms, image exports start losing pieces.',
      section: 'options',
    },
    'ext-min-code': {
      title: 'Ignore short snippets',
      text: 'Code blocks shorter than this many lines are not written as separate files.',
      section: 'options',
    },
    'ext-assistant-code': {
      title: 'Only the AI’s code',
      text: 'Code files are taken only from the AI’s replies, not from code you pasted.',
      section: 'options',
    },
  };

  /**
   * The anchor GitHub gives a heading, so links into the manual work the same
   * on github.com and inside the app.
   */
  function slug(text) {
    return String(text || '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
  }

  /**
   * Turns the manual's Markdown into HTML with heading anchors, plus a table of
   * contents. `parse` is a Markdown renderer (marked), passed in so this file
   * stays dependency-free for the desktop renderer.
   */
  function buildManual(markdown, parse) {
    const html = parse(String(markdown || ''));
    const seen = new Map();
    const toc = [];
    const withIds = html.replace(/<h([1-4])>([\s\S]*?)<\/h\1>/g, (whole, level, inner) => {
      const base = slug(inner);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const id = count ? `${base}-${count}` : base;
      const text = inner.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      if (level === '2' || level === '3') toc.push({ level: Number(level), id, text });
      return `<h${level} id="${id}">${inner}</h${level}>`;
    });
    return { html: withIds, toc };
  }

  function topic(key) {
    return TOPICS[key] || null;
  }

  return { TOPICS, topic, slug, buildManual };
});
