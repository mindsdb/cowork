import { host } from '../../platform/host';
import { authFetch } from '../api';
import { downloadBlob } from './browserDownload';

const REVOKE_OPENED_BLOB_AFTER_MS = 60_000;

/* Carries `status`, as the API helpers' errors do, so a caller can tell a
   missing file (404) from other failures. */
function fileRequestError(response) {
  const status = Number(response?.status) || 0;
  return Object.assign(new Error(status ? `Could not load file (${status})` : 'Could not load file'), { status });
}

function revokeLater(objectUrl, delay) {
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), delay);
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

/**
 * Fetch a private file through the same bearer and organization boundary as
 * JSON APIs, and hand back the response with its body unread, so a caller can
 * read its headers (its Content-Length) before it downloads the body. An
 * aborted `signal` rejects it, during the wait for an access token too
 * (authFetch passes it on to both).
 */
export async function fetchAuthenticatedResponse(url, { signal } = {}) {
  assertPrivateApiUrl(url);
  const response = await authFetch(url, { signal });
  if (!response.ok) throw fileRequestError(response);
  return response;
}

/** Fetch a private file through the same bearer and organization boundary as JSON APIs. */
export async function fetchAuthenticatedBlob(url) {
  return (await fetchAuthenticatedResponse(url)).blob();
}

/**
 * Download a private file without navigating the browser directly to an API
 * URL, because a native navigation cannot attach the expected-organization
 * header. Desktop saves the same way: the main process's onBeforeSendHeaders
 * listener (src/main/app.ts) adds the local server's token to the renderer's
 * fetch, while a URL handed to the OS browser carries none and gets a 401.
 *
 * Resolves true once a 2xx body is saved. Any other answer rejects with the
 * error `fetchAuthenticatedResponse` raises, which carries the HTTP status.
 */
export async function downloadAuthenticatedResource(url, filename) {
  if (!url) return false;
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
