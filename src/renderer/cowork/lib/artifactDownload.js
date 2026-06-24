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

// Save-as for a file behind an artifact serve URL. Resolves the URL against
// the API origin (when origin-relative), appends `download=1` so the server
// sends `Content-Disposition: attachment`, and triggers a native `<a download>`
// click. Shared by downloadArtifactFile (raw primary file) and the artifact
// export flow (the converted PDF/Word/HTML), so both stay consistent.
export function triggerServeDownload(serveUrl, filename) {
  const base = serveUrl.startsWith('http') ? serveUrl : `${host.getApiOrigin()}${serveUrl}`;
  const url = base + (base.includes('?') ? '&' : '?') + 'download=1';
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'artifact';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadArtifactFile(artifact, { actionPath } = {}) {
  const rel = artifact?.serveUrl || '';
  if (!rel) return false;
  // Split on either `/` or `\` so Windows-style paths (which can show
  // up in `canonicalPath`/`path` when the app runs against a Windows
  // server) yield the basename instead of leaving the full path as the
  // suggested filename.
  const rawPath = actionPath || artifact?.canonicalPath || artifact?.path || '';
  const filename =
    rawPath.split(/[\\/]/).filter(Boolean).pop()
    || artifact?.title
    || 'artifact';
  triggerServeDownload(rel, filename);
  return true;
}
