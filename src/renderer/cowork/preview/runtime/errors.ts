import type { PreviewErrorCode, PreviewFailure, PreviewFailureLimit } from '../contract';
import { isPreviewError, isPreviewErrorCode, isPreviewFailureLimit } from '../errors';

/* The codes the frame may report. timeout belongs to the parent, which raises
   it around the frame, never from inside it. too-large is the parent's past
   maxBytes, and the frame's only with a limit the frame owns. */
const FRAME_ERROR_CODES: ReadonlySet<PreviewErrorCode> = new Set(['too-large', 'zip-limit', 'parse-failed', 'unsupported', 'internal']);

/* The limits the frame may name: the archive guard's and the renderers'. The
   byte cap and the watchdogs are the parent's. */
const FRAME_FAILURE_LIMITS: ReadonlySet<PreviewFailureLimit> = new Set([
  'maxInflatedBytes',
  'maxZipEntryInflatedBytes',
  'maxZipEntries',
  'maxDocxNodes',
]);

/* Whether a code is one the frame may report. The parent reads the frame's
   error messages with it, so a frame that sends a parent-owned code is
   dropped like any other malformed message. */
export function isFrameErrorCode(value: unknown): value is PreviewErrorCode {
  return isPreviewErrorCode(value) && FRAME_ERROR_CODES.has(value);
}

/* Whether a limit is one the frame may name. */
export function isFrameFailureLimit(value: unknown): value is PreviewFailureLimit {
  return isPreviewFailureLimit(value) && FRAME_FAILURE_LIMITS.has(value);
}

/* The failure a code and a limit make, or null when the frame may not report
   them together. Only too-large and zip-limit name a limit, and a too-large
   from the frame must name the one it passed. The parent reads the frame's
   error messages with it, so a frame that names a parent-owned limit is
   dropped like any other malformed message. */
export function readFrameFailure(code: unknown, limit: unknown): Pick<PreviewFailure, 'code' | 'limit'> | null {
  if (!isFrameErrorCode(code)) return null;
  if (limit === undefined) return code === 'too-large' ? null : { code };
  return (code === 'too-large' || code === 'zip-limit') && isFrameFailureLimit(limit) ? { code, limit } : null;
}

/* What the frame reports for a failure: a PreviewError's own code and limit
   when the frame may raise them, and internal for anything else. */
export function frameFailure(error: unknown): Pick<PreviewFailure, 'code' | 'limit'> {
  return (isPreviewError(error) && readFrameFailure(error.code, error.limit)) || { code: 'internal' };
}
