import type { PreviewLimits } from './contract';
import limitsFile from './limits.json';

/* Whether the device the preview runs on is touch-first. The frame runtime
   reads it from matchMedia('(pointer: coarse)'). */
export interface PreviewDevice {
  touch: boolean;
}

/*
 * limits.json, the one place each cap's value is written. `limits` holds every
 * cap on a device without touch, and `touchLimits` the caps a touch device
 * lowers. Documentation that publishes the caps reads this file at the
 * release it describes, so a cap changes here and nowhere else. The types make tsc fail when the file lacks a cap or holds a
 * value that isn't a number; limits.test.ts fails on a name PreviewLimits
 * doesn't have.
 */
export interface PreviewLimitsFile {
  limits: PreviewLimits;
  touchLimits: Pick<PreviewLimits, 'maxPdfCanvasPixels'>;
}

const LIMITS_FILE: Readonly<PreviewLimitsFile> = limitsFile;

/* Every PreviewLimits name. A Record rather than a list, so tsc fails here
   when PreviewLimits gains a cap this table lacks. */
export const PREVIEW_LIMIT_NAMES: Readonly<Record<keyof PreviewLimits, true>> = Object.freeze({
  maxBytes: true,
  maxInflatedBytes: true,
  maxZipEntryInflatedBytes: true,
  maxZipEntries: true,
  maxSheetRows: true,
  maxSheetColumns: true,
  maxSheets: true,
  maxSheetCellCharacters: true,
  maxNumberFormatLength: true,
  maxDocxNodes: true,
  maxDocxFontUrlCharacters: true,
  maxPicturePixels: true,
  maxPdfPages: true,
  maxPdfCanvasPixels: true,
  maxPdfCanvasSide: true,
  maxPdfCanvasesAlive: true,
  maxSlides: true,
  maxSlideElements: true,
  readyTimeoutMs: true,
  progressTimeoutMs: true,
});

/* The caps the parent enforces: the streamed byte cap and the two watchdogs.
   They are the same on every device, so the parent reads them without a
   device. The constant is frozen, so no importer can change a cap for the
   others. */
export type PreviewParentLimits = Pick<PreviewLimits, 'maxBytes' | 'readyTimeoutMs' | 'progressTimeoutMs'>;

export const PREVIEW_PARENT_LIMITS: Readonly<PreviewParentLimits> = Object.freeze({
  maxBytes: LIMITS_FILE.limits.maxBytes,
  readyTimeoutMs: LIMITS_FILE.limits.readyTimeoutMs,
  progressTimeoutMs: LIMITS_FILE.limits.progressTimeoutMs,
});

/* The caps every document preview reads from RendererContext.limits. The frame
   runtime calls this with its own touch reading. A touch device gets a quarter
   of the per-canvas pixel budget; every other cap is the same on every device.
   Each call returns a new object, so no caller can change a cap for another. */
export function previewLimits(device: PreviewDevice): PreviewLimits {
  return { ...LIMITS_FILE.limits, ...(device.touch ? LIMITS_FILE.touchLimits : {}) };
}
