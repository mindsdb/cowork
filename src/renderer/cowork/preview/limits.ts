import type { PreviewLimits } from './contract';

const MIB = 1024 * 1024;

/* Whether the device the preview runs on is touch-first. The frame runtime
   reads it from matchMedia('(pointer: coarse)'). */
export interface PreviewDevice {
  touch: boolean;
}

/* The caps every document preview reads from RendererContext.limits. A touch
   device gets a quarter of the per-canvas pixel budget; every other cap is the
   same on every device. */
export function previewLimits(device: PreviewDevice): PreviewLimits {
  return {
    maxBytes: 32 * MIB,
    maxInflatedBytes: 256 * MIB,
    maxZipEntryInflatedBytes: 64 * MIB,
    maxZipEntries: 10_000,
    maxSheetRows: 2_000,
    maxSheetColumns: 200,
    maxPdfPages: 500,
    maxPdfCanvasPixels: device.touch ? 4_194_304 : 16_777_216,
    maxPdfCanvasesAlive: 6,
    maxSlides: 300,
    readyTimeoutMs: 10_000,
    progressTimeoutMs: 20_000,
  };
}
