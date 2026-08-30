'use strict';

const { toBytes } = require('../../shared/bytes');

/**
 * Minimal intrinsic-size reader for the raster formats chat sites actually
 * serve. DOCX needs explicit pixel dimensions for every embedded image, and
 * guessing a square would distort screenshots and generated pictures.
 *
 * Works on any byte source (Uint8Array, ArrayBuffer, Node Buffer) so the same
 * code runs in the desktop app and in the browser extension.
 * Returns { width, height } or null when the format isn't recognised.
 */
function imageSize(input) {
  const bytes = toBytes(input);
  if (bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));

  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }

  // GIF: logical screen descriptor, little-endian uint16 pair at offset 6.
  if (ascii(0, 3) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  // BMP
  if (ascii(0, 2) === 'BM') {
    return { width: view.getInt32(18, true), height: Math.abs(view.getInt32(22, true)) };
  }

  // WebP: RIFF container, three possible chunk layouts.
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25) {
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X' && bytes.length >= 30) {
      const w = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16);
      const h = bytes[27] | (bytes[28] << 8) | (bytes[29] << 16);
      return { width: w + 1, height: h + 1 };
    }
    return null;
  }

  // JPEG: walk the marker chain to whichever SOFn frame header appears first.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      // SOF0-SOF15, excluding the non-frame markers DHT/JPG/DAC.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: view.getUint16(offset + 5, false), width: view.getUint16(offset + 7, false) };
      }
      const len = view.getUint16(offset + 2, false);
      if (len <= 0) break;
      offset += 2 + len;
    }
  }

  return null;
}

/** Fits an image inside a max width, preserving aspect ratio. */
function fitWidth(size, maxWidth, fallbackWidth = 480) {
  if (!size || !size.width || !size.height) {
    return { width: fallbackWidth, height: Math.round(fallbackWidth * 0.6) };
  }
  if (size.width <= maxWidth) return { width: size.width, height: size.height };
  const scale = maxWidth / size.width;
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

module.exports = { imageSize, fitWidth };
