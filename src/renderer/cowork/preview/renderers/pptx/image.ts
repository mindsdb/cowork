/*
 * Reads a picture part's header: its type, from the signature, and the width
 * and height it declares. A picture format compresses on its own, so a few KB
 * that pass the archive guard can declare hundreds of millions of pixels, and
 * the browser decodes every one of them to 4 bytes. So the slide preview reads
 * the declared size before it hands the bytes to the browser, and draws a
 * placeholder for a picture past its pixel budget or whose size it can't read.
 *
 * Each reader stops at the first thing it doesn't expect and gives null, never
 * a guess, so a header it can't read never gets past the budget.
 */

export type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp' | 'image/webp';

export interface ImageSize {
  width: number;
  height: number;
}

/* The JPEG markers that start a frame header (SOF0 to SOF15), which holds the
   picture's size. 0xC4, 0xC8 and 0xCC sit in that range but are DHT, JPG and
   DAC, which don't. */
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/* The other JPEG markers libjpeg reads past by the length after them: DHT,
   DAC, DQT, DNL, DRI, APP0 to APP15 and COM. */
const JPEG_LENGTH_MARKERS = new Set([
  0xc4, 0xcc, 0xdb, 0xdc, 0xdd,
  0xe0, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
  0xfe,
]);

export function imageType(bytes: Uint8Array): ImageType | null {
  const starts = (...signature: number[]): boolean => signature.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x42, 0x4d)) return 'image/bmp';
  if (starts(0x52, 0x49, 0x46, 0x46) && [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte)) {
    return 'image/webp';
  }
  return null;
}

/* The width and height the header of a picture of this type declares, or null
   when the header is cut short or doesn't read as that type's. */
export function imageSize(bytes: Uint8Array, type: ImageType): ImageSize | null {
  switch (type) {
    case 'image/png':
      return pngSize(bytes);
    case 'image/jpeg':
      return jpegSize(bytes);
    case 'image/gif':
      return gifSize(bytes);
    case 'image/bmp':
      return bmpSize(bytes);
    case 'image/webp':
      return webpSize(bytes);
  }
}

/* An unsigned integer of `size` bytes at `at`, or null past the end. */
function uint(bytes: Uint8Array, at: number, size: number, littleEndian: boolean): number | null {
  if (at < 0 || at + size > bytes.length) return null;
  let value = 0;
  for (let i = 0; i < size; i++) value = value * 256 + bytes[littleEndian ? at + size - 1 - i : at + i];
  return value;
}

function sized(width: number | null, height: number | null): ImageSize | null {
  return width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null;
}

/* PNG: the IHDR chunk, which must come first, holds the width and height. */
function pngSize(bytes: Uint8Array): ImageSize | null {
  const ihdr = [0x49, 0x48, 0x44, 0x52].every((byte, i) => bytes[12 + i] === byte);
  return ihdr ? sized(uint(bytes, 16, 4, false), uint(bytes, 20, 4, false)) : null;
}

/* JPEG: walks the segments after SOI to the first frame header, skipping
   only what libjpeg skips. Fill bytes, TEM and RST0 to RST7 carry no length,
   and the markers in JPEG_LENGTH_MARKERS are skipped by theirs. Any other
   marker, a byte that isn't a marker where one belongs, or the end of the
   bytes before a frame header means the size can't be read. libjpeg stops at
   any other marker but FF 00. It drops FF 00 as a stuffed zero and scans on,
   byte by byte, to the next marker, which can be a frame header that a jump
   by length would skip. */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
    } else if (JPEG_FRAME_MARKERS.has(marker)) {
      return sized(uint(bytes, at + 7, 2, false), uint(bytes, at + 5, 2, false));
    } else if (JPEG_LENGTH_MARKERS.has(marker)) {
      const length = uint(bytes, at + 2, 2, false);
      if (length === null || length < 2) return null;
      at += 2 + length;
    } else {
      return null;
    }
  }
  return null;
}

/* GIF: the logical screen, grown to fit the first frame. Browsers grow the
   screen that way for a file whose first frame is larger than the screen it
   declares, so the first frame's size counts too. Only extension blocks may
   come before that frame. */
function gifSize(bytes: Uint8Array): ImageSize | null {
  const screenWidth = uint(bytes, 6, 2, true);
  const screenHeight = uint(bytes, 8, 2, true);
  const flags = uint(bytes, 10, 1, true);
  if (screenWidth === null || screenHeight === null || flags === null) return null;
  const globalColors = flags & 0x80 ? 3 * 2 ** ((flags & 0x07) + 1) : 0;
  let at = 13 + globalColors;
  while (at < bytes.length) {
    if (bytes[at] === 0x2c) {
      const left = uint(bytes, at + 1, 2, true);
      const top = uint(bytes, at + 3, 2, true);
      const width = uint(bytes, at + 5, 2, true);
      const height = uint(bytes, at + 7, 2, true);
      if (left === null || top === null || width === null || height === null) return null;
      return sized(Math.max(screenWidth, left + width), Math.max(screenHeight, top + height));
    }
    if (bytes[at] !== 0x21) return null;
    /* The introducer and label, then data sub-blocks up to an empty one. */
    at += 2;
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at] + 1;
    at += 1;
  }
  return null;
}

/* BMP: the info header after the 14-byte file header. Its first field is its
   own size: 12 for the OS/2 1.x header, whose width and height are 16-bit, and
   larger for the rest, whose width and height are signed 32-bit. A negative
   height means the rows run top-down. */
function bmpSize(bytes: Uint8Array): ImageSize | null {
  const headerSize = uint(bytes, 14, 4, true);
  if (headerSize === null) return null;
  if (headerSize === 12) return sized(uint(bytes, 18, 2, true), uint(bytes, 20, 2, true));
  const width = uint(bytes, 18, 4, true);
  const height = uint(bytes, 22, 4, true);
  if (width === null || height === null || width >= 2 ** 31) return null;
  return sized(width, height >= 2 ** 31 ? 2 ** 32 - height : height);
}

/* WebP: the first chunk after the RIFF header is VP8X (the canvas size, less
   one, in 24 bits), VP8L (a signature byte, then the size, less one, in two
   14-bit fields) or VP8 (a frame tag and start code, then the size in two
   14-bit fields). */
function webpSize(bytes: Uint8Array): ImageSize | null {
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8X') {
    const width = uint(bytes, 24, 3, true);
    const height = uint(bytes, 27, 3, true);
    return width === null || height === null ? null : sized(width + 1, height + 1);
  }
  if (chunk === 'VP8L') {
    const bits = uint(bytes, 21, 4, true);
    if (bytes[20] !== 0x2f || bits === null) return null;
    return sized((bits % 2 ** 14) + 1, (Math.floor(bits / 2 ** 14) % 2 ** 14) + 1);
  }
  if (chunk === 'VP8 ') {
    const startCode = [0x9d, 0x01, 0x2a].every((byte, i) => bytes[23 + i] === byte);
    const width = uint(bytes, 26, 2, true);
    const height = uint(bytes, 28, 2, true);
    if (!startCode || width === null || height === null) return null;
    return sized(width % 2 ** 14, height % 2 ** 14);
  }
  return null;
}
