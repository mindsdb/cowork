/*
 * Screenshots for anton's browser tool.
 *
 * Main captures the view, scales it to at most MAX_SCREENSHOT_WIDTH pixels
 * wide (the width the web pod uses too), and draws the element numbers into
 * the bitmap itself, from boxes the page read returned at capture time. Nothing
 * is drawn into the page, so a page never sees the labels. Element ids are
 * integers, so a small built-in digit font is enough.
 */

import { MAX_SCREENSHOT_WIDTH } from '../shared/browser-contract';
import type { ElementBox } from './browser-page-script';

/** A raw 32-bit bitmap as nativeImage.toBitmap() gives it: 4 bytes a pixel, row by row. */
export interface Bitmap {
  data: Buffer;
  width: number;
  height: number;
}

/* 3x5 digit glyphs, one string per row. */
const DIGITS: Record<string, string[]> = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

const SCALE = 2;
const PAD = 2;
const GAP = 2;
export const LABEL_HEIGHT = 5 * SCALE + 2 * PAD;

/* Magenta reads on light and dark pages, and has the same red and blue, so the
   bitmap's channel order can't change it. */
const LABEL_COLOR = [0xc0, 0x1a, 0xc0, 0xff] as const;
const TEXT_COLOR = [0xff, 0xff, 0xff, 0xff] as const;

function setPixel(bitmap: Bitmap, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const at = (y * bitmap.width + x) * 4;
  bitmap.data[at] = color[0];
  bitmap.data[at + 1] = color[1];
  bitmap.data[at + 2] = color[2];
  bitmap.data[at + 3] = color[3];
}

function fill(bitmap: Bitmap, x: number, y: number, width: number, height: number, color: readonly number[]): void {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) setPixel(bitmap, col, row, color);
  }
}

export function labelWidth(id: number): number {
  const digits = String(id).length;
  return digits * 3 * SCALE + (digits - 1) * GAP + 2 * PAD;
}

/** Outlines each box and draws its number in a tag at its top-left corner, kept
    inside the image. Boxes are in the bitmap's pixels. */
export function drawLabels(bitmap: Bitmap, boxes: ElementBox[]): void {
  for (const box of boxes) {
    const x = Math.round(box.x);
    const y = Math.round(box.y);
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    fill(bitmap, x, y, width, 1, LABEL_COLOR);
    fill(bitmap, x, y + height - 1, width, 1, LABEL_COLOR);
    fill(bitmap, x, y, 1, height, LABEL_COLOR);
    fill(bitmap, x + width - 1, y, 1, height, LABEL_COLOR);
    const tagWidth = labelWidth(box.id);
    const tagX = Math.max(0, Math.min(x, bitmap.width - tagWidth));
    const tagY = Math.max(0, Math.min(y, bitmap.height - LABEL_HEIGHT));
    fill(bitmap, tagX, tagY, tagWidth, LABEL_HEIGHT, LABEL_COLOR);
    let penX = tagX + PAD;
    for (const digit of String(box.id)) {
      DIGITS[digit].forEach((row, rowIndex) => {
        [...row].forEach((bit, colIndex) => {
          if (bit === '1') fill(bitmap, penX + colIndex * SCALE, tagY + PAD + rowIndex * SCALE, SCALE, SCALE, TEXT_COLOR);
        });
      });
      penX += 3 * SCALE + GAP;
    }
  }
}

/** The width a screenshot of a viewport this wide is scaled to. */
export function screenshotWidth(viewportWidth: number): number {
  return Math.max(1, Math.min(MAX_SCREENSHOT_WIDTH, Math.round(viewportWidth)));
}

/** Page CSS pixels per screenshot pixel: how `coords: "screenshot"` points scale back. */
export function screenshotScale(viewportWidth: number): number {
  return viewportWidth / screenshotWidth(viewportWidth);
}

/** The part of nativeImage this module uses. */
export interface ImageLike {
  getSize(): { width: number; height: number };
  resize(options: { width: number; quality?: 'good' | 'better' | 'best' }): ImageLike;
  toBitmap(): Buffer;
  toJPEG(quality: number): Buffer;
}

export interface Screenshot {
  jpeg: Buffer;
  width: number;
  height: number;
}

export function jpegQuality(raw: string | null): number {
  const quality = raw === null ? 70 : Number(raw);
  return Number.isInteger(quality) && quality >= 1 && quality <= 100 ? quality : 70;
}

/**
 * The capture scaled to the screenshot width, with labels drawn when `boxes`
 * is given (boxes in page CSS pixels, read at capture time), as a JPEG.
 */
export function renderScreenshot(
  capture: ImageLike,
  viewportWidth: number,
  boxes: ElementBox[] | null,
  quality: number,
  fromBitmap: (bitmap: Buffer, size: { width: number; height: number }) => ImageLike,
): Screenshot {
  const width = screenshotWidth(viewportWidth);
  const scaled = capture.resize({ width, quality: 'good' });
  const size = scaled.getSize();
  if (!boxes || !boxes.length) return { jpeg: scaled.toJPEG(quality), ...size };
  const data = scaled.toBitmap();
  if (data.length !== size.width * size.height * 4) return { jpeg: scaled.toJPEG(quality), ...size };
  const factor = size.width / viewportWidth;
  drawLabels({ data, ...size }, boxes.map((box) => ({
    id: box.id,
    x: box.x * factor,
    y: box.y * factor,
    width: box.width * factor,
    height: box.height * factor,
  })));
  return { jpeg: fromBitmap(data, size).toJPEG(quality), ...size };
}
