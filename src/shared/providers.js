'use strict';

/**
 * Provider selector packs.
 *
 * These describe how to pull turns out of a given chat site's DOM. They are a
 * best-effort starting point: every one of these sites ships markup changes
 * regularly, so treat a pack as a hint, not a contract. When a pack stops
 * matching, the extractor falls back to the structural heuristic, and past that
 * the user can point at the message container by hand with the element picker
 * (see src/inject/picker.js). Picked selectors are stored as user packs and
 * take priority over everything here.
 *
 * Pack fields (all optional except id/name/hosts):
 *   hosts            hostname substrings this pack claims
 *   turnSelector     one turn (message) per match
 *   roleAttr         attribute on the turn holding the role
 *   roleMap          maps raw attr/class values onto 'user' | 'assistant'
 *   userSelector     a turn matching this is a user turn
 *   assistantSelector  ...likewise for assistant
 *   exchangeAssistantSelector
 *                    set when one turnSelector match holds BOTH speakers; marks
 *                    the assistant half so the two can be split apart
 *   contentSelector  richest content node inside the turn
 *   thinkingSelector reasoning / chain-of-thought block inside the turn
 *   titleSelector    conversation title
 *   scrollSelector   the scrollable element, when it isn't the window
 *   expandSelectors  clicked before extraction to unfold collapsed content
 *   stripSelectors   removed from content before serialising
 */

/** Junk that is never part of a message, stripped from every provider. */
const COMMON_STRIP = [
  'script',
  'style',
  'noscript',
  'svg',
  'button',
  'form',
  '.sr-only',
  '[aria-hidden="true"]',
  '[role="toolbar"]',
  '[data-state="closed"][role="tooltip"]',
  // The clickable header of a collapsible section - "show reasoning steps" and
  // a chevron. It is a control, not content, and reads as noise at the top of
  // an exported reasoning block.
  '[class*="expandable-header"]',
  '[class*="collapse-header"]',
  '[class*="toggle-icon"]',
];

/** Buttons that unfold hidden content, common across most chat UIs. */
const COMMON_EXPAND = [
  'details:not([open]) > summary',
  '[aria-expanded="false"]',
  'button[data-testid*="expand"]',
];

const PROVIDERS = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com', 'openai.com'],
    turnSelector: '[data-message-author-role]',
    roleAttr: 'data-message-author-role',
    roleMap: { user: 'user', assistant: 'assistant', system: 'system', tool: 'tool' },
    contentSelector: '.markdown, .whitespace-pre-wrap',
    thinkingSelector: '[data-testid*="thinking"], [data-testid*="reasoning"]',
    titleSelector: 'h1, title',
    expandSelectors: ['button[aria-expanded="false"]'],
  },
  {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai', 'anthropic.com'],
    turnSelector:
      '[data-testid="user-message"], [data-testid="assistant-message"], .font-user-message, .font-claude-message',
    userSelector: '[data-testid="user-message"], .font-user-message',
    assistantSelector: '[data-testid="assistant-message"], .font-claude-message',
    thinkingSelector: '[data-testid*="thinking"], [class*="thinking"]',
    titleSelector: '[data-testid="chat-menu-trigger"], h1, title',
    expandSelectors: ['button[aria-expanded="false"]', 'details:not([open]) > summary'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com', 'g.co', 'bard.google.com'],
    turnSelector: 'user-query, model-response',
    userSelector: 'user-query',
    assistantSelector: 'model-response',
    contentSelector: '.query-text, message-content, .markdown',
    thinkingSelector: '[class*="thought"]',
    titleSelector: 'h1, title',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hosts: ['deepseek.com'],
    // DeepSeek ships hashed class names; only the markdown wrapper is stable.
    turnSelector: '[class*="ds-markdown"], [class*="fbb737a4"]',
    assistantSelector: '[class*="ds-markdown"]',
    thinkingSelector: '[class*="thinking"], [class*="e1675d8b"]',
    titleSelector: 'title',
  },
  {
    id: 'grok',
    name: 'Grok',
    hosts: ['grok.com', 'x.ai'],
    turnSelector: '[class*="message-bubble"], [data-testid*="message"]',
    contentSelector: '.response-content-markdown, [class*="markdown"]',
    titleSelector: 'h1, title',
  },
  {
    id: 'copilot',
    name: 'Microsoft Copilot',
    hosts: ['copilot.microsoft.com', 'bing.com'],
    turnSelector: '[data-content="ai-message"], [data-content="user-message"]',
    userSelector: '[data-content="user-message"]',
    assistantSelector: '[data-content="ai-message"]',
    titleSelector: 'h1, title',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    hosts: ['perplexity.ai'],
    turnSelector: '[class*="pb-md"] .prose, [class*="answer"], [data-testid*="answer"]',
    contentSelector: '.prose',
    titleSelector: 'h1, title',
  },
  {
    id: 'poe',
    name: 'Poe',
    hosts: ['poe.com'],
    turnSelector: '[class*="ChatMessage_messageRow"]',
    userSelector: '[class*="ChatMessage_rightSideMessageWrapper"]',
    assistantSelector: '[class*="Message_botMessageBubble"], [class*="ChatMessage_messageWrapper"]',
    contentSelector: '[class*="Markdown_markdownContainer"]',
    titleSelector: 'title',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    hosts: ['qwen.ai', 'tongyi.aliyun.com', 'qianwen.aliyun.com'],
    turnSelector: '[class*="chat-message"], [class*="messageItem"]',
    contentSelector: '[class*="markdown"]',
    titleSelector: 'title',
  },
  {
    id: 'mistral',
    name: 'Le Chat (Mistral)',
    hosts: ['chat.mistral.ai', 'mistral.ai'],
    turnSelector: '[data-message-role], [class*="message"]',
    roleAttr: 'data-message-role',
    contentSelector: '[class*="prose"], [class*="markdown"]',
    titleSelector: 'h1, title',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    hosts: ['kimi.moonshot.cn', 'kimi.com'],
    turnSelector: '[class*="segment-"], [class*="chat-item"]',
    contentSelector: '[class*="markdown"]',
    titleSelector: 'title',
  },
  {
    id: 'gapgpt',
    name: 'GapGPT',
    hosts: ['gapgpt.app', 'gapgpt.ir'],
    // A Quasar/Vue application. Its message elements carry no classes at all —
    // only build-generated scoped-style attributes such as data-v-14e4519f,
    // which change whenever the site is rebuilt and so are useless to match on.
    // The framework's own container classes are the stable part.
    scrollSelector: '.q-scrollarea__container',
    turnSelector: '.q-infinite-scroll > div',
    // Each of those children is a whole exchange: the question and the answer
    // in one element, with nothing separating them but the fact that the answer
    // is rendered markdown. See splitExchange() in src/inject/extract.js.
    exchangeAssistantSelector: '[class*="markdown"]',
    thinkingSelector: '[class*="thinking"], [class*="reasoning"]',
  },
  {
    // Most other proxy/aggregator front-ends are re-skins of one of
    // the big open-source chat UIs, so match those UIs rather than the brand.
    id: 'openui-clone',
    name: 'ChatGPT-compatible front-end',
    // This pack matches by UI framework, not by brand, so its name describes a
    // category rather than a product. Showing it as the assistant's name in an
    // exported document reads as a bug; callers substitute the site's own
    // hostname instead.
    genericName: true,
    hosts: [
      'librechat',
      'openwebui',
      'chatbot.theb.ai',
      'you.com',
    ],
    turnSelector: [
      '[data-message-author-role]',
      '[data-testid^="convo-turn"]',
      '.chat-assistant',
      '.chat-user',
      '.chat-message',
      '[class*="message-render"]',
      '[class*="ChatMessage"]',
    ].join(', '),
    roleAttr: 'data-message-author-role',
    userSelector: '.chat-user, .chat-message-user, [data-message-author-role="user"]',
    assistantSelector:
      '.chat-assistant, .chat-message-assistant, [data-message-author-role="assistant"]',
    contentSelector: '.markdown, [class*="markdown"], [class*="prose"]',
    titleSelector: 'h1, title',
  },
];

/** Picks the pack whose hosts match `url`, or null for unknown sites. */
function matchProvider(url, packs = PROVIDERS) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Longest host match wins so 'chat.mistral.ai' beats a bare 'mistral.ai'.
  let best = null;
  let bestLen = -1;
  for (const pack of packs) {
    for (const candidate of pack.hosts || []) {
      const needle = candidate.toLowerCase();
      if ((host === needle || host.endsWith('.' + needle) || host.includes(needle)) && needle.length > bestLen) {
        best = pack;
        bestLen = needle.length;
      }
    }
  }
  return best;
}

module.exports = { PROVIDERS, COMMON_STRIP, COMMON_EXPAND, matchProvider };
