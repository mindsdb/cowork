/*
 * Screenshots for anton's browser tool.
 *
 * Main captures the view, scales it to at most MAX_SCREENSHOT_WIDTH pixels
 * wide (the width the web pod uses too), and draws the element numbers into
 * the bitmap itself, from boxes the page read returned at capture time. Nothing
 * is drawn into the page, so a page never sees the labels. Element ids are
 * integers, so a small built-in digit font is enough. Before the labels, it
 * blacks out what the page read says the model must not see (secret fields,
 * payment frames), and answers no image when it can't.
 */

import { BridgeError, MAX_SCREENSHOT_WIDTH } from '../shared/browser-contract';
import type { Box, ElementBox } from './browser-page-script';

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
const MASK_COLOR = [0, 0, 0, 0xff] as const;

function setPixel(bitmap: Bitmap, x: number, y: number, color: readonly number[]): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const at = (y * bitmap.width + x) * 4;
  bitmap.data[at] = color[0];
  bitmap.data[at + 1] = color[1];
  bitmap.data[at + 2] = color[2];
  bitmap.data[at + 3] = color[3];
}

/* Fills only the part of the rectangle inside the bitmap, so a page's huge
   element box costs no more than the bitmap's own size. A rectangle with a
   value that isn't finite draws nothing. */
function fill(bitmap: Bitmap, x: number, y: number, width: number, height: number, color: readonly number[]): void {
  if (![x, y, width, height].every(Number.isFinite)) return;
  const left = Math.max(0, x);
  const top = Math.max(0, y);
  const right = Math.min(bitmap.width, x + width);
  const bottom = Math.min(bitmap.height, y + height);
  for (let row = top; row < bottom; row += 1) {
    for (let col = left; col < right; col += 1) setPixel(bitmap, col, row, color);
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

/** How a page read looks at a frame it read (ElectronTab.read in
    browser-view.ts): the frame's box, captured as the page draws it, scaled
    down to FRAME_LOOK_SCALE of its CSS width, FRAME_LOOK_MAX_PX at most. */
export const FRAME_LOOK_SCALE = 0.5;
export const FRAME_LOOK_MAX_PX = 160;

/* A pixel draws something over a frame's box when one of its channels is
   more than this off the box's main color. */
const DRAWN_CHANNEL_DIFFERENCE = 32;

/* A box that draws something on at most this share of its pixels reads as
   one color: a few pinholes in a cover don't show a frame's text. */
const ONE_COLOR_SHARE = 0.003;

/** A frame's box as a page read looks at it: `capture` scaled down to
    FRAME_LOOK_SCALE of the box's CSS width (`cssWidth`), FRAME_LOOK_MAX_PX
    wide at most, as a bitmap; null for a capture with nothing in it or a
    bitmap that can't be read. */
export function frameLook(capture: ImageLike, cssWidth: number): Bitmap | null {
  if (!capture.getSize().width) return null;
  const look = capture.resize({ width: Math.max(1, Math.min(FRAME_LOOK_MAX_PX, Math.round(cssWidth * FRAME_LOOK_SCALE))), quality: 'good' });
  const size = look.getSize();
  const data = look.toBitmap();
  if (!size.width || !size.height || data.length !== size.width * size.height * 4) return null;
  return { data, ...size };
}

/** Whether a look at a frame's box (frameLook) is nearly one color: at most
    ONE_COLOR_SHARE of its pixels more than DRAWN_CHANNEL_DIFFERENCE off its
    main color, the mean of its most common colors (each channel cut to 16
    levels). Text a person can read, dimmed or in a dark mode too, draws far
    more; a cover of one color, through a few pinholes or over text so faint
    it barely shows, doesn't. */
export function nearlyOneColor(bitmap: Bitmap): boolean {
  const pixels = bitmap.width * bitmap.height;
  const counts = new Uint32Array(4096);
  const sums = new Float64Array(4096 * 3);
  const { data } = bitmap;
  for (let at = 0; at < pixels * 4; at += 4) {
    const key = ((data[at] >> 4) << 8) | ((data[at + 1] >> 4) << 4) | (data[at + 2] >> 4);
    counts[key] += 1;
    sums[key * 3] += data[at];
    sums[key * 3 + 1] += data[at + 1];
    sums[key * 3 + 2] += data[at + 2];
  }
  let main = 0;
  for (let key = 1; key < counts.length; key += 1) if (counts[key] > counts[main]) main = key;
  const color = [0, 1, 2].map((channel) => sums[main * 3 + channel] / counts[main]);
  let drawn = 0;
  for (let at = 0; at < pixels * 4; at += 4) {
    const off = Math.max(Math.abs(data[at] - color[0]), Math.abs(data[at + 1] - color[1]), Math.abs(data[at + 2] - color[2]));
    if (off > DRAWN_CHANNEL_DIFFERENCE) drawn += 1;
  }
  return drawn <= pixels * ONE_COLOR_SHARE;
}

export function jpegQuality(raw: string | null): number {
  const quality = raw === null ? 70 : Number(raw);
  return Number.isInteger(quality) && quality >= 1 && quality <= 100 ? quality : 70;
}

/**
 * The capture scaled to the screenshot width, with `masks` blacked out and
 * then labels drawn when `boxes` is given (both in page CSS pixels, read at
 * capture time), as a JPEG. A capture it can't mask gets no image at all: a
 * card number the person typed must never reach the model.
 */
export function renderScreenshot(
  capture: ImageLike,
  viewportWidth: number,
  boxes: ElementBox[] | null,
  quality: number,
  fromBitmap: (bitmap: Buffer, size: { width: number; height: number }) => ImageLike,
  masks: Box[],
): Screenshot {
  const width = screenshotWidth(viewportWidth);
  const scaled = capture.resize({ width, quality: 'good' });
  const size = scaled.getSize();
  if (!boxes?.length && !masks.length) return { jpeg: scaled.toJPEG(quality), ...size };
  const data = scaled.toBitmap();
  if (data.length !== size.width * size.height * 4) {
    if (masks.length) throw new BridgeError('internal', "the screenshot could not hide the page's secret fields, so none was taken");
    return { jpeg: scaled.toJPEG(quality), ...size };
  }
  const factor = size.width / viewportWidth;
  const bitmap = { data, ...size };
  // Outward to whole pixels, so no edge of a secret shows.
  for (const mask of masks) {
    const left = Math.floor(mask.x * factor);
    const top = Math.floor(mask.y * factor);
    fill(bitmap, left, top, Math.ceil((mask.x + mask.width) * factor) - left, Math.ceil((mask.y + mask.height) * factor) - top, MASK_COLOR);
  }
  drawLabels(bitmap, (boxes ?? []).map((box) => ({
    id: box.id,
    x: box.x * factor,
    y: box.y * factor,
    width: box.width * factor,
    height: box.height * factor,
  })));
  return { jpeg: fromBitmap(data, size).toJPEG(quality), ...size };
}
