'use strict';

const JSZip = require('jszip');
const { Packer } = require('docx');

const convert = require('../../../src/main/lib/convert.js');
const { renderHtml } = require('../../../src/main/lib/render.js');
const { buildDocument } = require('../../../src/main/exporters/docx.js');
const { extractCodeBlocks } = require('../../../src/main/exporters/code.js');
const merge = require('../../../src/main/exporters/merge.js');

const { downloadBlob, textBlob, safeSegment } = require('./download');

/**
 * Browser-side export orchestrator.
 *
 * Every document builder is imported unchanged from the desktop app — the same
 * Markdown, HTML, DOCX, code and merge code paths. Only the last step differs:
 * where the desktop writes to a chosen folder, this hands a Blob to the
 * downloads API.
 */

/* -------------------------------------------------------------- filenames */

function formatFilename(template, conversation) {
  const now = new Date(conversation.capturedAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tokens = {
    title: conversation.title || 'chat',
    provider: conversation.providerName || conversation.providerId || 'ai',
    host: conversation.host || '',
    date,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}`,
    datetime: `${date} ${pad(now.getHours())}${pad(now.getMinutes())}`,
    count: String(conversation.messages?.length ?? 0),
    id: (() => {
      const m = /([0-9a-f-]{8,})\/?$/i.exec(conversation.url || '');
      return m ? m[1].slice(0, 12) : '';
    })(),
  };
  const filled = String(template || '{date} - {provider} - {title}').replace(
    /\{(\w+)\}/g,
    (m, key) => (key in tokens ? tokens[key] : m)
  );
  return safeSegment(filled);
}

/** Everything lands in one folder so exports never scatter across Downloads. */
const FOLDER = 'AI Chat Exports';

function inFolder(name) {
  return `${FOLDER}/${name}`;
}

/* ------------------------------------------------------------ text builders */

function yamlFrontmatter(conversation, opts) {
  const esc = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const tags = ['ai-chat', (conversation.providerId || 'unknown').toLowerCase()].filter(Boolean);
  return [
    '---',
    `title: ${esc(conversation.title)}`,
    `source: ${esc(conversation.url)}`,
    `provider: ${esc(conversation.providerName)}`,
    `captured: ${esc(conversation.capturedAt)}`,
    `messages: ${conversation.messages.length}`,
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

function buildMarkdown(conversation, opts = {}) {
  const parts = [];
  if (opts.frontmatter !== false) parts.push(yamlFrontmatter(conversation, opts));
  parts.push(`# ${conversation.title}\n`);

  if (opts.includeMeta !== false) {
    parts.push([
      `**Source:** ${conversation.url || 'n/a'}`,
      `**Provider:** ${conversation.providerName}`,
      `**Exported:** ${new Date(conversation.capturedAt || Date.now()).toLocaleString()}`,
      `**Messages:** ${conversation.messages.length}`,
    ].join('  \n') + '\n');
  }

  for (const msg of conversation.messages) {
    parts.push('\n---\n');
    parts.push(`## ${msg.label}\n`);
    if (msg.thinkingMarkdown) {
      const quoted = msg.thinkingMarkdown.split('\n').map((l) => `> ${l}`).join('\n');
      parts.push(`> **Reasoning**\n>\n${quoted}\n`);
    }
    parts.push(`${msg.markdown || msg.text || ''}\n`);
  }

  return parts.join('\n').replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

function buildText(conversation, opts = {}) {
  const lines = [conversation.title, '='.repeat(Math.min(conversation.title.length, 80))];
  if (opts.includeMeta !== false) {
    lines.push(`Source:   ${conversation.url || 'n/a'}`);
    lines.push(`Provider: ${conversation.providerName}`);
    lines.push(`Exported: ${new Date(conversation.capturedAt || Date.now()).toLocaleString()}`);
    lines.push(`Messages: ${conversation.messages.length}`);
  }
  lines.push('');
  for (const msg of conversation.messages) {
    lines.push('-'.repeat(72), `[${msg.label}]`, '');
    if (msg.thinkingHtml) {
      lines.push('  (reasoning)');
      lines.push(convert.htmlToText(msg.thinkingHtml).split('\n').map((l) => '  ' + l).join('\n'), '');
    }
    lines.push(convert.htmlToText(msg.html) || msg.text || '', '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function buildJson(conversation) {
  return JSON.stringify(
    {
      schema: 'ai-chat-extractor/v1',
      title: conversation.title,
      url: conversation.url,
      host: conversation.host,
      provider: { id: conversation.providerId, name: conversation.providerName },
      capturedAt: conversation.capturedAt,
      stats: conversation.stats,
      messages: conversation.messages.map((m) => ({
        index: m.index,
        role: m.role,
        label: m.label,
        text: m.text,
        markdown: m.markdown,
        html: m.html,
        reasoningMarkdown: m.thinkingMarkdown || undefined,
      })),
    },
    null,
    2
  );
}

/** Markdown embeds images as data URIs; pull them out for a sidecar folder. */
function markdownWithSidecarAssets(markdown, folder) {
  const asHtml = markdown.replace(
    /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g,
    (_m, alt, uri) => `<img alt="${alt}" src="${uri}">`
  );
  const extracted = convert.extractDataUriAssets(asHtml, folder);
  const back = extracted.html.replace(
    /<img alt="([^"]*)" src="([^"]+)">/g,
    (_m, alt, src) => `![${alt}](${src})`
  );
  return { markdown: back, assets: extracted.assets };
}

/* ------------------------------------------------------------------ export */

/**
 * @param {object} conversation prepared conversation (convert.prepare output)
 * @param {string[]} formats
 * @param {object} options
 * @returns {Promise<{files: string[], notes: string[], errors: string[]}>}
 */
async function exportConversation(conversation, formats, options = {}) {
  const base = formatFilename(options.filenameTemplate, conversation);
  const files = [];
  const notes = [];
  const errors = [];

  const renderOptions = {
    theme: options.theme || 'light',
    fontSize: options.fontSize || 15,
    includeMeta: options.includeMeta !== false,
    includeThinking: options.includeThinking !== false,
    expandLinks: Boolean(options.expandLinks),
    pageBreakPerTurn: Boolean(options.pageBreakPerTurn),
  };

  // downloadBlob may fall back to a safer name if the browser rejects the
  // first one, so record what was actually written rather than what we asked
  // for — otherwise the results list names a file that is not on disk.
  const save = async (blob, name) => {
    const saved = await downloadBlob(blob, inFolder(name));
    files.push(saved.filename);
    if (saved.fellBack) {
      notes.push(`"${name}" was not an acceptable filename here; saved as "${saved.filename}".`);
    }
  };

  for (const format of formats) {
    try {
      switch (format) {
        case 'md': {
          let content = buildMarkdown(conversation, options);
          if (options.assetMode === 'sidecar') {
            const folder = `${base}_files`;
            const result = markdownWithSidecarAssets(content, folder);
            if (result.assets.length) {
              content = result.markdown;
              for (const asset of result.assets) {
                await downloadBlob(new Blob([asset.bytes], { type: asset.mime }), inFolder(`${folder}/${asset.filename}`));
              }
              notes.push(`Saved ${result.assets.length} image(s) beside the Markdown.`);
            }
          }
          await save(textBlob(content, 'text/markdown;charset=utf-8'), `${base}.md`);
          break;
        }

        case 'txt':
          await save(textBlob(buildText(conversation, options)), `${base}.txt`);
          break;

        case 'json':
          await save(textBlob(buildJson(conversation), 'application/json'), `${base}.json`);
          break;

        case 'html': {
          let html = renderHtml(conversation, renderOptions);
          if (options.assetMode === 'sidecar') {
            const folder = `${base}_files`;
            const extracted = convert.extractDataUriAssets(html, folder);
            if (extracted.assets.length) {
              html = extracted.html;
              for (const asset of extracted.assets) {
                await downloadBlob(new Blob([asset.bytes], { type: asset.mime }), inFolder(`${folder}/${asset.filename}`));
              }
              notes.push(`Saved ${extracted.assets.length} image(s) beside the HTML.`);
            }
          }
          await save(textBlob(html, 'text/html;charset=utf-8'), `${base}.html`);
          break;
        }

        case 'docx': {
          const blob = await Packer.toBlob(buildDocument(conversation, options));
          await save(blob, `${base}.docx`);
          break;
        }

        case 'code': {
          const { files: blocks, manifest } = extractCodeBlocks(conversation, {
            minCodeLines: options.minCodeLines,
            assistantOnly: options.assistantOnlyCode,
          });
          if (!blocks.length) {
            notes.push('No code blocks found in this conversation.');
            break;
          }
          // One ZIP rather than N downloads: a chat with twenty snippets would
          // otherwise trigger twenty separate download prompts.
          const zip = new JSZip();
          for (const block of blocks) zip.file(block.filename, block.content);
          zip.file('README.md', manifest);
          const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
          await save(blob, `${base}_code.zip`);
          notes.push(`Extracted ${blocks.length} code block(s) into ${base}_code.zip`);
          break;
        }

        case 'zip': {
          const zip = new JSZip();
          const folder = `${base}_files`;
          const html = renderHtml(conversation, renderOptions);
          const extracted = convert.extractDataUriAssets(html, folder);
          const md = markdownWithSidecarAssets(buildMarkdown(conversation, options), folder);
          zip.file(`${base}.html`, extracted.html);
          zip.file(`${base}.md`, md.markdown);
          zip.file(`${base}.txt`, buildText(conversation, options));
          zip.file(`${base}.json`, buildJson(conversation));
          const assets = new Map();
          for (const asset of [...extracted.assets, ...md.assets]) {
            if (!assets.has(asset.filename)) assets.set(asset.filename, asset);
          }
          for (const asset of assets.values()) zip.file(`${folder}/${asset.filename}`, asset.bytes);
          try {
            zip.file(`${base}.docx`, await Packer.toBlob(buildDocument(conversation, options)));
          } catch (err) {
            notes.push(`Word file left out of the archive: ${err.message}`);
          }
          const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
          await save(blob, `${base}.zip`);
          break;
        }

        default:
          errors.push(`${format}: not available here`);
      }
    } catch (err) {
      errors.push(`${format}: ${err?.message || String(err)}`);
    }
  }

  return { files, notes, errors };
}

/* ------------------------------------------------------------------ merged */

async function exportMerged(sources, formats, options = {}) {
  const title = options.documentTitle || 'Merged AI conversations';
  const base = safeSegment(
    (options.filenameTemplate || '{date} - {title}')
      .replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
      .replace(/\{title\}/g, title)
      .replace(/\{count\}/g, String(sources.length))
      .replace(/\{\w+\}/g, '')
      .trim()
  );

  const files = [];
  const errors = [];
  // downloadBlob may fall back to a safer name if the browser rejects the
  // first one, so record what was actually written rather than what we asked
  // for — otherwise the results list names a file that is not on disk.
  const save = async (blob, name) => {
    const saved = await downloadBlob(blob, inFolder(name));
    files.push(saved.filename);
    if (saved.fellBack) {
      notes.push(`"${name}" was not an acceptable filename here; saved as "${saved.filename}".`);
    }
  };

  for (const format of formats) {
    try {
      switch (format) {
        case 'md':
          await save(textBlob(merge.buildMergedMarkdown(sources, options), 'text/markdown;charset=utf-8'), `${base}.md`);
          break;
        case 'txt':
          await save(textBlob(merge.buildMergedText(sources, options)), `${base}.txt`);
          break;
        case 'html':
          await save(textBlob(merge.buildMergedHtml(sources, options), 'text/html;charset=utf-8'), `${base}.html`);
          break;
        case 'docx':
          await save(await Packer.toBlob(merge.buildMergedDocument(sources, options)), `${base}.docx`);
          break;
        default:
          errors.push(`${format}: not available for merged documents`);
      }
    } catch (err) {
      errors.push(`${format}: ${err?.message || String(err)}`);
    }
  }

  return { files, errors };
}

module.exports = {
  exportConversation,
  exportMerged,
  buildMarkdown,
  buildText,
  buildJson,
  formatFilename,
  markdownWithSidecarAssets,
  FOLDER,
  inFolder,
};
