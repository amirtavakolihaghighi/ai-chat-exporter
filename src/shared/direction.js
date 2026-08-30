'use strict';

/**
 * Text-direction detection, used to lay out Persian, Arabic and Hebrew chats
 * correctly in exports.
 *
 * HTML gets `dir="auto"` and lets the browser apply the Unicode bidi algorithm,
 * but Word has no equivalent — every paragraph must be told explicitly whether
 * it is right-to-left. So we decide per block here.
 *
 * The rule is "majority of strong characters" rather than "first strong
 * character". A chat message routinely opens with a Latin product name, a
 * number or a quote mark before the actual sentence starts, and first-strong
 * would flip the whole paragraph to the wrong side on that alone.
 */

/** Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, and the Arabic presentation forms. */
function isRtlChar(code) {
  return (
    (code >= 0x0590 && code <= 0x08ff) ||
    (code >= 0xfb1d && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff) ||
    (code >= 0x10800 && code <= 0x10fff) ||
    (code >= 0x1e800 && code <= 0x1efff)
  );
}

/** Latin, Greek, Cyrillic, Armenian, the Indic blocks, CJK and Hangul. */
function isLtrChar(code) {
  return (
    (code >= 0x0041 && code <= 0x005a) ||
    (code >= 0x0061 && code <= 0x007a) ||
    (code >= 0x00c0 && code <= 0x058f) ||
    (code >= 0x0900 && code <= 0x1fff) ||
    (code >= 0x2c00 && code <= 0x2dff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xa500 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfaff)
  );
}

/**
 * @param {string} text
 * @returns {'rtl'|'ltr'|'neutral'}
 */
function detectDirection(text) {
  let rtl = 0;
  let ltr = 0;
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0);
    if (isRtlChar(code)) rtl++;
    else if (isLtrChar(code)) ltr++;
  }
  if (rtl === 0 && ltr === 0) return 'neutral';
  return rtl > ltr ? 'rtl' : 'ltr';
}

function isRtl(text) {
  return detectDirection(text) === 'rtl';
}

module.exports = { detectDirection, isRtl, isRtlChar, isLtrChar };
