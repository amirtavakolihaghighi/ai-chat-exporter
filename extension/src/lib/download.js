'use strict';

const { api } = require('./browser');

/**
 * Saving files from an extension.
 *
 * Unlike the desktop app there is no arbitrary filesystem access: everything
 * goes through the downloads API, which writes into the browser's download
 * folder or a subfolder of it. Absolute paths and `..` are rejected outright.
 *
 * A blob URL has to be minted in a document context — Chrome service workers
 * have no URL.createObjectURL — which is why all exporting happens in the
 * workspace page rather than in the background.
 */

const RESERVED_WIN = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/**
 * Characters that are invisible but not whitespace: bidi marks and overrides,
 * zero-width joiners, the BOM. Chat titles in Persian, Arabic and Hebrew pick
 * these up routinely, and the downloads API rejects a filename containing them
 * with a bare "Invalid filename" that gives no clue why.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Sanitises one path segment; the separator is added by the caller.
 *
 * An allowlist rather than a list of banned characters. Enumerating what is
 * illegal means every unusual character a chat title can contain is one more
 * thing to have missed, and the downloads API answers a bad name with a flat
 * "Invalid filename" that names no culprit. Keeping only letters, numbers,
 * marks, spaces and a little safe punctuation cannot be incomplete in that way,
 * and it still preserves Persian, Arabic, Chinese and emoji titles intact.
 */
function safeSegment(str, fallback = 'chat') {
  let out = String(str == null ? '' : str)
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[^\p{L}\p{M}\p{N}\p{Emoji_Presentation} ._(){}'!&+=@#~^,\[\]-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // A leading dot makes a hidden file; a trailing dot or space is invalid on
    // Windows and gets silently stripped, which breaks "did it actually save?".
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');

  if (RESERVED_WIN.test(out)) out = `_${out}`;
  // Trim by code points so a surrogate pair is never cut in half.
  if ([...out].length > 100) out = [...out].slice(0, 100).join('').trim().replace(/[.\s]+$/, '');
  return out || fallback;
}

/** Last-resort name: plain ASCII, guaranteed acceptable anywhere. */
function asciiFallback(name) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const ascii = stem
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[^A-Za-z0-9 ._()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  return (ascii || `chat-${Date.now()}`) + ext;
}

function splitPath(filename) {
  const parts = String(filename).split('/');
  return { dir: parts.slice(0, -1), file: parts[parts.length - 1] };
}

/**
 * Saves a blob, falling back rather than failing.
 *
 * The downloads API validates the filename itself and rejects anything it
 * dislikes with a message that does not say which character was at fault. Since
 * a rejected name means the user simply loses the export, try progressively
 * safer names, and finally hand it to the Save-as dialog so there is always a
 * way through.
 *
 * @returns {Promise<{id: number, filename: string, fellBack: boolean}>}
 */
async function downloadBlob(blob, filename, opts = {}) {
  const url = URL.createObjectURL(blob);

  const { dir, file } = splitPath(filename);
  const cleanDir = dir.map((d) => safeSegment(d, 'exports'));
  const attempts = [
    [...cleanDir, safeSegment(file, 'chat')].join('/'),
    [...cleanDir, asciiFallback(safeSegment(file, 'chat'))].join('/'),
    `${cleanDir[0] || 'AI Chat Exports'}/chat-${Date.now()}${(file.match(/\.[A-Za-z0-9]+$/) || [''])[0]}`,
  ];

  const problems = [];
  try {
    for (const [index, candidate] of attempts.entries()) {
      try {
        const id = await api.downloads.download({
          url,
          filename: candidate,
          saveAs: Boolean(opts.saveAs),
          conflictAction: 'uniquify', // never silently overwrite a previous export
        });
        return { id, filename: candidate, fellBack: index > 0 };
      } catch (err) {
        problems.push(`"${candidate}": ${err?.message || err}`);
      }
    }

    // Everything was rejected — let the user name it themselves.
    try {
      const id = await api.downloads.download({ url, saveAs: true });
      return { id, filename: '(chosen in the save dialog)', fellBack: true };
    } catch (err) {
      problems.push(`save dialog: ${err?.message || err}`);
    }

    throw new Error(`Could not save the file. Tried ${problems.join(' | ')}`);
  } finally {
    // Revoking immediately can cancel an in-flight download, so give the
    // browser a moment to take ownership of the blob first.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function textBlob(content, mime = 'text/plain;charset=utf-8') {
  return new Blob([content], { type: mime });
}

/** Reveals a finished download in the OS file manager. */
function showDownload(id) {
  try {
    api.downloads.show(id);
  } catch {
    /* the download may have been cleared from history */
  }
}

module.exports = { downloadBlob, textBlob, safeSegment, asciiFallback, showDownload };
