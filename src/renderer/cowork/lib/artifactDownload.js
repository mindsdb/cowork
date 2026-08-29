// Trigger a browser save-as dialog for an artifact file.
//
// Hits the FastAPI sidecar's `/v1/artifacts/serve/...` endpoint with
// `?download=1`, which adds `Content-Disposition: attachment` so the
// browser saves the file instead of rendering it inline. Type-agnostic
// — works for HTML / JSON / CSV / PNG / PDF / binary / anything an
// artifact can be. The native `<a download>` flow streams; no Blob in
// memory, no size cap (unlike `previewArtifact` + Blob, which is
// ~200KB).
//
// Returns `false` (with no side effects) when the artifact lacks a
// `serveUrl` — caller should surface a friendly message.

import { host } from '../../platform/host';
import { downloadFilename, downloadUrl } from './browserDownload';

export function downloadArtifactFile(artifact, { actionPath } = {}) {
  const rel = artifact?.serveUrl || '';
  if (!rel) return false;
  const base = rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`;
  const url = base + (base.includes('?') ? '&' : '?') + 'download=1';
  const rawPath = actionPath || artifact?.canonicalPath || artifact?.path || '';
  return downloadUrl(url, downloadFilename(rawPath, artifact?.title || 'artifact'));
}
