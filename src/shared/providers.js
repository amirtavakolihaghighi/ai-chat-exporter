'use strict';

/**
 * Built-in site rules.
 *
 * These are the rules the app ships with, written in exactly the same shape as
 * the rules a person teaches it (see src/shared/rules.js), so the rule manager
 * can show them, check them and let them be turned off or removed like any
 * other. They are a best-effort starting point: every one of these sites ships
 * markup changes regularly, so a rule here is a hint, not a contract. When one
 * stops matching, the read stops and says so rather than guessing — and the fix
 * is to teach the site again, which takes seconds.
 *
 * Rule fields:
 *   id, name, hosts  identity; hosts are hostname fragments this rule claims
 *   verified         a real conversation has been exported and checked with it
 *   genericName      the name describes a category of site, not a product, so
 *                    exports name the assistant after the site's own hostname
 *   parts            CSS selectors per part — see src/shared/parts.js:
 *     user           each match is one message you sent
 *     assistant      each match is one AI reply
 *     message        each match is one message; the speaker is worked out
 *     thinking       reasoning blocks, looked for inside messages
 *     body           the text part of a message, when it carries extras
 *     exclude        never exported, wherever it is
 *     title          the conversation's title
 *     scroll         the element that scrolls, when it is not the window
 *     expand         clicked before reading to unfold hidden content
 *   options          how to tell speakers apart inside `message` matches:
 *     roleAttr       attribute holding the speaker
 *     roleMap        maps raw attribute values onto user | assistant | system | tool
 *     userMarker     a message containing (or matching) this is yours
 *     assistantMarker  ...likewise for the AI
 *     exchangeAssistant
 *                    set when one `message` match holds BOTH speakers; marks
 *                    the AI half so the two can be split apart
 */

/** Junk that is never part of a message, stripped from every site. */
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
    parts: {
      user: ['[data-message-author-role="user"]'],
      assistant: ['[data-message-author-role="assistant"]'],
      // Anything else carrying a speaker attribute — system and tool messages,
      // and whatever new kind the site adds next — is still a message.
      message: ['[data-message-author-role]'],
      body: ['.markdown', '.whitespace-pre-wrap'],
      thinking: ['[data-testid*="thinking"]', '[data-testid*="reasoning"]'],
      expand: ['button[aria-expanded="false"]'],
    },
    options: {
      roleAttr: 'data-message-author-role',
      roleMap: { user: 'user', assistant: 'assistant', system: 'system', tool: 'tool' },
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    hosts: ['claude.ai', 'anthropic.com'],
    parts: {
      user: ['[data-testid="user-message"]', '.font-user-message'],
      assistant: ['[data-testid="assistant-message"]', '.font-claude-message'],
      thinking: ['[data-testid*="thinking"]', '[class*="thinking"]'],
      title: ['[data-testid="chat-menu-trigger"]'],
      expand: ['button[aria-expanded="false"]', 'details:not([open]) > summary'],
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    hosts: ['gemini.google.com', 'g.co', 'bard.google.com'],
    parts: {
      user: ['user-query'],
      assistant: ['model-response'],
      body: ['.query-text', 'message-content', '.markdown'],
      thinking: ['[class*="thought"]'],
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    hosts: ['deepseek.com'],
    parts: {
      // DeepSeek ships hashed class names; only the markdown wrapper is stable.
      user: ['[class*="fbb737a4"]'],
      assistant: ['[class*="ds-markdown"]'],
      thinking: ['[class*="thinking"]', '[class*="e1675d8b"]'],
    },
  },
  {
    id: 'grok',
    name: 'Grok',
    hosts: ['grok.com', 'x.ai'],
    parts: {
      message: ['[class*="message-bubble"]', '[data-testid*="message"]'],
      body: ['.response-content-markdown', '[class*="markdown"]'],
    },
  },
  {
    id: 'copilot',
    name: 'Microsoft Copilot',
    hosts: ['copilot.microsoft.com', 'bing.com'],
    parts: {
      user: ['[data-content="user-message"]'],
      assistant: ['[data-content="ai-message"]'],
    },
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    hosts: ['perplexity.ai'],
    parts: {
      message: ['[class*="pb-md"] .prose', '[class*="answer"]', '[data-testid*="answer"]'],
      body: ['.prose'],
    },
  },
  {
    id: 'poe',
    name: 'Poe',
    hosts: ['poe.com'],
    parts: {
      message: ['[class*="ChatMessage_messageRow"]'],
      body: ['[class*="Markdown_markdownContainer"]'],
    },
    options: {
      userMarker: '[class*="ChatMessage_rightSideMessageWrapper"]',
      assistantMarker: '[class*="Message_botMessageBubble"], [class*="ChatMessage_messageWrapper"]',
    },
  },
  {
    id: 'qwen',
    name: 'Qwen',
    hosts: ['qwen.ai', 'tongyi.aliyun.com', 'qianwen.aliyun.com'],
    parts: {
      message: ['[class*="chat-message"]', '[class*="messageItem"]'],
      body: ['[class*="markdown"]'],
    },
  },
  {
    id: 'mistral',
    name: 'Le Chat (Mistral)',
    hosts: ['chat.mistral.ai', 'mistral.ai'],
    parts: {
      message: ['[data-message-role]', '[class*="message"]'],
      body: ['[class*="prose"]', '[class*="markdown"]'],
    },
    options: { roleAttr: 'data-message-role' },
  },
  {
    id: 'kimi',
    name: 'Kimi',
    hosts: ['kimi.moonshot.cn', 'kimi.com'],
    parts: {
      message: ['[class*="segment-"]', '[class*="chat-item"]'],
      body: ['[class*="markdown"]'],
    },
  },
  {
    id: 'gapgpt',
    name: 'GapGPT',
    hosts: ['gapgpt.app', 'gapgpt.ir'],
    verified: true,
    parts: {
      // A Quasar/Vue application. Its message elements carry no classes at all —
      // only build-generated scoped-style attributes such as data-v-14e4519f,
      // which change whenever the site is rebuilt and so are useless to match on.
      // The framework's own container classes are the stable part.
      message: ['.q-infinite-scroll > div'],
      thinking: ['[class*="thinking"]', '[class*="reasoning"]'],
      scroll: ['.q-scrollarea__container'],
    },
    options: {
      // Each of those children is a whole exchange: the question and the answer
      // in one element, with nothing separating them but the fact that the
      // answer is rendered markdown. See splitExchange() in src/inject/extract.js.
      exchangeAssistant: '[class*="markdown"]',
    },
  },
  {
    // Most other proxy/aggregator front-ends are re-skins of one of
    // the big open-source chat UIs, so match those UIs rather than the brand.
    id: 'openui-clone',
    name: 'ChatGPT-compatible front-end',
    // This rule matches by UI framework, not by brand, so its name describes a
    // category rather than a product. Showing it as the assistant's name in an
    // exported document reads as a bug; callers substitute the site's own
    // hostname instead.
    genericName: true,
    hosts: ['librechat', 'openwebui', 'chatbot.theb.ai', 'you.com'],
    parts: {
      message: [
        '[data-message-author-role]',
        '[data-testid^="convo-turn"]',
        '.chat-assistant',
        '.chat-user',
        '.chat-message',
        '[class*="message-render"]',
        '[class*="ChatMessage"]',
      ],
      body: ['.markdown', '[class*="markdown"]', '[class*="prose"]'],
    },
    options: {
      roleAttr: 'data-message-author-role',
      userMarker: '.chat-user, .chat-message-user, [data-message-author-role="user"]',
      assistantMarker: '.chat-assistant, .chat-message-assistant, [data-message-author-role="assistant"]',
    },
  },
];

/**
 * Length of the longest of `hosts` that `host` falls under, or -1.
 *
 * Built-in rules may name a fragment ('librechat') rather than a full hostname,
 * because self-hosted copies of those front-ends live on every domain there is.
 * Only a fragment — a name with no dot in it — may match anywhere inside a
 * hostname. A real hostname has to match exactly or as a parent domain: matched
 * loosely, 'g.co' claimed blog.company.com for Gemini.
 */
function hostMatchLength(hosts, host, { loose = true } = {}) {
  let best = -1;
  for (const candidate of hosts || []) {
    const needle = String(candidate).toLowerCase();
    if (!needle) continue;
    const fragment = loose && !needle.includes('.');
    const hit = host === needle || host.endsWith('.' + needle) || (fragment && host.includes(needle));
    if (hit && needle.length > best) best = needle.length;
  }
  return best;
}

/** Picks the built-in rule whose hosts match `url`, or null for unknown sites. */
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
    const len = hostMatchLength(pack.hosts, host);
    if (len > bestLen) {
      best = pack;
      bestLen = len;
    }
  }
  return best;
}

module.exports = { PROVIDERS, COMMON_STRIP, COMMON_EXPAND, matchProvider, hostMatchLength };
