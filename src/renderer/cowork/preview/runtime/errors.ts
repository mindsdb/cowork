import type { PreviewErrorCode } from '../contract';
import { isPreviewError, isPreviewErrorCode } from '../errors';

/* The codes the frame may report. too-large and timeout belong to the parent,
   which raises them before or around the frame, never from inside it. */
const FRAME_ERROR_CODES: ReadonlySet<PreviewErrorCode> = new Set(['zip-limit', 'parse-failed', 'unsupported', 'internal']);

/* Whether a code is one the frame may report. The parent reads the frame's
   error messages with it, so a frame that sends a parent-owned code is
   dropped like any other malformed message. */
export function isFrameErrorCode(value: unknown): value is PreviewErrorCode {
  return isPreviewErrorCode(value) && FRAME_ERROR_CODES.has(value);
}

/* The code the frame reports for a failure: a PreviewError's own code when the
   frame may raise it, and internal for anything else. */
export function frameErrorCode(error: unknown): PreviewErrorCode {
  return isPreviewError(error) && isFrameErrorCode(error.code) ? error.code : 'internal';
}
