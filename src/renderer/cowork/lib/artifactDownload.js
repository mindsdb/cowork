// Desktop serve URLs stream through an anchor; org draft URLs require an authenticated Blob fetch.
// A bare draft navigation lacks Authorization and saves a 401 page; large authenticated downloads
// buffer in memory.
// Only drafts honor ?download=1. Blob filenames come from downloadFilename; desktop's disabled
// webSecurity permits cross-origin anchor downloads.
// Return false when no URL exists or authenticated fetching fails; the caller supplies the error
// UI.

import { host } from '../../platform/host';
import { downloadFilename, downloadUrl } from './browserDownload';
import { downloadAuthenticatedResource } from './authenticatedResource';

function withDownloadParam(rel) {
  const base = rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`;
  return base + (base.includes('?') ? '&' : '?') + 'download=1';
}

/**
 * URL for presence checks only. Use downloadArtifactFile to download: draft URLs need
 * Authorization, which anchors omit.
 */
export function artifactDownloadUrl(artifact) {
  const rel = artifact?.serveUrl || artifact?.draftUrl || '';
  return rel ? withDownloadParam(rel) : '';
}

export async function downloadArtifactFile(artifact, { actionPath } = {}) {
  const rawPath = actionPath || artifact?.canonicalPath || artifact?.path || '';
  const filename = downloadFilename(rawPath, artifact?.title || 'artifact');
  const serveRel = artifact?.serveUrl || '';
  if (serveRel) return downloadUrl(withDownloadParam(serveRel), filename);
  const draftRel = artifact?.draftUrl || '';
  if (!draftRel) return false;
  try {
    return await downloadAuthenticatedResource(withDownloadParam(draftRel), filename);
  } catch {
    // 401/403/network: resolve false so every caller's existing "no
    // downloadable file" messaging fires instead of an unhandled rejection.
    return false;
  }
}
