/**
 * Trigger a browser save-as from a temporary anchor.
 *
 * Three call sites built this by hand and drifted on the one detail that
 * matters: how long the object URL has to outlive the click. Firefox and
 * Safari can truncate or cancel a save that has not started reading the blob
 * by the time it is revoked, so the delay below is the load-bearing part and
 * lives in exactly one place.
 */

import { host } from '../../platform/host';

export const MOBILE_DOWNLOAD_NOTE = 'Downloads are not available in the mobile app yet. Open Cowork in your browser to download this file.';

/** Preserve each caller's existing error outside the native mobile shell. */
export function downloadUnavailableMessage(fallback) {
  return host.isMobileShell ? MOBILE_DOWNLOAD_NOTE : fallback;
}

/** Long enough for every browser to have started reading the object URL. */
const REVOKE_AFTER_MS = 1_000;

/**
 * A save-as names a file, not a path.
 *
 * Browsers sanitize separators in the `download` attribute rather than honoring
 * them, so handing over `.anton/anton.md` saves under a mangled name of the
 * browser's choosing. Split on both kinds: a Windows-hosted server hands back
 * back-slashed paths.
 */
export function downloadFilename(path, fallback = 'download') {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).pop() || fallback;
}

/**
 * The file name a `Content-Disposition` header suggests, or `fallback`.
 *
 * A server that names a file outside ASCII sends two spellings: a lossy ASCII
 * `filename="..."` for old clients and the real name as RFC 5987
 * `filename*=UTF-8''<percent-encoded>`. Prefer the latter; a malformed one
 * falls back to the ASCII spelling rather than failing the save.
 */
export function contentDispositionFilename(header, fallback = 'download') {
  const value = String(header ?? '');
  const extended = /(?:^|;)\s*filename\*\s*=\s*"?([^;"]*)"?/i.exec(value)?.[1]?.trim();
  if (extended) {
    const [, charset, encoded] = /^([^']*)'[^']*'(.*)$/.exec(extended) || [];
    if (charset && /^utf-8$/i.test(charset) && encoded) {
      try {
        const name = downloadFilename(decodeURIComponent(encoded), '');
        if (name) return name;
      } catch { /* bad percent-encoding: use the plain spelling */ }
    }
  }
  const plain = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;\s]+))/i.exec(value);
  const name = plain ? (plain[1] !== undefined ? plain[1].replace(/\\(.)/g, '$1') : plain[2]) : '';
  return downloadFilename(name, fallback);
}

/** Save the bytes behind a URL the browser can fetch on its own. */
export function downloadUrl(url, filename) {
  if (!url || host.isMobileShell) return false;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return true;
}

/** Save an in-memory blob, revoking its object URL once the save has started. */
export function downloadBlob(blob, filename) {
  if (host.isMobileShell) return false;
  const objectUrl = URL.createObjectURL(blob);
  try {
    return downloadUrl(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
  }
}
