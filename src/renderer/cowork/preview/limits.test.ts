import { describe, expect, it } from 'vitest';

import { previewLimits } from './limits';

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
});
