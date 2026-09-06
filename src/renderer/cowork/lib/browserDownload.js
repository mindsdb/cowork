/**
 * Delay Blob URL revocation until the browser starts reading; immediate revocation can cancel or
 * truncate Firefox/Safari saves.
 */

/** Long enough for every browser to have started reading the object URL. */
const REVOKE_AFTER_MS = 1_000;

/**
 * The download attribute needs a filename: browsers mangle path separators.
 * Split both slash forms for Windows-hosted files.
 */
export function downloadFilename(path, fallback = 'download') {
  return String(path ?? '').split(/[\\/]/).filter(Boolean).pop() || fallback;
}

/** Save the bytes behind a URL the browser can fetch on its own. */
export function downloadUrl(url, filename) {
  if (!url) return false;
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
  const objectUrl = URL.createObjectURL(blob);
  try {
    return downloadUrl(objectUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
  }
}
