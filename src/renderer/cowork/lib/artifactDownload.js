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
// Web tries `draftUrl` first, because only the fetch sees the HTTP status: a
// true result there means the server answered 2xx, which is what lets a caller
// say "downloaded" afterwards. The serve-URL anchor runs on web only for a card
// with no draft URL, and it resolves true once the anchor is clicked, since a
// navigation never reports its status. Desktop keeps the streaming anchor on
// `serveUrl` and uses the authenticated Blob path only without one.
//
// `?download=1` is appended to both, but only the drafts route honours it
// (Content-Disposition: attachment) — and only a direct HTTP client such as
// `curl -OJ` ever reads that header: this module's Blob transport names the
// file from `downloadFilename` client-side, and `response.blob()` discards
// headers. The serve route ignores the param entirely; desktop's anchor save
// works regardless because the Electron shell disables webSecurity, which
// lets the cross-origin `download` attribute apply. Resolves false — with no
// side effects beyond a failed fetch — when the artifact has neither URL or
// the authenticated fetch fails or answers outside 2xx; caller surfaces a
// friendly message.

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
  const draftRel = artifact?.draftUrl || '';
  // Web takes the draft URL first and desktop the serve URL; see the header.
  if (serveRel && !(host.isWeb && draftRel)) return downloadUrl(withDownloadParam(serveRel), filename);
  if (!draftRel) return false;
  try {
    return await downloadAuthenticatedResource(withDownloadParam(draftRel), filename);
  } catch {
    // 401/403/network: resolve false so every caller's existing "no
    // downloadable file" messaging fires instead of an unhandled rejection.
    return false;
  }
}
