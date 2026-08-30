'use strict';

const { marked } = require('marked');
const docx = require('docx');
const { imageSize, fitWidth } = require('../lib/imagesize');
const { base64ToBytes } = require('../../shared/bytes');
const { isRtl } = require('../../shared/direction');

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, ExternalHyperlink, ImageRun, convertInchesToTwip,
} = docx;

const MONO = 'Consolas';
const MAX_IMAGE_WIDTH = 560; // px, roughly the printable width of a Letter page
const CODE_SHADE = 'F2F4F7';

/* ------------------------------------------------------------ inline runs */

/**
 * marked's inline tokens nest (bold inside a link, code inside emphasis), so
 * formatting is threaded down rather than applied at one level.
 */
function inlineRuns(tokens, fmt = {}, assets = []) {
  const runs = [];
  for (const token of tokens || []) {
    switch (token.type) {
      case 'strong':
        runs.push(...inlineRuns(token.tokens, { ...fmt, bold: true }, assets));
        break;
      case 'em':
        runs.push(...inlineRuns(token.tokens, { ...fmt, italics: true }, assets));
        break;
      case 'del':
        runs.push(...inlineRuns(token.tokens, { ...fmt, strike: true }, assets));
        break;
      case 'codespan':
        // Inline code is an identifier, never RTL prose, so it keeps LTR flow
        // even inside a right-to-left sentence.
        runs.push(new TextRun({
          text: token.text, font: MONO, size: 19, shading: { fill: CODE_SHADE }, ...fmt, rightToLeft: false,
        }));
        break;
      case 'br':
        runs.push(new TextRun({ text: '', break: 1 }));
        break;
      case 'link': {
        const children = inlineRuns(token.tokens, { ...fmt, style: 'Hyperlink' }, assets);
        runs.push(new ExternalHyperlink({ children: children.length ? children : [new TextRun({ text: token.href, style: 'Hyperlink' })], link: token.href }));
        break;
      }
      case 'image': {
        const run = imageRun(token.href, token.text);
        if (run) runs.push(run);
        else runs.push(new TextRun({ text: `[image: ${token.text || token.href}]`, italics: true, ...fmt }));
        break;
      }
      case 'escape':
      case 'text':
        if (token.tokens && token.tokens.length) {
          runs.push(...inlineRuns(token.tokens, fmt, assets));
        } else {
          runs.push(new TextRun({ text: token.text ?? '', ...fmt }));
        }
        break;
      default:
        if (token.tokens) runs.push(...inlineRuns(token.tokens, fmt, assets));
        else if (token.text) runs.push(new TextRun({ text: token.text, ...fmt }));
    }
  }
  return runs;
}

/** Turns a data: URI into an embedded image run; returns null for remote URLs. */
function imageRun(href, alt) {
  const match = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/i.exec(href || '');
  if (!match) return null;
  try {
    const bytes = base64ToBytes(match[2]);
    const dims = fitWidth(imageSize(bytes), MAX_IMAGE_WIDTH);
    let type = match[1].toLowerCase().replace('jpeg', 'jpg');
    if (!['png', 'jpg', 'gif', 'bmp'].includes(type)) type = 'png';
    return new ImageRun({ data: bytes, type, transformation: dims, altText: alt ? { name: alt, description: alt, title: alt } : undefined });
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- block tokens */

function codeParagraphs(text, indentLeft = 0) {
  // Word has no code-block primitive; a shaded, bordered, monospaced paragraph
  // per line is the closest faithful equivalent.
  const lines = String(text ?? '').split('\n');
  return lines.map((line, i) => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: MONO, size: 18 })],
    shading: { fill: CODE_SHADE },
    spacing: { before: i === 0 ? 120 : 0, after: i === lines.length - 1 ? 120 : 0, line: 260 },
    indent: { left: indentLeft + 120, right: 120 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 12, color: 'C9CED6', space: 6 },
    },
  }));
}

/** Flattens a token back to plain text, for deciding the block's direction. */
function plainTextOf(token) {
  if (!token) return '';
  if (typeof token.text === 'string' && token.text) return token.text;
  if (token.tokens) return token.tokens.map(plainTextOf).join(' ');
  if (token.items) return token.items.map(plainTextOf).join(' ');
  return '';
}

/**
 * Shared indent/border/direction decoration.
 *
 * Word's w:ind left/right are physical sides, not logical ones, so an indent
 * that reads correctly in an LTR paragraph lands on the wrong side of an RTL
 * one. Mirror it rather than emitting a left indent for Persian text.
 */
function deco(depth, quote, rtl) {
  const offset = depth * 360 + (quote ? 360 : 0);
  const borderSide = quote
    ? { style: BorderStyle.SINGLE, size: 12, color: 'B9C0CC', space: 8 }
    : undefined;
  return {
    indent: offset ? (rtl ? { right: offset } : { left: offset }) : undefined,
    border: borderSide ? (rtl ? { right: borderSide } : { left: borderSide }) : undefined,
    bidirectional: rtl || undefined,
    alignment: rtl ? AlignmentType.RIGHT : undefined,
  };
}

function blockToParagraphs(token, ctx, depth = 0, quote = false) {
  const out = [];
  const indent = depth * 360;
  const rtl = isRtl(plainTextOf(token));
  const runFmt = rtl ? { rightToLeft: true } : {};
  const { indent: ind, border, bidirectional, alignment } = deco(depth, quote, rtl);

  switch (token.type) {
    case 'heading': {
      const levels = [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6, HeadingLevel.HEADING_6];
      out.push(new Paragraph({
        children: inlineRuns(token.tokens, runFmt),
        heading: levels[Math.min(token.depth - 1, 5)],
        spacing: { before: 220, after: 100 },
        indent: ind,
        border,
        bidirectional,
        alignment,
      }));
      break;
    }

    case 'paragraph':
      out.push(new Paragraph({
        children: inlineRuns(token.tokens, quote ? { ...runFmt, italics: true } : runFmt),
        spacing: { after: 140, line: 280 },
        indent: ind,
        border,
        bidirectional,
        alignment,
      }));
      break;

    case 'text':
      out.push(new Paragraph({
        children: token.tokens ? inlineRuns(token.tokens, runFmt) : [new TextRun({ text: token.text || '', ...runFmt })],
        spacing: { after: 80, line: 280 },
        indent: ind,
        border,
        bidirectional,
        alignment,
      }));
      break;

    case 'code':
      out.push(...codeParagraphs(token.text, indent + (quote ? 360 : 0)));
      break;

    case 'blockquote':
      for (const child of token.tokens || []) {
        out.push(...blockToParagraphs(child, ctx, depth, true));
      }
      break;

    case 'list': {
      const instance = token.ordered ? ctx.nextOrderedInstance() : null;
      for (const item of token.items || []) {
        const inlineTokens = [];
        const nested = [];
        for (const child of item.tokens || []) {
          if (child.type === 'text' || child.type === 'paragraph') inlineTokens.push(...(child.tokens || []));
          else nested.push(child);
        }
        const itemRtl = isRtl(plainTextOf(item));
        out.push(new Paragraph({
          children: inlineRuns(inlineTokens, itemRtl ? { rightToLeft: true } : {}),
          spacing: { after: 60, line: 276 },
          bidirectional: itemRtl || undefined,
          alignment: itemRtl ? AlignmentType.RIGHT : undefined,
          ...(token.ordered
            ? { numbering: { reference: 'ace-ordered', level: Math.min(depth, 3), instance } }
            : { bullet: { level: Math.min(depth, 3) } }),
        }));
        for (const child of nested) out.push(...blockToParagraphs(child, ctx, depth + 1, quote));
      }
      break;
    }

    case 'table': {
      // Direction is decided per cell: a table can mix Persian labels with
      // Latin values and each column should read the right way round.
      const cellParagraph = (cell, extra = {}) => {
        const cellRtl = isRtl(plainTextOf(cell));
        return new Paragraph({
          children: inlineRuns(cell.tokens, { ...extra, ...(cellRtl ? { rightToLeft: true } : {}) }),
          spacing: { after: 0 },
          bidirectional: cellRtl || undefined,
          alignment: cellRtl ? AlignmentType.RIGHT : undefined,
        });
      };
      const header = new TableRow({
        tableHeader: true,
        children: (token.header || []).map((cell) => new TableCell({
          children: [cellParagraph(cell, { bold: true })],
          shading: { fill: 'EEF1F5' },
        })),
      });
      const rows = (token.rows || []).map((row) => new TableRow({
        children: row.map((cell) => new TableCell({ children: [cellParagraph(cell)] })),
      }));
      out.push(new Table({ rows: [header, ...rows], width: { size: 100, type: WidthType.PERCENTAGE } }));
      out.push(new Paragraph({ text: '', spacing: { after: 120 } }));
      break;
    }

    case 'hr':
      out.push(new Paragraph({
        text: '',
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 8 } },
        spacing: { before: 120, after: 160 },
      }));
      break;

    case 'space':
      break;

    default:
      if (token.tokens) {
        for (const child of token.tokens) out.push(...blockToParagraphs(child, ctx, depth, quote));
      } else if (token.text) {
        out.push(new Paragraph({ children: [new TextRun(token.text)], spacing: { after: 120 } }));
      }
  }
  return out;
}

function markdownToParagraphs(md, ctx) {
  if (!md || !md.trim()) return [];
  let tokens;
  try {
    tokens = marked.lexer(md);
  } catch {
    return [new Paragraph({ children: [new TextRun(md)], spacing: { after: 120 } })];
  }
  const out = [];
  for (const token of tokens) out.push(...blockToParagraphs(token, ctx));
  return out;
}

/* ------------------------------------------------------------------ export */

/**
 * Ordered lists need a fresh numbering instance each time, otherwise every list
 * in the document continues the previous one's count.
 */
function makeContext() {
  let orderedInstance = 0;
  return { nextOrderedInstance: () => ++orderedInstance };
}

/**
 * Builds the document object. Packing is left to the caller because Node wants
 * a Buffer and the browser wants a Blob, and only the caller knows which.
 */
function buildDocument(conversation, opts = {}) {
  const ctx = makeContext();

  const children = [];

  const titleRtl = isRtl(conversation.title);
  children.push(new Paragraph({
    children: [new TextRun({ text: conversation.title, bold: true, size: 36, rightToLeft: titleRtl || undefined })],
    spacing: { after: 120 },
    bidirectional: titleRtl || undefined,
    alignment: titleRtl ? AlignmentType.RIGHT : undefined,
  }));

  if (opts.includeMeta !== false) {
    const bits = [
      conversation.providerName || conversation.host,
      `${conversation.messages.length} messages`,
      conversation.capturedAt ? `exported ${new Date(conversation.capturedAt).toLocaleString()}` : null,
    ].filter(Boolean);
    children.push(new Paragraph({
      children: [new TextRun({ text: bits.join('  ·  '), color: '6B7280', size: 18 })],
      spacing: { after: 60 },
    }));
    if (conversation.url) {
      children.push(new Paragraph({
        children: [new ExternalHyperlink({ children: [new TextRun({ text: conversation.url, style: 'Hyperlink', size: 18 })], link: conversation.url })],
        spacing: { after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 10 } },
      }));
    }
  }

  for (const msg of conversation.messages) {
    // The speaker label follows the message's own direction so it sits on the
    // same side as the text it introduces.
    const msgRtl = isRtl(msg.text || msg.markdown);
    children.push(new Paragraph({
      children: [new TextRun({ text: `${msg.label.toUpperCase()}  ·  #${msg.index + 1}`, bold: true, size: 17, color: msg.role === 'user' ? '6B7280' : '2563EB' })],
      spacing: { before: 280, after: 100 },
      keepNext: true,
      bidirectional: msgRtl || undefined,
      alignment: msgRtl ? AlignmentType.RIGHT : undefined,
    }));

    if (msg.thinkingMarkdown) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Reasoning', bold: true, size: 16, color: '8A8F98' })],
        spacing: { after: 60 },
        keepNext: true,
      }));
      for (const para of markdownToParagraphs(msg.thinkingMarkdown, ctx)) children.push(para);
    }

    const body = markdownToParagraphs(msg.markdown, ctx);
    if (body.length) children.push(...body);
    else children.push(new Paragraph({ children: [new TextRun({ text: msg.text || '(empty)' })], spacing: { after: 120 } }));

    if (opts.pageBreakPerTurn) children.push(new Paragraph({ text: '', pageBreakBefore: true }));
  }

  return new Document({
    creator: 'AI Chat Extractor',
    title: conversation.title,
    description: conversation.url || '',
    numbering: {
      config: [{
        reference: 'ace-ordered',
        levels: [0, 1, 2, 3].map((level) => ({
          level,
          format: ['decimal', 'lowerLetter', 'lowerRoman', 'decimal'][level],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: {
      default: {
        document: { run: { font: opts.font || 'Calibri', size: 22 }, paragraph: { spacing: { line: 280 } } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: convertInchesToTwip(0.9), bottom: convertInchesToTwip(0.9), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) } },
      },
      children,
    }],
  });
}

/** Node-side convenience: build and pack to a Buffer. */
async function toDocx(conversation, opts = {}) {
  return Packer.toBuffer(buildDocument(conversation, opts));
}

module.exports = { toDocx, buildDocument, markdownToParagraphs, makeContext, plainTextOf };
