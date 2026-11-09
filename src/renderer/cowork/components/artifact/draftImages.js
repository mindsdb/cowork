import { useMemo } from 'react';
import { host } from '../../../platform/host';
import { fetchAuthenticatedBlob } from '../../lib/authenticatedResource';
import { withArtifactVersion } from './artifactPreviewUtils';

/*
 * A Markdown artifact names its pictures by path, as `![chart](chart.png)`,
 * and the viewer has to fetch them itself. The desktop shell's CSP
 * (`img-src 'self' data: blob:`, `index.html`) refuses an image from the
 * loopback server, and on an org deployment nothing attaches the bearer to a
 * plain <img> request, so the drafts route answers it with 401. Each image is
 * fetched the way the document's text was, through `fetchAuthenticatedBlob`,
 * and shown from a blob: URL (MarkdownImage).
 *
 * `fetchAuthenticatedBlob` checks the API origin only on web
 * (`assertPrivateApiUrl`); on desktop it sends whatever URL it is given, and
 * the main process adds the local server's token to every request for that
 * server (`onBeforeSendHeaders` in `src/main/app.ts`). So the folder check
 * below is the only thing between a path the agent wrote and a credentialed
 * request, on every host.
 */

// The draft URL cowork-server builds for a card (`services/artifacts.py`):
// /api/v1/artifacts/drafts/<project>/<artifact>/<path inside the folder>.
const DRAFT_FOLDER_RE = /^\/api\/v1\/artifacts\/drafts\/[^/]+\/[^/]+\//;

/*
 * One path segment below the artifact's folder. The URL parser already
 * removes `.` and `..` segments, `%2e%2e` included; what is left to refuse is
 * a segment that decodes into one (`..%2f`), or into a separator the server
 * decodes before it checks the path.
 */
function isPlainSegment(segment) {
  let name;
  try {
    name = decodeURIComponent(segment);
  } catch {
    return false;
  }
  return !!name && name !== '.' && name !== '..' && !/[\\/]/.test(name);
}

/**
 * The URL an image `src` in a draft Markdown document loads from, or null
 * when it may not load at all: it must stay on the API origin, inside the
 * artifact's own folder, and name a file other than the document itself.
 *
 * @param {string} src the image's `src` as the Markdown wrote it
 * @param {string} draftUrl the document's own draft URL (`artifact.draftUrl`)
 * @param {string} apiOrigin `host.getApiOrigin()`
 * @returns {string | null}
 */
export function resolveDraftImageUrl(src, draftUrl, apiOrigin) {
  if (!src || !src.trim() || !draftUrl) return null;
  let api;
  let documentUrl;
  let target;
  try {
    api = new URL(apiOrigin);
    documentUrl = new URL(draftUrl, api);
    target = new URL(src, documentUrl);
  } catch {
    return null;
  }
  const folder = documentUrl.pathname.match(DRAFT_FOLDER_RE)?.[0];
  if (
    !folder
    || documentUrl.origin !== api.origin
    || target.origin !== api.origin
    || !target.pathname.startsWith(folder)
    || target.pathname === documentUrl.pathname
    || !target.pathname.slice(folder.length).split('/').every(isPlainSegment)
  ) {
    return null;
  }
  target.hash = '';
  return target.toString();
}

function requireImage(blob) {
  if (!String(blob?.type || '').toLowerCase().startsWith('image/')) {
    throw new Error('Not an image');
  }
  return blob;
}

/**
 * Loads the images a draft Markdown document names, for MarkdownContent's
 * `loadImage`. Each file is asked for once per `version` (the viewer's
 * `<mtime>.<reload count>`), a failure included, so the Edit tab's preview
 * doesn't re-request every image as the text above it changes, while a
 * change to the artifact or a Reload asks again. The cache holds Blobs, not
 * blob: URLs: each image makes and revokes its own, so nothing here outlives
 * it.
 *
 * @param {string} draftUrl the document's own draft URL (`artifact.draftUrl`)
 * @param {string | number | null | undefined} version
 * @returns {(src: string) => Promise<Blob> | null}
 */
export function useDraftImageLoader(draftUrl, version) {
  return useMemo(() => {
    /** @type {Map<string, Promise<Blob>>} */
    const requests = new Map();
    return (src) => {
      const url = resolveDraftImageUrl(src, draftUrl, host.getApiOrigin());
      if (!url) return null;
      if (!requests.has(url)) {
        requests.set(url, fetchAuthenticatedBlob(withArtifactVersion(url, version)).then(requireImage));
      }
      return requests.get(url);
    };
  }, [draftUrl, version]);
}
