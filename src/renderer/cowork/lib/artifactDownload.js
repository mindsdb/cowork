// Trigger a browser save-as dialog for an artifact file.
//
// Two URLs can carry the bytes, and they need DIFFERENT transports:
//
//   - `serveUrl` — the sidecar's stateless `/v1/artifacts/serve/...`. Desktop
//     and the local web build have it, and a plain anchor navigation works:
//     the native `<a download>` flow streams, no Blob in memory, no size cap.
//   - `draftUrl` — the authenticated `/api/v1/artifacts/drafts/...` route, set
//     on every card with a primary file. On an org deployment it is the ONLY
//     route to the bytes (ENG-2044) — and it cannot be a navigation: the
//     browser attaches no Authorization header to one, so a bare anchor saves
//     nginx's 401 page under the artifact's filename. It goes through
//     `downloadAuthenticatedResource`, which fetches with the same bearer +
//     organization boundary as JSON APIs and saves the Blob. The tradeoff is
//     buffering: a very large .zip/.xlsm is held in memory before the save.
//
// Both accept `?download=1` (Content-Disposition: attachment). Resolves false
// — with no side effects beyond a failed fetch — when the artifact has neither
// URL or the authenticated fetch fails; caller surfaces a friendly message.

import { host } from '../../platform/host';
import { downloadFilename, downloadUrl } from './browserDownload';
import { downloadAuthenticatedResource } from './authenticatedResource';

function withDownloadParam(rel) {
  const base = rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`;
  return base + (base.includes('?') ? '&' : '?') + 'download=1';
}

/**
 * The absolute URL that saves this artifact's primary file, or '' when there
 * is none. Exposed for presence checks; `downloadArtifactFile` decides the
 * transport, so do not feed this to an anchor yourself — for a draft URL that
 * navigation is exactly the 401 this module exists to avoid.
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
