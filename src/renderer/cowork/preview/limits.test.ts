import { describe, expect, it } from 'vitest';

import { PREVIEW_PARENT_LIMITS, previewLimits } from './limits';

describe('previewLimits', () => {
  it('pins every cap on a device without touch', () => {
    expect(previewLimits({ touch: false })).toEqual({
      maxBytes: 33_554_432,
      maxInflatedBytes: 268_435_456,
      maxZipEntryInflatedBytes: 67_108_864,
      maxZipEntries: 10_000,
      maxSheetRows: 2_000,
      maxSheetColumns: 200,
      maxPdfPages: 500,
      maxPdfCanvasPixels: 16_777_216,
      maxPdfCanvasesAlive: 6,
      maxSlides: 300,
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

  it('gives the parent the same byte cap and watchdogs on every device', () => {
    for (const touch of [false, true]) {
      const { maxBytes, readyTimeoutMs, progressTimeoutMs } = previewLimits({ touch });
      expect(PREVIEW_PARENT_LIMITS).toEqual({ maxBytes, readyTimeoutMs, progressTimeoutMs });
    }
  });
});

describe('PREVIEW_PARENT_LIMITS', () => {
  it('is frozen, so no importer can change a cap for the others', () => {
    expect(Object.isFrozen(PREVIEW_PARENT_LIMITS)).toBe(true);
  });
});
