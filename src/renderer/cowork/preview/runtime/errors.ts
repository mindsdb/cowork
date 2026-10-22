import type { PreviewError, PreviewErrorCode } from '../contract';

export const PREVIEW_ERROR_CODES: readonly PreviewErrorCode[] = [
  'too-large', 'zip-limit', 'parse-failed', 'unsupported', 'timeout', 'internal',
];

/* The codes the frame may report. too-large and timeout belong to the parent,
   which raises them before or around the frame, never from inside it. */
const FRAME_ERROR_CODES: ReadonlySet<PreviewErrorCode> = new Set(['zip-limit', 'parse-failed', 'unsupported', 'internal']);

export function isPreviewErrorCode(value: unknown): value is PreviewErrorCode {
  return typeof value === 'string' && (PREVIEW_ERROR_CODES as readonly string[]).includes(value);
}

/* The rejection a renderer uses to fail with a code. Renderers import it from
   here, since the runtime is bundled into every renderer's frame script. */
export function previewError(code: PreviewErrorCode, message: string = code): PreviewError {
  return Object.assign(new Error(message), { code });
}

export function isPreviewError(value: unknown): value is PreviewError {
  return value instanceof Error && 'code' in value && isPreviewErrorCode(value.code);
}

/* The code the frame reports for a failure: a PreviewError's own code when the
   frame may raise it, and internal for anything else. */
export function frameErrorCode(error: unknown): PreviewErrorCode {
  return isPreviewError(error) && FRAME_ERROR_CODES.has(error.code) ? error.code : 'internal';
}
