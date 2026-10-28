/**
 * The kinds of thing a site rule can point at, and how each one is shown.
 *
 * Every layer uses this list. The extractor reads rules by these keys, the
 * in-page teach overlay draws its boxes in these colours, and both apps' rule
 * managers use the same labels and colours, so a colour means the same thing
 * wherever it appears. Each box also carries a text label: colour is never the
 * only signal.
 *
 * Loaded two ways, like the injectable scripts: required as a CommonJS module
 * (main process, extension bundles, tests), or included with a plain <script>
 * tag in the desktop renderer, where it defines `AceParts`.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = value;
  else root.AceParts = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * group:
   *   message  each match is one message
   *   inside   looked for inside messages
   *   anywhere anywhere on the page
   *   page     one thing about the page as a whole
   */
  const PARTS = [
    {
      key: 'user',
      label: 'Your messages',
      short: 'You',
      color: '#3b82f6',
      group: 'message',
      role: 'user',
      main: true,
      pick: 'Click one of your own messages.',
      help: 'One box around each message you sent.',
    },
    {
      key: 'assistant',
      label: 'AI replies',
      short: 'AI',
      color: '#22c55e',
      group: 'message',
      role: 'assistant',
      main: true,
      pick: 'Click one of the AI’s replies.',
      help: 'One box around each reply from the AI.',
    },
    {
      key: 'thinking',
      label: 'Reasoning',
      short: 'Reasoning',
      color: '#a855f7',
      group: 'inside',
      pick: 'Click the AI’s reasoning or “thinking” block.',
      help: 'The AI’s reasoning or “thinking” block. It is kept apart from the answer, and can be left out of exports in Options.',
    },
    {
      key: 'exclude',
      label: 'Leave out',
      short: 'Leave out',
      color: '#ef4444',
      group: 'anywhere',
      pick: 'Click something that should never be exported.',
      help: 'Nothing inside these boxes is ever exported: toolbars, banners, source lists, adverts. Messages inside them are ignored.',
    },
    {
      key: 'body',
      label: 'Message text',
      short: 'Text',
      color: '#eab308',
      group: 'inside',
      pick: 'Click the text part of a message.',
      help: 'Optional. Only this part of each message is kept, which drops extras around the text such as names, avatars or times.',
    },
    {
      key: 'title',
      label: 'Chat title',
      short: 'Title',
      color: '#f97316',
      group: 'page',
      single: true,
      pick: 'Click the chat’s title.',
      help: 'Where the conversation’s title is shown. Without it the browser tab’s title is used.',
    },
    {
      key: 'expand',
      label: '“Show more” buttons',
      short: 'Show more',
      color: '#ec4899',
      group: 'page',
      pick: 'Click a button that unfolds hidden text.',
      help: 'Buttons pressed before reading, to unfold hidden text such as “Show more” or collapsed reasoning.',
    },
    {
      key: 'scroll',
      label: 'Scrolling area',
      short: 'Scroll',
      color: '#94a3b8',
      group: 'page',
      single: true,
      pick: 'Click inside the area that scrolls through the chat.',
      help: 'The part of the page that scrolls through the conversation. Found automatically; only set it if long chats come back short.',
    },
    {
      key: 'message',
      label: 'Messages, speaker guessed',
      short: 'Message',
      color: '#06b6d4',
      group: 'message',
      role: null,
      pick: 'Click any message.',
      help: 'Messages where the app works out who is speaking by itself. Built-in rules use this for sites that mark both speakers the same way.',
    },
  ];

  const PART_KEYS = PARTS.map((p) => p.key);
  const MESSAGE_PARTS = PARTS.filter((p) => p.group === 'message').map((p) => p.key);

  /** Colours for a rule's health, shared for the same reason. */
  const STATUS = {
    ok: { color: '#22c55e', label: 'Working' },
    warn: { color: '#f59e0b', label: 'Needs a look' },
    broken: { color: '#ef4444', label: 'Broken' },
    unknown: { color: '#94a3b8', label: 'Not checked yet' },
    off: { color: '#64748b', label: 'Turned off' },
  };

  function partByKey(key) {
    return PARTS.find((p) => p.key === key) || null;
  }

  return { PARTS, PART_KEYS, MESSAGE_PARTS, STATUS, partByKey };
});
