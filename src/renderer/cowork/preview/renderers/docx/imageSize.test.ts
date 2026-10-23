/*
 * Picture headers, built here byte by byte: the size each format declares,
 * and null for a header the reader can't use. A 23,170 by 23,170 PNG of a
 * few dozen bytes is the decode the Word preview must refuse.
 */
import { describe, expect, it } from 'vitest';

import { dataUrlHead, declaredImageSize } from './imageSize';

function bytes(...parts: (number[] | string)[]): Uint8Array {
  return new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? Array.from(part, (character) => character.charCodeAt(0)) : part)));
}

function uint16be(value: number): number[] {
  return [value >> 8, value & 0xff];
}

function uint16le(value: number): number[] {
  return [value & 0xff, value >> 8];
}

function uint32be(value: number): number[] {
  return [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function uint32le(value: number): number[] {
  return uint32be(value).reverse();
}

/* A PNG signature and IHDR chunk, with no image data after them. */
function png(width: number, height: number): Uint8Array {
  return bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], uint32be(13), 'IHDR', uint32be(width), uint32be(height), [8, 6, 0, 0, 0], uint32be(0));
}

/* A GIF89a header with a 2-colour global table, a graphic control extension,
   and the first frame's image descriptor, its size and its left and top
   offsets. */
function gif(screen: [number, number], frame: [number, number], at: [number, number] = [0, 0]): Uint8Array {
  return bytes(
    'GIF89a', uint16le(screen[0]), uint16le(screen[1]), [0x80, 0, 0], [0, 0, 0, 255, 255, 255],
    [0x21, 0xf9, 4, 0, 0, 0, 0, 0],
    [0x2c], uint16le(at[0]), uint16le(at[1]), uint16le(frame[0]), uint16le(frame[1]), [0],
  );
}

/* A BMP file header and a 40-byte info header. */
function bmp(width: number, height: number): Uint8Array {
  return bytes('BM', uint32le(54), uint32le(0), uint32le(54), uint32le(40), uint32le(width), uint32le(height >>> 0), uint16le(1), uint16le(24));
}

/* A JPEG frame header that `marker` starts, with one component. */
function frame(marker: number, width: number, height: number): number[] {
  return [0xff, marker, ...uint16be(11), 8, ...uint16be(height), ...uint16be(width), 1, 1, 0x11, 0];
}

/* A JPEG start, an APP0 segment, then the frame header `marker` carries. */
function jpeg(marker: number, width: number, height: number): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0], uint16be(16), 'JFIF', [0, 1, 1, 0], uint16be(1), uint16be(1), [0, 0],
    frame(marker, width, height),
  );
}

describe('declaredImageSize', () => {
  it('reads a PNG\'s IHDR, as the 23,170 by 23,170 picture that decodes to about 2 GB', () => {
    expect(declaredImageSize(png(23_170, 23_170))).toEqual({ width: 23_170, height: 23_170 });
    expect(declaredImageSize(png(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it('reads a GIF\'s logical screen, made larger by a larger first frame', () => {
    expect(declaredImageSize(gif([320, 200], [16, 16]))).toEqual({ width: 320, height: 200 });
    expect(declaredImageSize(gif([1, 1], [30_000, 20_000]))).toEqual({ width: 30_000, height: 20_000 });
  });

  it('counts the first frame\'s offsets, as a 1 by 1 frame placed at 23,169, 23,169 decodes at 23,170 by 23,170', () => {
    expect(declaredImageSize(gif([1, 1], [1, 1], [23_169, 23_169]))).toEqual({ width: 23_170, height: 23_170 });
    expect(declaredImageSize(gif([1, 1], [37, 21], [3, 2]))).toEqual({ width: 40, height: 23 });
    expect(declaredImageSize(gif([320, 200], [16, 16], [8, 8]))).toEqual({ width: 320, height: 200 });
  });

  it('reads a BMP\'s info header, top-down rows included, and its 12-byte core header', () => {
    expect(declaredImageSize(bmp(800, 600))).toEqual({ width: 800, height: 600 });
    expect(declaredImageSize(bmp(800, -600))).toEqual({ width: 800, height: 600 });
    expect(declaredImageSize(bytes('BM', uint32le(26), uint32le(0), uint32le(26), uint32le(12), uint16le(300), uint16le(200)))).toEqual({ width: 300, height: 200 });
  });

  it('reads a JPEG\'s frame header behind other segments, baseline and progressive', () => {
    expect(declaredImageSize(jpeg(0xc0, 1024, 768))).toEqual({ width: 1024, height: 768 });
    expect(declaredImageSize(jpeg(0xc2, 30_000, 30_000))).toEqual({ width: 30_000, height: 30_000 });
  });

  it('skips a JPEG\'s Exif, comment and fill bytes by their lengths, and a Huffman table, which would declare 772 by 258 read as a frame header', () => {
    const exifCommentFill = bytes([0xff, 0xd8], [0xff, 0xe1], uint16be(10), 'Exif', [0, 0], 'MM', [0xff, 0xfe], uint16be(5), 'abc', [0xff, 0xff], frame(0xc2, 37, 21));
    const huffmanTable = bytes([0xff, 0xd8], [0xff, 0xc4], uint16be(9), [0, 1, 2, 3, 4, 0, 0], frame(0xc0, 37, 21));
    expect(declaredImageSize(exifCommentFill)).toEqual({ width: 37, height: 21 });
    expect(declaredImageSize(huffmanTable)).toEqual({ width: 37, height: 21 });
  });

  /* libjpeg drops FF 00 as a stuffed zero and scans on, byte by byte, to the
     comment, which it skips by its length. So it reads the second frame
     header, 9,000 by 8,000. A jump by the two bytes after FF 00 lands on the
     first, 37 by 21, inside the comment. */
  it('never reads the frame header a JPEG comment holds after a stuffed zero', () => {
    const decoy = frame(0xc0, 37, 21);
    const header = bytes([0xff, 0xd8], [0xff, 0x00], uint16be(6), [0xff, 0xfe], uint16be(2 + decoy.length), decoy, frame(0xc0, 9_000, 8_000));
    expect(declaredImageSize(header)).toBeNull();
  });

  it('reads a WebP\'s VP8, VP8L and VP8X sizes', () => {
    const vp8 = bytes('RIFF', uint32le(30), 'WEBP', 'VP8 ', uint32le(10), [0, 0, 0], [0x9d, 0x01, 0x2a], uint16le(400), uint16le(300), [0]);
    const width = 1999;
    const height = 999;
    const vp8l = bytes('RIFF', uint32le(30), 'WEBP', 'VP8L', uint32le(5), [0x2f], uint32le((width - 1) | ((height - 1) << 14)), [0, 0, 0, 0, 0, 0]);
    const vp8x = bytes('RIFF', uint32le(30), 'WEBP', 'VP8X', uint32le(10), [0, 0, 0, 0], [0x3f, 0x9c, 0x00], [0x1f, 0x4e, 0x00], [0]);
    expect(declaredImageSize(vp8)).toEqual({ width: 400, height: 300 });
    expect(declaredImageSize(vp8l)).toEqual({ width, height });
    expect(declaredImageSize(vp8x)).toEqual({ width: 40_000, height: 20_000 });
  });

  it.each([
    ['a header cut short', png(10, 10).slice(0, 20)],
    ['a PNG whose first chunk is not IHDR', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], uint32be(0), 'IEND', uint32be(0), uint32be(0))],
    ['a JPEG whose scan starts before any frame header', bytes([0xff, 0xd8, 0xff, 0xda], uint16be(8), [1, 1, 0, 0, 0x3f, 0])],
    ['a JPEG with a byte that is not a marker where one belongs', bytes([0xff, 0xd8, 0xff, 0xe0], uint16be(4), [0, 0, 0], frame(0xc0, 37, 21))],
    ['a JPEG marker libjpeg stops at, such as JPG0, before the frame header', bytes([0xff, 0xd8, 0xff, 0xf0], uint16be(4), [0, 0], frame(0xc0, 37, 21))],
    ['a second JPEG SOI before the frame header', bytes([0xff, 0xd8, 0xff, 0xd8], frame(0xc0, 37, 21))],
    ['a JPEG segment that runs past the end', bytes([0xff, 0xd8, 0xff, 0xe0], uint16be(16), 'JFIF')],
    ['a JPEG frame header with no height, which leaves it to a DNL marker after the first scan', bytes([0xff, 0xd8], frame(0xc0, 37, 0))],
    ['a side of 0', png(0, 10)],
    ['a format it doesn\'t read, such as TIFF', bytes('II', [42, 0], uint32le(8))],
    ['no bytes at all', new Uint8Array()],
  ])('answers null for %s', (_name, header) => {
    expect(declaredImageSize(header)).toBeNull();
  });
});

describe('dataUrlHead', () => {
  it('decodes the start of a base64 data: URL', () => {
    const url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    expect(Array.from(dataUrlHead(url, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(dataUrlHead(url, 1000)).toHaveLength(16);
  });

  it.each(['https://x/a.png', 'data:image/svg+xml,%3Csvg%2F%3E', 'data:image/png;base64,***'])('gives no bytes for %s', (url) => {
    expect(dataUrlHead(url, 8)).toHaveLength(0);
  });
});
