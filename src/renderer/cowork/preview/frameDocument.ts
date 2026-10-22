/*
 * The document preview frame's source. Nothing here imports anything Vite-only,
 * so Node and the Electron spec can import this module as it is.
 */
import { isPreviewToken, PREVIEW_TOKEN_META_NAME } from './runtime/protocol';

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

/* Text that would end the inline script early, or that the HTML parser would
   rewrite so the script no longer matches its hash. */
const UNSAFE_SCRIPT_TEXT = /<\/?script|[\0\r]/i;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/*
 * The one place a document preview's frame document is written. It holds, in
 * this order, the frame policy, a DNS prefetch opt-out, the token meta and the
 * script whose hash the policy names. The policy must be exactly
 * previewFramePolicy(scriptSha256), so no caller can widen it, and a token or
 * script text the frame can't use throws instead of building a frame.
 */
export function buildPreviewSrcdoc(input: PreviewSrcdocInput): string {
  const { policy, token, scriptText, scriptSha256 } = input;
  if (policy !== previewFramePolicy(scriptSha256)) {
    throw new Error('buildPreviewSrcdoc takes only the frame policy for its script');
  }
  if (!isPreviewToken(token)) {
    throw new Error('buildPreviewSrcdoc needs a 128-bit hex token');
  }
  if (UNSAFE_SCRIPT_TEXT.test(scriptText)) {
    throw new Error('buildPreviewSrcdoc needs script text without script tags, NUL or CR');
  }
  return [
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">`,
    '<meta http-equiv="x-dns-prefetch-control" content="off">',
    `<meta name="${PREVIEW_TOKEN_META_NAME}" content="${token}">`,
    `<script>${scriptText}</script>`,
  ].join('');
}
