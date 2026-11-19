/*
 * The pixel size a picture declares in its own header, read before a browser
 * decodes it. A few KB of PNG can declare 23,170 by 23,170 pixels, which the
 * frame would decode to about 2 GB. This reads PNG, GIF, BMP, JPEG and WebP,
 * and answers null for a header it can't read and for any other format, SVG,
 * AVIF, ICO and TIFF among them. render.ts shows a picture of no size it can
 * read as the empty image, so a Word file's picture in such a format shows
 * nothing, even where the browser could draw it.
 */

export interface ImageSize { width: number; height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: readonly number[], at = 0): boolean {
  return bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

/* A size, when both sides are positive. */
function sized(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

/* The IHDR chunk, which must come first. */
function pngSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 24 || !startsWith(bytes, ascii('IHDR'), 12)) return null;
  return sized(view.getUint32(16), view.getUint32(20));
}

/*
 * The logical screen, made larger to hold the first frame where that frame
 * reaches past it, as browsers do: the frame's left and top offsets count
 * along with its size, so a 1 by 1 frame at 23,169, 23,169 decodes at 23,170
 * by 23,170. The scan skips the colour table and every extension block on
 * the way to the first image descriptor.
 */
function gifSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 13) return null;
  let width = view.getUint16(6, true);
  let height = view.getUint16(8, true);
  const packed = bytes[10];
  let offset = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x2c) {
      if (offset + 9 > bytes.length) return null;
      width = Math.max(width, view.getUint16(offset + 1, true) + view.getUint16(offset + 5, true));
      height = Math.max(height, view.getUint16(offset + 3, true) + view.getUint16(offset + 7, true));
      return sized(width, height);
    }
    if (block !== 0x21) return block === 0x3b ? sized(width, height) : null;
    /* An extension: its label, then data sub-blocks up to an empty one. */
    offset += 2;
    while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
    offset += 1;
  }
  return null;
}

/* The DIB header after the 14-byte file header. A negative height means the
   rows run top-down. The 12-byte core header holds 16-bit sides. */
function bmpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 18) return null;
  if (view.getUint32(14, true) === 12) {
    return bytes.length < 22 ? null : sized(view.getUint16(18, true), view.getUint16(20, true));
  }
  return bytes.length < 26 ? null : sized(view.getInt32(18, true), Math.abs(view.getInt32(22, true)));
}

/* Start-of-frame markers, the only ones that carry the size: C0 to CF but
   C4 (Huffman tables), C8 (reserved) and CC (arithmetic conditioning). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/* The other markers libjpeg reads past by the length after them: DHT, DAC,
   DQT, DNL, DRI, APP0 to APP15 and COM. */
function isSkippedByLength(marker: number): boolean {
  return marker === 0xc4 || marker === 0xcc || (marker >= 0xdb && marker <= 0xdd) || (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
}

/* The first frame header, found by walking the marker segments from the
   start of the image and skipping only what libjpeg skips. Fill bytes, TEM
   and RST0 to RST7 carry no length, and the markers isSkippedByLength names
   are skipped by theirs. Any other marker, scan data and the end of the
   image among them, a byte that isn't a marker where one belongs, or the end
   of the bytes before a frame header means there is no size to read.
   libjpeg stops at any other marker but FF 00. It drops FF 00 as a stuffed
   zero and scans on, byte by byte, to the next marker, which can be a frame
   header that a jump by length would skip. */
function jpegSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
    } else if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
    } else if (isStartOfFrame(marker)) {
      return offset + 9 <= bytes.length ? sized(view.getUint16(offset + 7), view.getUint16(offset + 5)) : null;
    } else if (isSkippedByLength(marker)) {
      offset += 2 + view.getUint16(offset + 2);
    } else {
      return null;
    }
  }
  return null;
}

/* The first chunk: VP8 (lossy) keeps 14-bit sides after its start code,
   VP8L (lossless) packs both sides minus 1 into 28 bits, and VP8X (extended)
   keeps the canvas's sides minus 1 in 24 bits each. */
function webpSize(bytes: Uint8Array, view: DataView): ImageSize | null {
  if (bytes.length < 31) return null;
  if (startsWith(bytes, ascii('VP8 '), 12) && startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) {
    return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  if (startsWith(bytes, ascii('VP8L'), 12) && bytes[20] === 0x2f) {
    const bits = view.getUint32(21, true);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (startsWith(bytes, ascii('VP8X'), 12)) {
    return sized((view.getUint32(24, true) & 0xffffff) + 1, (view.getUint32(27, true) & 0xffffff) + 1);
  }
  return null;
}

/* The size the picture in `bytes` declares, from as much of its start as
   `bytes` holds, or null. */
export function declaredImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (startsWith(bytes, PNG_SIGNATURE)) return pngSize(bytes, view);
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return gifSize(bytes, view);
  if (startsWith(bytes, ascii('BM'))) return bmpSize(bytes, view);
  if (startsWith(bytes, [0xff, 0xd8])) return jpegSize(bytes, view);
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return webpSize(bytes, view);
  return null;
}

/* The first `count` bytes a base64 data: URL holds, or all of them when it
   holds fewer, or none for any other URL. */
export function dataUrlHead(url: string, count: number): Uint8Array<ArrayBuffer> {
  const comma = url.indexOf(',');
  if (!url.startsWith('data:') || comma < 0 || !url.slice(0, comma).endsWith(';base64')) return new Uint8Array();
  let binary: string;
  try {
    binary = atob(url.slice(comma + 1, comma + 1 + Math.ceil(count / 3) * 4));
  } catch {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(Math.min(binary.length, count));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
