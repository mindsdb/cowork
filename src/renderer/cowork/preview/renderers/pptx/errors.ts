import type { PreviewError, PreviewErrorCode } from '../../contract';

/* Every PreviewErrorCode, so isPreviewError knows a code when it sees one. */
const PREVIEW_ERROR_CODES: Record<PreviewErrorCode, true> = {
  'too-large': true,
  'zip-limit': true,
  'parse-failed': true,
  unsupported: true,
  timeout: true,
  internal: true,
};

export function previewError(code: PreviewErrorCode, message: string): PreviewError {
  return Object.assign(new Error(message), { name: 'PreviewError', code });
}

export function isPreviewError(error: unknown): error is PreviewError {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    Object.hasOwn(PREVIEW_ERROR_CODES, error.code)
  );
}
