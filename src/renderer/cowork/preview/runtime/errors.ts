import type { PreviewErrorCode } from '../contract';
import { isPreviewError } from '../errors';

/* The codes the frame may report. too-large and timeout belong to the parent,
   which raises them before or around the frame, never from inside it. */
const FRAME_ERROR_CODES: ReadonlySet<PreviewErrorCode> = new Set(['zip-limit', 'parse-failed', 'unsupported', 'internal']);

/* The code the frame reports for a failure: a PreviewError's own code when the
   frame may raise it, and internal for anything else. */
export function frameErrorCode(error: unknown): PreviewErrorCode {
  return isPreviewError(error) && FRAME_ERROR_CODES.has(error.code) ? error.code : 'internal';
}
