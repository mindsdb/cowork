/*
 * The one shared helper for preview errors. It imports only types from
 * contract.ts and nothing Vite-only, so the frame runtime bundle, every
 * renderer, the parent and Node can import it as it is.
 */
import type { PreviewError, PreviewErrorCode } from './contract';

/* Every PreviewErrorCode. A Record rather than a list, so tsc fails here when
   PreviewErrorCode gains a code this table lacks. Frozen, so no importer can
   add or remove a code for the others. */
export const PREVIEW_ERROR_CODES: Readonly<Record<PreviewErrorCode, true>> = Object.freeze({
  'too-large': true,
  'zip-limit': true,
  'parse-failed': true,
  unsupported: true,
  timeout: true,
  internal: true,
});

/* Object.hasOwn rather than `in`, so names every object inherits, such as
   toString, are not codes. */
export function isPreviewErrorCode(value: unknown): value is PreviewErrorCode {
  return typeof value === 'string' && Object.hasOwn(PREVIEW_ERROR_CODES, value);
}

/* The rejection that fails a preview with a code. The message defaults to the
   code, and options passes a cause to the Error constructor. */
export function previewError(code: PreviewErrorCode, message: string = code, options?: ErrorOptions): PreviewError {
  return Object.assign(new Error(message, options), { name: 'PreviewError', code });
}

/* An Error that carries a known code, whichever factory built it. */
export function isPreviewError(value: unknown): value is PreviewError {
  return value instanceof Error && 'code' in value && isPreviewErrorCode(value.code);
}
