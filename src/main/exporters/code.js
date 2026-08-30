'use strict';

const { marked } = require('marked');

/**
 * Pulls every fenced code block out of a conversation and turns it into real
 * source files.
 *
 * The point is to skip the copy-paste-and-rename ritual after a long session
 * with an assistant: you get a folder of runnable files with the right
 * extensions, plus a manifest saying which message each one came from.
 */

/** Fence language → file extension. The key is what models actually emit. */
const LANGUAGE_EXTENSIONS = {
  javascript: 'js', js: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
  typescript: 'ts', ts: 'ts', tsx: 'tsx',
  python: 'py', py: 'py', python3: 'py',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  powershell: 'ps1', ps1: 'ps1', pwsh: 'ps1',
  bat: 'bat', batch: 'bat', cmd: 'bat',
  html: 'html', xhtml: 'html', vue: 'vue', svelte: 'svelte',
  css: 'css', scss: 'scss', sass: 'sass', less: 'less',
  json: 'json', json5: 'json5', jsonc: 'jsonc',
  yaml: 'yml', yml: 'yml', toml: 'toml', ini: 'ini', env: 'env',
  xml: 'xml', svg: 'svg',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  java: 'java', kotlin: 'kt', kt: 'kt', scala: 'scala', groovy: 'groovy',
  c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cxx: 'cpp', hpp: 'hpp',
  csharp: 'cs', 'c#': 'cs', cs: 'cs', fsharp: 'fs',
  go: 'go', golang: 'go', rust: 'rs', rs: 'rs',
  php: 'php', ruby: 'rb', rb: 'rb', perl: 'pl', lua: 'lua',
  swift: 'swift', objectivec: 'm', dart: 'dart', r: 'r', julia: 'jl',
  matlab: 'm', haskell: 'hs', elixir: 'ex', erlang: 'erl', clojure: 'clj',
  dockerfile: 'Dockerfile', docker: 'Dockerfile',
  makefile: 'Makefile', make: 'Makefile', cmake: 'cmake',
  markdown: 'md', md: 'md', latex: 'tex', tex: 'tex',
  diff: 'diff', patch: 'patch', csv: 'csv', tsv: 'tsv',
  text: 'txt', plaintext: 'txt', txt: 'txt', '': 'txt',
};

/** Files whose name is fixed by convention rather than by extension. */
const WHOLE_FILENAMES = new Set(['Dockerfile', 'Makefile']);

function extensionFor(language) {
  const key = String(language || '').toLowerCase().trim();
  return LANGUAGE_EXTENSIONS[key] || (/^[a-z0-9]{1,8}$/.test(key) ? key : 'txt');
}

/** Walks the token tree so code inside lists and quotes is not missed. */
function collectCodeTokens(tokens, found = []) {
  for (const token of tokens || []) {
    if (token.type === 'code') found.push(token);
    if (token.tokens) collectCodeTokens(token.tokens, found);
    if (token.items) collectCodeTokens(token.items, found);
    if (Array.isArray(token.rows)) {
      for (const row of token.rows) collectCodeTokens(row, found);
    }
  }
  return found;
}

/**
 * Some models open a block with a path comment — `# src/app.py`, `// utils.ts`.
 * When one is there it beats any name we could invent.
 */
function filenameFromHeader(code) {
  const firstLine = String(code || '').split('\n', 1)[0].trim();
  const match = /^(?:#|\/\/|--|;|<!--)\s*([\w./-]+\.[A-Za-z0-9]{1,8})\s*(?:-->)?$/.exec(firstLine);
  if (!match) return null;
  const name = match[1].split(/[\\/]/).pop();
  return name && name.length <= 60 ? name : null;
}

function sanitizeSegment(str) {
  return String(str || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/**
 * @param {object} conversation prepared conversation
 * @param {object} opts
 * @returns {{files: {filename: string, content: string, language: string, messageIndex: number, lines: number}[], manifest: string}}
 */
function extractCodeBlocks(conversation, opts = {}) {
  const minLines = Number.isFinite(opts.minCodeLines) ? opts.minCodeLines : 1;
  const files = [];
  const usedNames = new Set();
  let counter = 0;

  for (const message of conversation.messages) {
    if (opts.assistantOnly && message.role !== 'assistant') continue;

    let tokens;
    try {
      tokens = marked.lexer(message.markdown || '');
    } catch {
      continue;
    }

    for (const token of collectCodeTokens(tokens)) {
      const content = String(token.text || '');
      const lines = content.split('\n').length;
      if (!content.trim() || lines < minLines) continue;

      counter += 1;
      const language = (token.lang || '').split(/\s+/)[0] || '';
      const ext = extensionFor(language);
      const prefix = String(counter).padStart(2, '0');

      let name = filenameFromHeader(content);
      if (name) {
        name = `${prefix}-${sanitizeSegment(name.replace(/\.[^.]+$/, ''))}.${name.split('.').pop()}`;
      } else if (WHOLE_FILENAMES.has(ext)) {
        name = `${prefix}-${ext}`;
      } else {
        name = `${prefix}-message-${message.index + 1}-${sanitizeSegment(language || 'snippet')}.${ext}`;
      }

      // Guard against two blocks claiming the same header-derived name.
      let unique = name;
      let attempt = 2;
      while (usedNames.has(unique)) {
        const dot = name.lastIndexOf('.');
        unique = dot > 0 ? `${name.slice(0, dot)}-${attempt}${name.slice(dot)}` : `${name}-${attempt}`;
        attempt++;
      }
      usedNames.add(unique);

      files.push({
        filename: unique,
        content: content.endsWith('\n') ? content : content + '\n',
        language: language || 'unknown',
        messageIndex: message.index,
        messageLabel: message.label,
        lines,
      });
    }
  }

  return { files, manifest: buildManifest(conversation, files) };
}

function buildManifest(conversation, files) {
  const lines = [
    `# Code from "${conversation.title}"`,
    '',
    `Extracted ${files.length} block${files.length === 1 ? '' : 's'} from ${conversation.messages.length} messages.`,
  ];
  if (conversation.url) lines.push('', `Source: ${conversation.url}`);
  lines.push('', '| File | Language | Lines | From |', '| --- | --- | --- | --- |');
  for (const file of files) {
    lines.push(`| \`${file.filename}\` | ${file.language} | ${file.lines} | message ${file.messageIndex + 1} (${file.messageLabel}) |`);
  }
  return lines.join('\n') + '\n';
}

module.exports = { extractCodeBlocks, extensionFor, LANGUAGE_EXTENSIONS };
