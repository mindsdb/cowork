/**
 * Trigger a browser save-as from a temporary anchor.
 *
 * Three call sites built this by hand and drifted on the one detail that
 * matters: how long the object URL has to outlive the click. Firefox and
 * Safari can truncate or cancel a save that has not started reading the blob
 * by the time it is revoked, so the delay below is the load-bearing part and
 * lives in exactly one place.
 */

/** Long enough for every browser to have started reading the object URL. */
const REVOKE_AFTER_MS = 1_000;

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
