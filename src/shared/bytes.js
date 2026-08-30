'use strict';

/**
 * Binary helpers that behave the same in Node and in a browser.
 *
 * The export core is shared between the desktop app and the browser extension,
 * so it cannot reach for Node's Buffer. Uint8Array is the common currency:
 * fs.writeFile, JSZip and the docx library all accept it, and so does every
 * browser API we need.
 */

/** Decodes standard base64 (as found in a data: URI) into bytes. */
function base64ToBytes(base64) {
  const clean = String(base64 || '').replace(/\s+/g, '');
  // atob exists in browsers and in Node 16+, which keeps this one code path.
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  const view = toBytes(bytes);
  let binary = '';
  // Chunked to avoid blowing the argument limit on large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Normalises Buffer / ArrayBuffer / array-like into a Uint8Array view. */
function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input || 0);
}

module.exports = { base64ToBytes, bytesToBase64, toBytes };
