import { host } from '../../platform/host';
import { authFetch } from '../api';

const REVOKE_OPENED_BLOB_AFTER_MS = 60_000;

function fileRequestError(response) {
  const status = Number(response?.status) || 0;
  return new Error(status ? `Could not load file (${status})` : 'Could not load file');
}

function revokeLater(objectUrl, delay = 0) {
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), delay);
}

function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  link.remove();
  revokeLater(objectUrl);
}

function canOpenBlobInline(blob) {
  const type = String(blob?.type || '').toLowerCase().split(';', 1)[0].trim();
  return /^(?:image\/(?:avif|bmp|gif|jpeg|png|webp)|audio\/|video\/|application\/pdf$|application\/json$|text\/(?:csv|plain)$)/.test(type);
}

function assertPrivateApiUrl(url) {
  if (!host.isWeb) return;
  let target;
  let apiOrigin;
  try {
    apiOrigin = new URL(host.getApiOrigin(), window.location.href);
    target = new URL(url, apiOrigin);
  } catch {
    throw new Error('Refusing to send browser credentials to an invalid file URL');
  }
  const isApiPath = target.pathname === '/api/v1' || target.pathname.startsWith('/api/v1/');
  if (target.origin !== apiOrigin.origin || !isApiPath) {
    throw new Error('Refusing to send browser credentials outside the Cowork API');
  }
}

/** Fetch a private file through the same bearer and organization boundary as JSON APIs. */
export async function fetchAuthenticatedBlob(url) {
  assertPrivateApiUrl(url);
  const response = await authFetch(url);
  if (!response.ok) throw fileRequestError(response);
  return response.blob();
}

/**
 * Download a private file without navigating the browser directly to an API
 * URL, because a native navigation cannot attach the expected-organization
 * header. Electron keeps using its main-process-authenticated URL flow.
 */
export async function downloadAuthenticatedResource(url, filename) {
  if (!url) return false;
  if (!host.isWeb) {
    await host.openExternal(url);
    return true;
  }
  downloadBlob(await fetchAuthenticatedBlob(url), filename);
  return true;
}

/**
 * Open a private web resource from a boundary-checked Blob. The blank popup is
 * created before the fetch awaits so browser click activation is not lost.
 * Active same-origin Blob document types download instead of executing.
 */
export async function openAuthenticatedResource(url, { filename } = {}) {
  if (!url) return false;
  if (!host.isWeb) {
    await host.openExternal(url);
    return true;
  }

  const popup = window.open('about:blank', '_blank');
  try {
    if (popup) popup.opener = null;
  } catch {}

  try {
    const blob = await fetchAuthenticatedBlob(url);
    if (!popup || !canOpenBlobInline(blob)) {
      popup?.close();
      downloadBlob(blob, filename);
      return true;
    }
    const objectUrl = URL.createObjectURL(blob);
    popup.location.href = objectUrl;
    revokeLater(objectUrl, REVOKE_OPENED_BLOB_AFTER_MS);
    return true;
  } catch (error) {
    popup?.close();
    throw error;
  }
}
