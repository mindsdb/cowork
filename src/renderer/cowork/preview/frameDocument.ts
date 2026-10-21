/*
 * The document preview frame's source. Nothing here imports anything Vite-only,
 * so Node and the Electron spec can import this module as it is.
 */
export { PREVIEW_FRAME_NAME } from '../../../shared/document-preview';

export const PREVIEW_SANDBOX = 'allow-scripts' as const;

export interface PreviewSrcdocInput { policy: string; token: string; scriptText: string; scriptSha256: string }

/* A base64 sha256 digest: 32 bytes are 43 characters plus one '=' of padding. */
const SHA256_BASE64 = /^[A-Za-z0-9+/]{43}=$/;

/*
 * The frame's Content-Security-Policy. Every source is 'none' except the one
 * script whose base64 sha256 is scriptSha256, inline styles, and blob: and
 * data: images and data: fonts. A digest of any other shape throws, so no
 * caller can splice another directive into the policy.
 */
export function previewFramePolicy(scriptSha256: string): string {
  if (!SHA256_BASE64.test(scriptSha256)) {
    throw new Error('previewFramePolicy needs a base64 sha256 digest');
  }
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptSha256}'`,
    "style-src 'unsafe-inline'",
    'img-src blob: data:',
    'font-src data:',
    "media-src 'none'",
    "connect-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "manifest-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

export function buildPreviewSrcdoc(input: PreviewSrcdocInput): string {
  throw new Error('buildPreviewSrcdoc is not implemented yet');
}
