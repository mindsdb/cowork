import { TEXT_PREVIEW_EXTS } from '../../lib/artifactKinds';

export { TEXT_PREVIEW_EXTS };

const EMBEDDED_URL_RE = /^(?:blob|data):/i;
const ABSOLUTE_PREVIEW_URL_RE = /^(?:https?:|blob:|data:|\/\/)/i;

/*
 * Match browser-internal fetch errors so the viewer can replace them with actionable connection
 * guidance.
 */
const TRANSPORT_FAILURE_RE = /^(?:failed to fetch|load failed|networkerror)/i;
const TRANSPORT_FAILURE_MESSAGE =
  'Could not reach the server to load this preview. Check the connection, then reload.';

/*
 * Normalize all preview failures: include HTTP status, replace browser-internal errors, and retain
 * application messages.
 */
export function draftPreviewErrorMessage(error, fallback = 'Could not load preview') {
  const status = error?.status;
  if (status === 401) return 'Your session expired — reload the page and try again.';
  if (status === 403) return 'You do not have access to this draft.';
  const message = String(error?.message || '');
  if (typeof status === 'number') {
    /* Preserve server details and add the status only if the message does not already name it. */
    if (message.includes(`(${status})`)) return message;
    return message ? `${message} (HTTP ${status})` : `Could not load this preview (HTTP ${status}).`;
  }
  /*
   * Check messages as well as TypeError so runtime-specific transport failures still receive
   * friendly copy.
   */
  if (error instanceof TypeError || TRANSPORT_FAILURE_RE.test(message)) {
    return TRANSPORT_FAILURE_MESSAGE;
  }
  return message || fallback;
}

export function isAbsoluteArtifactPreviewUrl(url) {
  return ABSOLUTE_PREVIEW_URL_RE.test(String(url || ''));
}

// authFetch adds the web bearer to any supplied URL: allow only our API origin.
// Never send it cross-origin; data/blob content needs no credentialed fetch.
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

// Version stable preview URLs so rebuilt artifacts cannot reuse the webview’s first response.
export function withArtifactVersion(url, version) {
  return appendPreviewParam(url, 'v', version);
}

// Must match ACTIVATION_PARAM in cowork-server comments_layer.py.
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

// Resolve fetched HTML assets against its directory, excluding filename/query/fragment, as direct
// iframe navigation would.
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

/*
 * A base tag changes link resolution but leaves document.URL as about:srcdoc. Fragment links would
 * therefore navigate without Authorization instead of scrolling. Delegate clicks to scroll
 * manually,
 * including dynamically added anchors. Known limitation: location.hash and CSS :target do not
 * update.
 */
export const DRAFT_FRAGMENT_GUARD_SCRIPT = `(function () {
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    event.preventDefault();
    if (href.length === 1) { window.scrollTo(0, 0); return; }
    var name = href.slice(1);
    try { name = decodeURIComponent(name); } catch (e) { /* malformed percent-encoding, use raw */ }
    var target = document.getElementById(name) || document.getElementsByName(name)[0];
    if (target && target.scrollIntoView) target.scrollIntoView();
  });
})();`;

// Give srcdoc the draft’s base directory for relative assets/links. Preserve an existing base tag
// because only the first takes effect.
export function injectDraftBaseHref(html, fetchUrl) {
  const baseHref = draftDirectoryUrl(fetchUrl);
  if (!baseHref || HAS_BASE_TAG_RE.test(html)) return html;
  // Escape closing script tags so future edits cannot prematurely terminate the injected guard
  // script.
  const guardScript = DRAFT_FRAGMENT_GUARD_SCRIPT.replace(/<\/script>/gi, '<\\/script>');
  const markup = `<base href="${escapeHtmlAttribute(baseHref)}"><script>${guardScript}</script>`;
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

// Cap rendered CSV rows to keep previews responsive; show a truncation count and full-file actions.
export const CSV_PREVIEW_ROW_LIMIT = 100;

// Stop after limit data rows, excluding the header. Keep BOM stripping, field-start quote handling,
// and bare-CR row endings consistent with countCsvRows so totals agree with the preview.
export function parseCsv(text, limit = Infinity) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Quotes open fields only at field start; treating a mid-value quote as opening could swallow the
  // remaining rows.
  let atFieldStart = true;
  const source = stripBom(text);
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (c === ',') {
      row.push(field); field = ''; atFieldStart = true;
    } else if (c === '\n' || c === '\r') {
      // \r\n, a bare \n, and a classic-Mac bare \r all end a row. Swallowing
      // \r on its own collapsed a CR-only file into one row.
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field); field = ''; atFieldStart = true;
      rows.push(row); row = [];
      // header + `limit` data rows. Stop scanning early on large files.
      if (rows.length > limit) break;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if ((field.length || row.length) && rows.length <= limit) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Strip the exporter’s UTF-8 BOM before it becomes part of the first header cell.
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Count all rows for the truncation notice; previewArtifact has already capped content at 200 KB.
export function countCsvRows(text) {
  if (!text) return 0;
  let n = 0;
  let inQuotes = false;
  // Same field-start and line-ending rules as `parseCsv` above.
  let atFieldStart = true;
  const source = stripBom(text);
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (inQuotes) {
      if (c === '"') {
        if (source[i + 1] === '"') i += 1;
        else inQuotes = false;
      }
    } else if (c === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (c === ',') {
      atFieldStart = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      n += 1;
      atFieldStart = true;
    } else {
      atFieldStart = false;
    }
  }
  // Trailing line without a final newline still counts.
  const last = source[source.length - 1];
  if (source.length && last !== '\n' && last !== '\r') n += 1;
  return n;
}

// Treat the first row as headers; escape pipes and collapse cell newlines so they cannot break GFM
// table syntax.
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
