// Export a document artifact to PDF / Word / HTML and deliver the result.
//
// The server (`POST /artifacts/export`, see api.js `exportArtifact`) converts
// the artifact's source document — markdown or HTML — and writes the output
// next to the source in the same artifact folder, returning its
// `{ path, filename, serveUrl }`. Delivery then differs by host, mirroring
// `openArtifactFile` / `downloadArtifactFile`:
//
//   • Desktop (Electron pointed at the local loopback server) — the file lives
//     on this machine, so we open it in the OS default app via `openArtifact`.
//   • Web / remote server — the file isn't on the browser's machine, so we
//     trigger a browser save-as against the signed `serveUrl` (+ download=1).
//
// Only markdown/HTML sources can be exported (the server rejects anything
// else); `EXPORT_FORMATS` and `canExportArtifact` let the UI gate the action
// and per-format items off the artifact's source type without a round-trip.

import { host } from '../../platform/host';
import { exportArtifact, openArtifact } from '../api';
import { triggerServeDownload } from './artifactDownload';

// Targets the server can produce, in menu order. `label` is the human name;
// `id` is the format string the endpoint expects.
export const EXPORT_FORMATS = [
  { id: 'pdf', label: 'PDF' },
  { id: 'docx', label: 'Word' },
  { id: 'html', label: 'HTML' },
];

// Source extensions the server's exporter accepts (cowork.services
// .artifact_export._SOURCE_EXTS). Kept in sync so the menu only offers export
// for documents that will actually convert.
const EXPORTABLE_SOURCE_EXTS = new Set(['.md', '.markdown', '.html', '.htm', '.txt']);

/** Source path the server should convert — the artifact's primary file. */
export function exportSourcePath(artifact) {
  return artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
}

function extOf(artifact) {
  const declared = (artifact?.ext || '').toLowerCase();
  if (declared) return declared.startsWith('.') ? declared : `.${declared}`;
  // Fall back to the same source path the export uses, so the gate and the
  // actual conversion never disagree about the file's extension.
  const m = exportSourcePath(artifact).toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

/** True when the artifact's source document is convertible (md/html/txt). */
export function canExportArtifact(artifact) {
  if (!artifact || !exportSourcePath(artifact)) return false;
  return EXPORTABLE_SOURCE_EXTS.has(extOf(artifact));
}

/**
 * Is `format` worth offering for this artifact? We hide the no-op case of
 * exporting an HTML artifact back to HTML (it's already that file); every
 * other supported target is meaningful for an exportable source.
 */
export function canExportFormat(artifact, format) {
  if (!canExportArtifact(artifact)) return false;
  if (format === 'html') {
    const ext = extOf(artifact);
    return ext !== '.html' && ext !== '.htm';
  }
  return EXPORT_FORMATS.some((f) => f.id === format);
}

/**
 * Export `artifact` to `format` and deliver the result. Resolves with
 * `{ ok: true, filename }` on success; rejects with an Error whose message is
 * safe to surface in a toast on failure.
 */
export async function exportAndDeliver(artifact, format) {
  const source = exportSourcePath(artifact);
  if (!source) throw new Error('This artifact has no document to export.');

  const result = await exportArtifact(source, format);
  const filename = result?.filename || '';

  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  if (canOpenLocalFile && result?.path) {
    // Desktop: open the freshly written file in the OS default app.
    await openArtifact(result.path);
    return { ok: true, filename };
  }

  if (result?.serveUrl) {
    triggerServeDownload(result.serveUrl, filename);
    return { ok: true, filename };
  }

  // No way to hand the file back (web build without a serve URL).
  throw new Error('Export succeeded but the file could not be downloaded here.');
}
