// Client-side attachment guardrails. Mirrors the server's cap + allow-list
// (cowork/services/files.py) so the user gets an instant, human-readable
// rejection — "screenshot.png is 41 MB — max is 25 MB." — instead of
// uploading a doomed file and waiting for a 400. The server still enforces
// the same rules authoritatively; this is the fast, friendly first line.
//
// Pure functions, no React imports — unit-testable on its own and reused by
// the attach button, drag-drop, and paste paths so all three agree.

// 25 MiB — must match FileSettings.max_upload_bytes on the server.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Accept a file if EITHER its MIME or its extension is allowed: a pasted
// screenshot may arrive with an image/* type but no filename, while a
// drag-dropped .csv often arrives as a bare application/octet-stream.
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text & data
  'text/plain', 'text/markdown', 'text/csv', 'text/tab-separated-values',
  'application/json', 'application/xml', 'text/xml', 'application/yaml', 'text/yaml',
]);

const ALLOWED_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Text & data
  '.txt', '.md', '.markdown', '.csv', '.tsv',
  '.json', '.xml', '.yaml', '.yml', '.log',
]);

const ALLOWED_SUMMARY = 'images, PDFs, Office docs, and text/data files (txt, md, csv, json, …)';

// Compact, human-facing size like "41 MB" / "512 KB" — rounded, no trailing ".0".
export function humanizeBytes(num) {
  const step = 1024;
  let value = Number(num) || 0;
  const units = ['bytes', 'KB', 'MB', 'GB'];
  for (let i = 0; i < units.length; i += 1) {
    if (value < step || i === units.length - 1) {
      if (i === 0) return `${Math.round(value)} ${units[i]}`;
      return `${Number(value.toFixed(1))} ${units[i]}`;
    }
    value /= step;
  }
  return `${num} bytes`;
}

function extensionOf(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

// Returns null if the file is fine, or a user-facing rejection string.
export function rejectionFor(file) {
  if (!file) return null;
  const label = (file.name || '').trim() || 'this file';

  if (file.size > MAX_UPLOAD_BYTES) {
    return `${label} is ${humanizeBytes(file.size)} — max is ${humanizeBytes(MAX_UPLOAD_BYTES)}.`;
  }

  const mime = String(file.type || '').split(';', 1)[0].trim().toLowerCase();
  const ext = extensionOf(file.name);
  if (ALLOWED_MIME_TYPES.has(mime) || ALLOWED_EXTENSIONS.has(ext)) return null;

  const shown = ext || mime || 'unknown';
  return `${label} (${shown}) isn't a supported type. Allowed: ${ALLOWED_SUMMARY}.`;
}

// Split an incoming FileList/array into the files we'll keep and a single
// combined, human-readable error for any we won't. Caller queues `accepted`
// and surfaces `error` (if any) inline.
export function partitionFiles(files) {
  const incoming = Array.from(files || []);
  const accepted = [];
  const rejected = [];
  for (const file of incoming) {
    const reason = rejectionFor(file);
    if (reason) rejected.push(reason);
    else accepted.push(file);
  }
  let error = '';
  if (rejected.length === 1) {
    error = rejected[0];
  } else if (rejected.length > 1) {
    error = `${rejected.length} files were rejected: ${rejected.join(' ')}`;
  }
  return { accepted, error };
}
