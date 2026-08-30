'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const JSZip = require('jszip');

const { htmlToText, extractDataUriAssets } = require('../lib/convert');
const { renderHtml } = require('../lib/render');
const { toDocx } = require('./docx');
const { extractCodeBlocks } = require('./code');
const merge = require('./merge');
const capture = require('../lib/capture');

/* --------------------------------------------------------------- filenames */

const RESERVED_WIN = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Makes a string safe as a Windows filename without turning it into mush. */
function safeName(str, fallback = 'chat') {
  let out = String(str || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!out) out = fallback;
  if (RESERVED_WIN.test(out)) out = `_${out}`;
  return out.slice(0, 110);
}

/**
 * Expands a filename template. Supported tokens:
 *   {title} {provider} {host} {date} {time} {datetime} {count} {id}
 */
function formatFilename(template, conversation) {
  const now = new Date(conversation.capturedAt || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  const tokens = {
    title: conversation.title || 'chat',
    provider: conversation.providerName || conversation.providerId || 'ai',
    host: conversation.host || '',
    date,
    time,
    datetime: `${date} ${time}`,
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
  return safeName(filled);
}

/** Adds " (2)", " (3)" … rather than clobbering an existing export. */
async function uniquePath(dir, base, ext) {
  for (let i = 0; i < 500; i++) {
    const name = i === 0 ? `${base}${ext}` : `${base} (${i + 1})${ext}`;
    const full = path.join(dir, name);
    try {
      await fs.access(full);
    } catch {
      return full;
    }
  }
  return path.join(dir, `${base} ${Date.now()}${ext}`);
}

/* ---------------------------------------------------------- text builders */

function yamlFrontmatter(conversation, opts) {
  const esc = (s) => `"${String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const tags = ['ai-chat', (conversation.providerId || 'unknown').toLowerCase()]
    .concat(opts.extraTags || [])
    .filter(Boolean);
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
    const meta = [
      `**Source:** ${conversation.url || 'n/a'}`,
      `**Provider:** ${conversation.providerName}`,
      `**Exported:** ${new Date(conversation.capturedAt || Date.now()).toLocaleString()}`,
      `**Messages:** ${conversation.messages.length}`,
    ];
    parts.push(meta.join('  \n') + '\n');
  }

  for (const msg of conversation.messages) {
    parts.push(`\n---\n`);
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
  const lines = [];
  lines.push(conversation.title);
  lines.push('='.repeat(Math.min(conversation.title.length, 80)));
  if (opts.includeMeta !== false) {
    lines.push(`Source:   ${conversation.url || 'n/a'}`);
    lines.push(`Provider: ${conversation.providerName}`);
    lines.push(`Exported: ${new Date(conversation.capturedAt || Date.now()).toLocaleString()}`);
    lines.push(`Messages: ${conversation.messages.length}`);
  }
  lines.push('');
  for (const msg of conversation.messages) {
    lines.push('-'.repeat(72));
    lines.push(`[${msg.label}]`);
    lines.push('');
    if (msg.thinkingHtml) {
      lines.push('  (reasoning)');
      lines.push(htmlToText(msg.thinkingHtml).split('\n').map((l) => '  ' + l).join('\n'));
      lines.push('');
    }
    lines.push(htmlToText(msg.html) || msg.text || '');
    lines.push('');
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

/* ------------------------------------------------------------------ writer */

/**
 * Markdown embeds pictures as ![alt](data:…) while extractDataUriAssets works
 * on HTML src attributes. Bridging the two lets a Markdown export share one
 * sidecar folder with the HTML export instead of duplicating every image.
 */
function markdownWithSidecarAssets(markdown, folder) {
  const asHtml = markdown.replace(
    /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g,
    (_m, alt, uri) => `<img alt="${alt}" src="${uri}">`
  );
  const extracted = extractDataUriAssets(asHtml, folder);
  const backToMarkdown = extracted.html.replace(
    /<img alt="([^"]*)" src="([^"]+)">/g,
    (_m, alt, src) => `![${alt}](${src})`
  );
  return { markdown: backToMarkdown, assets: extracted.assets };
}

async function writeAssets(dir, folderName, assets) {
  if (!assets.length) return [];
  const assetDir = path.join(dir, folderName);
  await fs.mkdir(assetDir, { recursive: true });
  const written = [];
  for (const asset of assets) {
    const full = path.join(assetDir, asset.filename);
    await fs.writeFile(full, asset.bytes);
    written.push(full);
  }
  return written;
}

/**
 * Writes one format to disk.
 *
 * @param {object} args
 * @param {object} args.conversation  prepared conversation (see convert.prepare)
 * @param {string} args.format        md|txt|html|json|pdf|docx|png|jpg|zip
 * @param {string} args.outDir
 * @param {object} args.options       per-format knobs from the UI
 * @param {number} [args.webContentsId] required for the "as shown" pdf/image modes
 * @returns {Promise<{files: string[], notes: string[]}>}
 */
async function exportConversation({ conversation, format, outDir, options = {}, webContentsId }) {
  await fs.mkdir(outDir, { recursive: true });
  const base = formatFilename(options.filenameTemplate, conversation);
  const notes = [];
  const files = [];

  const renderOptions = {
    theme: options.theme || 'light',
    fontSize: options.fontSize || 15,
    includeMeta: options.includeMeta !== false,
    includeThinking: options.includeThinking !== false,
    expandLinks: Boolean(options.expandLinks),
    pageBreakPerTurn: Boolean(options.pageBreakPerTurn),
  };

  switch (format) {
    case 'md': {
      let content = buildMarkdown(conversation, options);
      if (options.assetMode === 'sidecar') {
        const folder = `${base}_files`;
        const result = markdownWithSidecarAssets(content, folder);
        if (result.assets.length) {
          await writeAssets(outDir, folder, result.assets);
          notes.push(`Saved ${result.assets.length} image(s) to ${folder}/`);
          content = result.markdown;
        }
      }
      const file = await uniquePath(outDir, base, '.md');
      await fs.writeFile(file, content, 'utf8');
      files.push(file);
      break;
    }

    case 'txt': {
      const file = await uniquePath(outDir, base, '.txt');
      await fs.writeFile(file, buildText(conversation, options), 'utf8');
      files.push(file);
      break;
    }

    case 'json': {
      const file = await uniquePath(outDir, base, '.json');
      await fs.writeFile(file, buildJson(conversation), 'utf8');
      files.push(file);
      break;
    }

    case 'html': {
      let html = renderHtml(conversation, renderOptions);
      if (options.assetMode === 'sidecar') {
        const folder = `${base}_files`;
        const extracted = extractDataUriAssets(html, folder);
        if (extracted.assets.length) {
          await writeAssets(outDir, folder, extracted.assets);
          html = extracted.html;
          notes.push(`Saved ${extracted.assets.length} image(s) to ${folder}/`);
        }
      }
      const file = await uniquePath(outDir, base, '.html');
      await fs.writeFile(file, html, 'utf8');
      files.push(file);
      break;
    }

    case 'docx': {
      const buffer = await toDocx(conversation, { ...options, includeMeta: renderOptions.includeMeta });
      const file = await uniquePath(outDir, base, '.docx');
      await fs.writeFile(file, buffer);
      files.push(file);
      break;
    }

    case 'pdf': {
      let buffer;
      if (options.captureMode === 'asShown') {
        if (!webContentsId) throw new Error('No page is loaded to capture.');
        buffer = await capture.pdfFromWebContents(webContentsId, options, conversation.title);
        notes.push('Captured the live page as rendered by the site.');
      } else {
        buffer = await capture.pdfFromHtml(renderHtml(conversation, renderOptions), options, conversation.title);
      }
      const file = await uniquePath(outDir, base, '.pdf');
      await fs.writeFile(file, buffer);
      files.push(file);
      break;
    }

    case 'png':
    case 'jpg': {
      const fmt = format === 'jpg' ? 'jpeg' : 'png';
      const shotOptions = { ...options, format: fmt };
      let result;
      if (options.captureMode === 'asShown') {
        if (!webContentsId) throw new Error('No page is loaded to capture.');
        result = await capture.screenshotWebContents(webContentsId, shotOptions);
        notes.push('Captured the live page as rendered by the site.');
      } else {
        result = await capture.screenshotHtml(renderHtml(conversation, renderOptions), shotOptions);
      }
      const ext = format === 'jpg' ? '.jpg' : '.png';
      if (result.images.length === 1) {
        const file = await uniquePath(outDir, base, ext);
        await fs.writeFile(file, result.images[0]);
        files.push(file);
      } else {
        notes.push(`Chat is ${result.height}px tall — split into ${result.images.length} image tiles.`);
        for (let i = 0; i < result.images.length; i++) {
          const file = await uniquePath(outDir, `${base} - part ${i + 1}`, ext);
          await fs.writeFile(file, result.images[i]);
          files.push(file);
        }
      }
      break;
    }

    case 'code': {
      const { files: blocks, manifest } = extractCodeBlocks(conversation, options);
      if (!blocks.length) {
        notes.push('No code blocks found in this conversation.');
        break;
      }
      const folder = path.join(outDir, `${base}_code`);
      await fs.mkdir(folder, { recursive: true });
      for (const block of blocks) {
        const full = path.join(folder, block.filename);
        await fs.writeFile(full, block.content, 'utf8');
        files.push(full);
      }
      const indexPath = path.join(folder, 'README.md');
      await fs.writeFile(indexPath, manifest, 'utf8');
      files.push(indexPath);
      notes.push(`Extracted ${blocks.length} code block(s) to ${base}_code/`);
      break;
    }

    case 'zip': {
      // Everything-in-one archive: the format to pick when you're archiving
      // rather than sharing a single document.
      const zip = new JSZip();
      const folder = `${base}_files`;
      const html = renderHtml(conversation, renderOptions);
      const extracted = extractDataUriAssets(html, folder);
      // Both documents reference the same folder, so images are stored once.
      const markdown = markdownWithSidecarAssets(buildMarkdown(conversation, options), folder);
      zip.file(`${base}.html`, extracted.html);
      zip.file(`${base}.md`, markdown.markdown);
      zip.file(`${base}.txt`, buildText(conversation, options));
      zip.file(`${base}.json`, buildJson(conversation));
      const assets = new Map();
      for (const asset of [...extracted.assets, ...markdown.assets]) {
        if (!assets.has(asset.filename)) assets.set(asset.filename, asset);
      }
      for (const asset of assets.values()) zip.file(`${folder}/${asset.filename}`, asset.bytes);
      try {
        const pdf = await capture.pdfFromHtml(html, options, conversation.title);
        zip.file(`${base}.pdf`, pdf);
      } catch (err) {
        notes.push(`PDF left out of the archive: ${err.message}`);
      }
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const file = await uniquePath(outDir, base, '.zip');
      await fs.writeFile(file, buffer);
      files.push(file);
      break;
    }

    default:
      throw new Error(`Unknown export format: ${format}`);
  }

  return { files, notes };
}

/**
 * Writes one merged document combining several captured chats.
 *
 * @param {object[]} sources archive records or exported ai-chat-extractor JSON
 * @returns {Promise<{files: string[], notes: string[]}>}
 */
async function exportMerged({ sources, formats, outDir, options = {} }) {
  await fs.mkdir(outDir, { recursive: true });
  const title = options.documentTitle || 'Merged AI conversations';
  const base = safeName(
    (options.filenameTemplate || '{date} - {title}')
      .replace(/\{date\}/g, new Date().toISOString().slice(0, 10))
      .replace(/\{title\}/g, title)
      .replace(/\{count\}/g, String(sources.length))
      .replace(/\{\w+\}/g, '')
      .trim()
  );

  const files = [];
  const notes = [];
  const renderOptions = { theme: options.theme || 'light', fontSize: options.fontSize || 15, ...options };

  for (const format of formats) {
    switch (format) {
      case 'md': {
        const file = await uniquePath(outDir, base, '.md');
        await fs.writeFile(file, merge.buildMergedMarkdown(sources, options), 'utf8');
        files.push(file);
        break;
      }
      case 'txt': {
        const file = await uniquePath(outDir, base, '.txt');
        await fs.writeFile(file, merge.buildMergedText(sources, options), 'utf8');
        files.push(file);
        break;
      }
      case 'html': {
        const file = await uniquePath(outDir, base, '.html');
        await fs.writeFile(file, merge.buildMergedHtml(sources, renderOptions), 'utf8');
        files.push(file);
        break;
      }
      case 'docx': {
        const file = await uniquePath(outDir, base, '.docx');
        await fs.writeFile(file, await merge.buildMergedDocx(sources, options));
        files.push(file);
        break;
      }
      case 'pdf': {
        const html = merge.buildMergedHtml(sources, renderOptions);
        const buffer = await capture.pdfFromHtml(html, options, title);
        const file = await uniquePath(outDir, base, '.pdf');
        await fs.writeFile(file, buffer);
        files.push(file);
        break;
      }
      default:
        notes.push(`${format.toUpperCase()} is not available for merged documents.`);
    }
  }

  return { files, notes };
}

module.exports = {
  exportConversation,
  exportMerged,
  buildMarkdown,
  buildText,
  buildJson,
  formatFilename,
  markdownWithSidecarAssets,
  safeName,
};
