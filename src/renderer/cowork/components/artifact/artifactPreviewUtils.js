import { TEXT_PREVIEW_EXTS } from '../../lib/artifactKinds';

export { TEXT_PREVIEW_EXTS };

const EMBEDDED_URL_RE = /^(?:blob|data):/i;
const ABSOLUTE_PREVIEW_URL_RE = /^(?:https?:|blob:|data:|\/\/)/i;

/** True when a preview URL already carries its own origin or payload. */
export function isAbsoluteArtifactPreviewUrl(url) {
  return ABSOLUTE_PREVIEW_URL_RE.test(String(url || ''));
}

// The old `src=` iframe navigation never attached credentials, no matter what
// origin it pointed at. `authFetch` attaches the web Keycloak bearer to
// whatever URL it is given, so routing a draft through it (instead of the
// direct navigation) is only safe when that URL is our own API: a data:/blob:
// URL makes no network request at all (nothing for the origin check to
// protect), and a genuinely different origin must never receive our token.
export function canFetchDraftWithCredentials(url, apiOrigin) {
  if (EMBEDDED_URL_RE.test(url)) return false;
  try {
    return new URL(url, apiOrigin).origin === new URL(apiOrigin).origin;
  } catch {
    return false;
  }
}

function appendPreviewParam(url, key, value) {
  if (!url || value == null || value === '') return url;
  // blob: and data: URLs are already content-addressed. Adding a query suffix
  // changes the blob lookup key or becomes part of the data payload.
  if (EMBEDDED_URL_RE.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}${key}=${encodeURIComponent(value)}`;
}

// Append a content-version cache-buster so the iframe re-fetches fresh
// content when the artifact is rebuilt in place. Without it the webview
// keeps serving the first-loaded response for a stable URL, so the panel
// shows the old version until it's closed and reopened (ENG-375). `version`
// is the artifact's `mtime` (max content-file mtime) from the server.
export function withArtifactVersion(url, version) {
  return appendPreviewParam(url, 'v', version);
}

// Opt the iframe's entry document into the server-injected comment marker
// layer (cowork-server comments_layer.py gates on this flag). Must match
// ACTIVATION_PARAM there.
export function withArtifactCommentFlag(url) {
  return appendPreviewParam(url, '__antonComments', '1');
}

const HAS_BASE_TAG_RE = /<base[\s/>]/i;
const HEAD_OPEN_RE = /<head([^>]*)>/i;

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// The draft's directory URL — `fetchUrl` minus its filename, query string and
// fragment — so relative asset/link references inside HTML fetched via
// `authFetch` resolve the same way they would if the iframe had navigated to
// `fetchUrl` directly through `src`.
function draftDirectoryUrl(fetchUrl) {
  try {
    const parsed = new URL(fetchUrl);
    parsed.search = '';
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/[^/]*$/, '');
    return parsed.toString();
  } catch {
    return '';
  }
}

// `srcdoc` gives the iframe no base URL of its own, so relative
// `<script src>` / `<link href>` / anchors in fetched draft HTML would
// otherwise resolve against the parent app's origin instead of the draft's
// own directory. No-op if the document already declares a `<base>` — a
// second one would be inert (the first `<base>` in document order wins) and
// misleading to read.
export function injectDraftBaseHref(html, fetchUrl) {
  const baseHref = draftDirectoryUrl(fetchUrl);
  if (!baseHref || HAS_BASE_TAG_RE.test(html)) return html;
  const markup = `<base href="${escapeHtmlAttribute(baseHref)}">`;
  return HEAD_OPEN_RE.test(html)
    ? html.replace(HEAD_OPEN_RE, `<head$1>${markup}`)
    : `${markup}${html}`;
}

export function artifactExtension(p) {
  if (!p || typeof p !== 'string') return '';
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

export function isTextArtifact(a) {
  if (!a) return false;
  const declared = (a.ext || '').toLowerCase();
  const ext = declared || artifactExtension(a.canonicalPath || a.file_path || a.path);
  return TEXT_PREVIEW_EXTS.has(ext);
}

// How many CSV rows we render inline. Past this we cut off the table
// and show a "showing N of M" notice with an Open/Download affordance.
// 100 keeps the markdown render fast and the modal scroll predictable
// even for large datasets.
export const CSV_PREVIEW_ROW_LIMIT = 100;

// Minimal CSV parser — handles quoted fields, escaped quotes ("") and
// commas inside quotes. Good enough for visualising agent-produced
// CSVs without pulling in a parser dependency. Bails out as soon as
// we have `limit` rows (counted *after* the header) so we never walk
// a million-row file just to throw the tail away.
export function parseCsv(text, limit = Infinity) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      // header + `limit` data rows. Stop scanning early on large files.
      if (rows.length > limit) break;
    } else if (c === '\r') {
      // swallow — handled with the next \n
    } else {
      field += c;
    }
  }
  if ((field.length || row.length) && rows.length <= limit) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Cheap full-file row count — we only need it to decide whether the
// "showing N of M" notice should appear and what M is. Counting bytes
// is fine since `previewArtifact` already capped the content at 200KB.
export function countCsvRows(text) {
  if (!text) return 0;
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { i += 1; }
      else inQuotes = !inQuotes;
    } else if (!inQuotes && c === '\n') {
      n += 1;
    }
  }
  // Trailing line without a final newline still counts.
  if (text.length && text[text.length - 1] !== '\n') n += 1;
  return n;
}

// Turn parsed CSV rows into a GFM pipe-table string so we can feed it
// straight to `MarkdownContent`. Pipes and newlines inside cells would
// break the table syntax — escape pipes, collapse line breaks to a
// space. The first row is always treated as the header.
export function csvRowsToGfmTable(rows) {
  if (!rows || rows.length === 0) return '';

  const escape = (cell) => String(cell ?? '')
    // Escape Markdown's escape character first. This must happen before
    // escaping pipes, otherwise the backslash we add for `|` would also
    // be doubled.
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');

  const header = rows[0].map(escape);
  const sep = header.map(() => '---');
  const body = rows.slice(1).map((r) => {
    const padded = r.length === header.length
      ? r
      : [...r, ...Array(Math.max(0, header.length - r.length)).fill('')];

    return padded.slice(0, header.length).map(escape);
  });

  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];

  return lines.join('\n');
}
