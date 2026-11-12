import { describe, expect, it, vi } from 'vitest';
import {
  type Bitmap,
  drawLabels,
  type ImageLike,
  jpegQuality,
  LABEL_HEIGHT,
  labelWidth,
  renderScreenshot,
  screenshotScale,
  screenshotWidth,
} from './browser-screenshot';

const WHITE = [0xff, 0xff, 0xff, 0xff];

function blank(width: number, height: number): Bitmap {
  return { data: Buffer.alloc(width * height * 4, 0x80), width, height };
}

function pixel(bitmap: Bitmap, x: number, y: number): number[] {
  const at = (y * bitmap.width + x) * 4;
  return [...bitmap.data.subarray(at, at + 4)];
}

function changedPixels(bitmap: Bitmap): Array<[number, number]> {
  const changed: Array<[number, number]> = [];
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      if (pixel(bitmap, x, y).some((v) => v !== 0x80)) changed.push([x, y]);
    }
  }
  return changed;
}

describe('screenshot labels', () => {
  it('outlines the box and puts the number at its top-left corner', () => {
    const bitmap = blank(200, 100);
    drawLabels(bitmap, [{ id: 7, x: 40, y: 30, width: 80, height: 40 }]);
    const changed = changedPixels(bitmap);
    expect(Math.min(...changed.map(([x]) => x))).toBe(40);
    expect(Math.min(...changed.map(([, y]) => y))).toBe(30);
    expect(Math.max(...changed.map(([x]) => x))).toBe(119);
    expect(Math.max(...changed.map(([, y]) => y))).toBe(69);
    // The 7's top bar is white, inside the tag.
    expect(pixel(bitmap, 42, 32)).toEqual(WHITE);
    expect(pixel(bitmap, 46, 32)).toEqual(WHITE);
    // The box's inside stays untouched below the tag.
    expect(pixel(bitmap, 80, 55)).toEqual([0x80, 0x80, 0x80, 0x80]);
  });

  it('draws one glyph per digit', () => {
    const one = blank(100, 40);
    const three = blank(100, 40);
    drawLabels(one, [{ id: 8, x: 0, y: 0, width: 1, height: 1 }]);
    drawLabels(three, [{ id: 888, x: 0, y: 0, width: 1, height: 1 }]);
    const whites = (b: Bitmap) => changedPixels(b).filter(([x, y]) => pixel(b, x, y).every((v, i) => v === WHITE[i])).length;
    expect(whites(three)).toBe(3 * whites(one));
    expect(labelWidth(888)).toBeGreaterThan(labelWidth(8));
  });

  it('keeps a tag inside the image at the edges', () => {
    const bitmap = blank(50, 30);
    drawLabels(bitmap, [{ id: 123, x: 45, y: 28, width: 10, height: 10 }]);
    const changed = changedPixels(bitmap);
    expect(changed.some(([x, y]) => x === 50 - labelWidth(123) && y === 30 - LABEL_HEIGHT)).toBe(true);
  });

  it('draws a huge box at the cost of the bitmap, not the box', () => {
    const bitmap = blank(200, 100);
    const started = performance.now();
    drawLabels(bitmap, [{ id: 1, x: -5e8, y: 20, width: 1e9, height: 1e9 }]);
    expect(performance.now() - started).toBeLessThan(500);
    // The top edge crosses the whole bitmap; the other edges are off it.
    expect(pixel(bitmap, 199, 20)).not.toEqual([0x80, 0x80, 0x80, 0x80]);
    expect(pixel(bitmap, 100, 99)).toEqual([0x80, 0x80, 0x80, 0x80]);
  });

  it('skips every edge whose values are not finite', () => {
    const bitmap = blank(50, 30);
    drawLabels(bitmap, [{ id: 4, x: Number.NaN, y: 0, width: 10, height: 10 }, { id: 5, x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 }]);
    // Only the second box's tag and its left edge are drawn.
    expect(changedPixels(bitmap).every(([x, y]) => (x < labelWidth(5) && y < LABEL_HEIGHT) || x === 0)).toBe(true);
  });
});

describe('screenshot size', () => {
  it('scales a wide viewport down to 1024 and maps points back', () => {
    expect(screenshotWidth(1600)).toBe(1024);
    expect(screenshotScale(1600)).toBeCloseTo(1.5625);
    expect(screenshotWidth(800)).toBe(800);
    expect(screenshotScale(800)).toBe(1);
  });

  it('reads a JPEG quality between 1 and 100, or 70', () => {
    expect(jpegQuality('85')).toBe(85);
    expect(jpegQuality(null)).toBe(70);
    expect(jpegQuality('0')).toBe(70);
    expect(jpegQuality('abc')).toBe(70);
  });
});

describe('renderScreenshot', () => {
  function capture(viewportWidth: number, dpr: number) {
    const resized = vi.fn((options: { width: number }) => {
      const height = Math.round((options.width / viewportWidth) * 600);
      const data = Buffer.alloc(options.width * height * 4, 0x80);
      const scaled: ImageLike = {
        getSize: () => ({ width: options.width, height }),
        resize: () => scaled,
        toBitmap: () => data,
        toJPEG: () => Buffer.from('plain'),
      };
      return scaled;
    });
    const image: ImageLike = {
      getSize: () => ({ width: viewportWidth * dpr, height: 600 * dpr }),
      resize: resized,
      toBitmap: () => Buffer.alloc(0),
      toJPEG: () => Buffer.from('unscaled'),
    };
    return { image, resized };
  }

  it('scales a retina capture to the viewport width and labels at scaled boxes', () => {
    const { image, resized } = capture(1600, 2);
    let drawn: Buffer | null = null;
    const fromBitmap = vi.fn((data: Buffer, size: { width: number; height: number }): ImageLike => {
      drawn = data;
      return { getSize: () => size, resize: () => image, toBitmap: () => data, toJPEG: () => Buffer.from('labelled') };
    });
    const shot = renderScreenshot(image, 1600, [{ id: 1, x: 160, y: 160, width: 320, height: 80 }], 70, fromBitmap, []);
    expect(resized).toHaveBeenCalledWith({ width: 1024, quality: 'good' });
    expect(shot).toEqual({ jpeg: Buffer.from('labelled'), width: 1024, height: 384 });
    const bitmap = { data: drawn!, width: 1024, height: 384 };
    // 160 CSS px at 1024/1600 is 102.4, so the outline starts at 102.
    expect(pixel(bitmap, 102, 102)).not.toEqual([0x80, 0x80, 0x80, 0x80]);
    expect(pixel(bitmap, 101, 101)).toEqual([0x80, 0x80, 0x80, 0x80]);
  });

  it('skips drawing when not annotated', () => {
    const { image } = capture(800, 1);
    const fromBitmap = vi.fn();
    expect(renderScreenshot(image, 800, null, 70, fromBitmap, [])).toEqual({ jpeg: Buffer.from('plain'), width: 800, height: 600 });
    expect(fromBitmap).not.toHaveBeenCalled();
  });

  const BLACK = [0, 0, 0, 0xff];
  const GREY = [0x80, 0x80, 0x80, 0x80];
  function drawnTo(): { fromBitmap: (data: Buffer, size: { width: number; height: number }) => ImageLike; bitmap: () => Bitmap } {
    let drawn: Bitmap | null = null;
    return {
      fromBitmap: (data, size) => {
        drawn = { data, ...size };
        return { getSize: () => size, resize: () => { throw new Error('unused'); }, toBitmap: () => data, toJPEG: () => Buffer.from('drawn') };
      },
      bitmap: () => drawn!,
    };
  }

  it('blacks out each mask, scaled like the labels, before it draws them', () => {
    const { image } = capture(1600, 2);
    const out = drawnTo();
    const shot = renderScreenshot(image, 1600, [{ id: 1, x: 160, y: 160, width: 320, height: 80 }], 70, out.fromBitmap, [{ x: 160, y: 320, width: 320, height: 160 }]);
    expect(shot.jpeg).toEqual(Buffer.from('drawn'));
    // 160 to 480 CSS px is 102.4 to 307.2 in the 1024-wide image, and the mask covers its edge pixels.
    expect(pixel(out.bitmap(), 102, 204)).toEqual(BLACK);
    expect(pixel(out.bitmap(), 307, 307)).toEqual(BLACK);
    expect(pixel(out.bitmap(), 200, 250)).toEqual(BLACK);
    expect(pixel(out.bitmap(), 90, 250)).toEqual(GREY);
    expect(pixel(out.bitmap(), 102, 102)).not.toEqual(GREY);
  });

  it('masks a screenshot taken without labels too', () => {
    const { image } = capture(800, 1);
    const out = drawnTo();
    renderScreenshot(image, 800, null, 70, out.fromBitmap, [{ x: 10, y: 10, width: 100, height: 20 }]);
    expect(pixel(out.bitmap(), 50, 15)).toEqual(BLACK);
    expect(pixel(out.bitmap(), 50, 40)).toEqual(GREY);
  });

  it('answers no image when it cannot mask one, and an unlabelled one when it only cannot label it', () => {
    const odd: ImageLike = { getSize: () => ({ width: 800, height: 600 }), resize: () => odd, toBitmap: () => Buffer.alloc(16), toJPEG: () => Buffer.from('plain') };
    expect(() => renderScreenshot(odd, 800, null, 70, vi.fn(), [{ x: 10, y: 10, width: 100, height: 20 }])).toThrow(expect.objectContaining({ code: 'internal' }));
    expect(renderScreenshot(odd, 800, [{ id: 1, x: 0, y: 0, width: 10, height: 10 }], 70, vi.fn(), [])).toEqual({ jpeg: Buffer.from('plain'), width: 800, height: 600 });
  });
});
