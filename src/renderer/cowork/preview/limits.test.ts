import { describe, expect, it } from 'vitest';

import limitsFile from './limits.json';
import { PREVIEW_LIMIT_NAMES, PREVIEW_PARENT_LIMITS, previewLimits } from './limits';

describe('previewLimits', () => {
  it('pins every cap on a device without touch', () => {
    expect(previewLimits({ touch: false })).toEqual({
      maxBytes: 33_554_432,
      maxInflatedBytes: 268_435_456,
      maxZipEntryInflatedBytes: 67_108_864,
      maxZipEntries: 10_000,
      maxSheetRows: 2_000,
      maxSheetColumns: 200,
      maxSheets: 256,
      maxSheetCellCharacters: 1_000,
      maxNumberFormatLength: 255,
      maxDocxNodes: 2_097_152,
      maxDocxFontUrlCharacters: 16_777_216,
      maxPicturePixels: 67_108_864,
      maxPdfPages: 500,
      maxPdfCanvasPixels: 16_777_216,
      maxPdfCanvasSide: 16_384,
      maxPdfCanvasesAlive: 6,
      maxSlides: 300,
      maxSlideElements: 100_000,
      readyTimeoutMs: 10_000,
      progressTimeoutMs: 20_000,
    });
  });

  it('lowers only the per-canvas pixel cap on a touch device', () => {
    expect(previewLimits({ touch: true })).toEqual({
      ...previewLimits({ touch: false }),
      maxPdfCanvasPixels: 4_194_304,
    });
  });

  it('keeps the caps that came from the inflate budget at the values the renderers used to work out', () => {
    const limits = previewLimits({ touch: false });
    expect(limits.maxPicturePixels).toBe(limits.maxInflatedBytes / 4);
    expect(limits.maxDocxNodes).toBe(limits.maxInflatedBytes / 128);
    expect(limits.maxDocxFontUrlCharacters).toBe(limits.maxInflatedBytes / 16);
  });

  it('gives the parent the same byte cap and watchdogs on every device', () => {
    for (const touch of [false, true]) {
      const { maxBytes, readyTimeoutMs, progressTimeoutMs } = previewLimits({ touch });
      expect(PREVIEW_PARENT_LIMITS).toEqual({ maxBytes, readyTimeoutMs, progressTimeoutMs });
    }
  });

  it('returns a new object on each call, so no caller changes a cap for another', () => {
    const first = previewLimits({ touch: false });
    first.maxBytes = 1;
    expect(previewLimits({ touch: false }).maxBytes).toBe(33_554_432);
  });
});

describe('limits.json', () => {
  it('names only caps PreviewLimits has, and every one of them', () => {
    expect(Object.keys(limitsFile.limits).sort()).toEqual(Object.keys(PREVIEW_LIMIT_NAMES).sort());
  });

  it('lowers on touch only caps PreviewLimits has', () => {
    for (const name of Object.keys(limitsFile.touchLimits)) expect(Object.hasOwn(PREVIEW_LIMIT_NAMES, name)).toBe(true);
  });

  it('holds two parts and nothing else, the shape a reader outside this repository relies on', () => {
    expect(Object.keys(limitsFile).sort()).toEqual(['limits', 'touchLimits']);
  });
});

describe('PREVIEW_PARENT_LIMITS', () => {
  it('is frozen, so no importer can change a cap for the others', () => {
    expect(Object.isFrozen(PREVIEW_PARENT_LIMITS)).toBe(true);
  });
});
