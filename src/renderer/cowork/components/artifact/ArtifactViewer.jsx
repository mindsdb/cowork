// Inline preview modal for HTML artifacts. Renders the artifact's
// content in a sandboxed iframe (via srcdoc so we don't need to
// expose a file:// URL). Top bar has the title, a "Published" pill
// when the artifact has a live URL, plus Publish / Unpublish / Open
// in OS actions.

import { useEffect, useMemo, useState } from 'react';
import Ico from '../Icons';
import {
  mountArtifactPreview,
  previewArtifact,
  publishArtifact,
  unpublishArtifact,
  publishTargetPath,
  deleteArtifact,
} from '../../api';
import { copyText } from '../../lib/clipboard';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { isPublishableArtifact } from '../../lib/artifactKinds';
import { trackArtifactPublished } from '../../lib/analytics';
import { Modal } from '../ui/Modal';
import { Menu } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';
import { MarkdownContent } from '../markdown/MarkdownContent';

// Extensions we render inline with the lightweight text preview path
// (server `/v1/artifacts/preview` → text body). `.md` gets the full
// markdown renderer; `.csv` gets a parsed table; `.txt` and friends
// fall back to a monospace block.
const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);

function _extOfPath(p) {
  if (!p || typeof p !== 'string') return '';
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

function _isTextArtifact(a) {
  if (!a) return false;
  const declared = (a.ext || '').toLowerCase();
  const ext = declared || _extOfPath(a.canonicalPath || a.file_path || a.path);
  return TEXT_PREVIEW_EXTS.has(ext);
}

// How many CSV rows we render inline. Past this we cut off the table
// and show a "showing N of M" notice with an Open/Download affordance.
// 100 keeps the markdown render fast and the modal scroll predictable
// even for large datasets.
const CSV_PREVIEW_ROW_LIMIT = 100;

// Minimal CSV parser — handles quoted fields, escaped quotes ("") and
// commas inside quotes. Good enough for visualising agent-produced
// CSVs without pulling in a parser dependency. Bails out as soon as
// we have `limit` rows (counted *after* the header) so we never walk
// a million-row file just to throw the tail away.
function _parseCsv(text, limit = Infinity) {
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
function _countCsvRows(text) {
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
function _csvRowsToGfmTable(rows) {
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

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "'Josefin Sans', sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Single-row "label: value [copy]" — used twice in the header (local
// path + remote URL when published). Tiny inline copy state flips the
// glyph to a check for ~1.4s after a successful copy.
function PathRow({ label, value, copyValue, accent = false, onActivate }) {
  const [copyState, setCopyState] = useState('');
  if (!value) return null;
  const valueToCopy = copyValue || value;
  const onCopy = async (e) => {
    e.stopPropagation();
    // Use the shared helper so the execCommand fallback kicks in when
    // `navigator.clipboard.writeText` is unavailable / blocked. Only
    // flip the icon to "copied" if the copy actually succeeded —
    // otherwise the check was misleading users into thinking it worked.
    const ok = await copyText(valueToCopy);
    if (ok) {
      setCopyState('copied');
      setTimeout(() => setCopyState(''), 1400);
    } else {
      setCopyState('failed');
      setTimeout(() => setCopyState(''), 1800);
    }
  };
  const copied = copyState === 'copied';
  const failed = copyState === 'failed';
  const activatable = typeof onActivate === 'function';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
      fontFamily: FONT_MONO, fontSize: 10.5,
    }}>
      <span style={{
        flexShrink: 0,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}>{label}:</span>
      {/* When `onActivate` is set the value is an interactive element
          (link semantics). Hover gets an accent underline so it reads
          as clickable; click stops propagation so the row's copy
          button can sit beside it without being triggered. */}
      {activatable ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onActivate(); }}
          title={`Open ${value}`}
          style={{
            all: 'unset', cursor: 'pointer',
            // `all: unset` resets display to inline, where text-overflow
            // ellipsis is a no-op — force a block box so a long URL
            // truncates instead of overflowing the row.
            display: 'block',
            minWidth: 0, flex: 1,
            color: accent ? 'var(--accent)' : 'var(--ink-3)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            transition: 'color 120ms ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.color = 'var(--accent)';
            e.currentTarget.style.textDecoration = 'underline';
            e.currentTarget.style.textUnderlineOffset = '2px';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.color = accent ? 'var(--accent)' : 'var(--ink-3)';
            e.currentTarget.style.textDecoration = 'none';
          }}
        >{value}</button>
      ) : (
        <span title={value} style={{
          display: 'block',
          minWidth: 0, flex: 1,
          color: accent ? 'var(--accent)' : 'var(--ink-3)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied' : failed ? 'Copy failed' : `Copy ${label}`}
        aria-label={copied ? 'Copied' : failed ? 'Copy failed' : `Copy ${label}`}
        style={{
          flexShrink: 0,
          width: 20, height: 20, borderRadius: 4,
          background: 'transparent', border: 0,
          cursor: 'pointer',
          color: copied ? 'var(--accent)' : failed ? 'var(--danger)' : 'var(--ink-4)',
          display: 'inline-grid', placeItems: 'center',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = copied
            ? 'var(--accent)'
            : failed ? 'var(--danger)' : 'var(--ink-2)';
          e.currentTarget.style.background = 'var(--surface-2)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = copied ? 'var(--accent)' : failed ? 'var(--danger)' : 'var(--ink-4)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {copied ? Ico.check(11) : Ico.copy(11)}
      </button>
    </div>
  );
}

// Masked access-password row for a password-protected artifact. The
// plaintext is owner-only (it comes from `.published.json`, never the
// published bundle); the eye reveals it and the copy button copies it.
function AccessPasswordRow({ password }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!password) return null;
  const masked = '•'.repeat(Math.min(Math.max(password.length, 8), 12));
  const onCopy = async (e) => {
    e.stopPropagation();
    const ok = await copyText(password);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1400); }
  };
  const iconBtn = {
    flexShrink: 0, background: 'transparent', border: 0, cursor: 'pointer',
    display: 'inline-grid', placeItems: 'center', width: 20, height: 20, borderRadius: 4,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, fontFamily: FONT_MONO, fontSize: 10.5 }}>
      <span style={{ flexShrink: 0, color: 'var(--ink-4)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>password:</span>
      <span style={{
        minWidth: 0, flex: '0 1 auto', color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{show ? password : masked}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); setShow((v) => !v); }}
        title={show ? 'Hide password' : 'Show password'}
        style={{ ...iconBtn, color: 'var(--ink-4)' }}>
        {show ? Ico.eyeOff(11) : Ico.eye(11)}
      </button>
      <button type="button" onClick={onCopy} title={copied ? 'Copied' : 'Copy password'}
        style={{ ...iconBtn, color: copied ? 'var(--accent)' : 'var(--ink-4)' }}>
        {copied ? Ico.check(11) : Ico.copy(11)}
      </button>
    </div>
  );
}

const BACKEND_ARTIFACT_TYPES = new Set(['fullstack-stateless-app', 'fullstack-stateful-app']);

export function ArtifactViewer({ open, artifact, onClose, onChange, onDelete, onPublish: onRequestPublish }) {
  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const displayPath = artifact?.displayPath || actionPath;
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  // Backend artifacts treat the folder, not the entry html, as the
  // "thing" the user opens in their OS or browser.
  const artifactFolder = actionPath.replace(/[\\/][^\\/]*$/, '') || actionPath;
  const folderDisplayPath = displayPath.replace(/[\\/][^\\/]*$/, '') || displayPath;
  // Mounted preview URL — iframe loads this with `src=` so relative
  // `<script>` / `<link>` refs in the HTML resolve against a real URL.
  // (srcdoc has no base URL → relative refs 404.)
  const [previewUrl, setPreviewUrl] = useState('');
  // Text preview state for .md/.txt/.csv — populated via
  // `/v1/artifacts/preview`. Holds `{ content, truncated, mime }` from
  // the server so we can render markdown, csv tables, or plain text
  // inline (no iframe, no OS handoff).
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [publishedUrl, setPublishedUrl] = useState(artifact?.publishedUrl || '');
  const [backendPort, setBackendPort] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const isText = _isTextArtifact(artifact);
  const textExt = isText
    ? ((artifact?.ext || '').toLowerCase()
      || _extOfPath(actionPath))
    : '';

  // Refresh state when the artifact changes (e.g. user opens a
  // different one without closing first).
  useEffect(() => {
    setPublishedUrl(artifact?.publishedUrl || '');
  }, [artifact?.path, artifact?.publishedUrl]);

  // Esc-to-close + portal + body-scroll lock all live in <Modal>.

  // Mount the artifact when opened.
  //   - Text (.md/.txt/.csv): skip the iframe entirely and fetch the
  //     body via `/v1/artifacts/preview` so we can render it inline.
  //   - Static (HTML-only): server registers the parent dir under a
  //     token and returns a URL that serves the entry HTML; sibling
  //     assets resolve naturally because they share the URL prefix.
  //   - Proxy (backend+frontend): main hosts a loopback HTTP forwarder
  //     pointed at the artifact's backend port (read lazily from
  //     metadata.json on every request, so a restarted backend on a
  //     new port keeps working).
  useEffect(() => {
    if (!open || !artifact) return;
    if (!hasActionPath) {
      setPreviewUrl('');
      setTextPreview(null);
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setLoading(true);
    setErr('');
    setPreviewUrl('');
    setBackendPort(null);
    setTextPreview(null);
    let cancelled = false;
    if (isText) {
      previewArtifact(actionPath)
        .then((data) => {
          if (cancelled) return;
          if (!data || typeof data.content !== 'string') {
            throw new Error('Preview returned no content');
          }
          setTextPreview({
            content: data.content,
            truncated: !!data.truncated,
            mime: data.mime || '',
          });
        })
        .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load preview'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    mountArtifactPreview(actionPath)
      .then(async ({ kind, url, artifactDir, port, proxyUrl, publishedUrl: serverPublishedUrl, backendRunning, launchError }) => {
        if (kind === 'proxy') {
          if (!artifactDir) throw new Error('Preview mount returned no artifact dir');
          if (backendRunning === false) {
            throw new Error(launchError || 'Backend failed to start');
          }
          if (!proxyUrl) throw new Error('Preview proxy unavailable');
          let iframeUrl = proxyUrl;
          try {
            const u = new URL(proxyUrl);
            if (window.location?.protocol) u.protocol = window.location.protocol;
            if (window.location?.hostname) u.hostname = window.location.hostname;
            iframeUrl = u.toString();
          } catch { /* fall through with the raw URL */ }
          if (cancelled) return;
          setPreviewUrl(iframeUrl);
          if (typeof port === 'number') setBackendPort(port);
          // Fullstack apps publish from their root; the mount endpoint
          // reports the published URL from `.published.json` so the
          // "Published" pill / `public url` row persist across reopens
          // (the artifact object from a chat bubble may not carry it).
          if (serverPublishedUrl) setPublishedUrl(serverPublishedUrl);
          return;
        }
        if (!url) throw new Error('Preview mount returned no URL');
        if (cancelled) return;
        setPreviewUrl(url);
        // The mount endpoint now also reports the artifact's published
        // URL from `.published.json`. Adopt it whenever the server
        // knows of one — covers the chat-bubble / project-rail entry
        // points where the artifact object was built from a streamed
        // payload and didn't carry `publishedUrl`. Don't blank out a
        // locally-known value when the server returns "" (the user
        // may have just published; we don't want a flicker).
        if (serverPublishedUrl) setPublishedUrl(serverPublishedUrl);
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load artifact'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, artifact?.path, actionPath, hasActionPath, disabledReason, isText]);

  // Parse CSV → GFM pipe table once per loaded text. We cap at
  // CSV_PREVIEW_ROW_LIMIT data rows to keep the markdown renderer
  // snappy on large files; the total row count is computed separately
  // so we can show a "showing N of M" notice.
  const csvPreview = useMemo(() => {
    if (!isText || textExt !== '.csv' || !textPreview?.content) return null;
    const rows = _parseCsv(textPreview.content, CSV_PREVIEW_ROW_LIMIT);
    if (rows.length === 0) return null;
    const totalRows = Math.max(0, _countCsvRows(textPreview.content) - 1);
    const shownRows = Math.max(0, rows.length - 1);
    return {
      markdown: _csvRowsToGfmTable(rows),
      totalRows,
      shownRows,
      truncated: shownRows < totalRows,
    };
  }, [isText, textExt, textPreview?.content]);

  if (!open || !artifact) return null;

  const onPublish = async () => {
    if (busy) return;
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    // Prefer the parent's visibility chooser (public vs password). Fall
    // back to a direct public publish when no chooser is wired.
    if (onRequestPublish) {
      setBusy(true);
      try {
        await onRequestPublish(artifact);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const r = await publishArtifact(publishTargetPath(artifact));
      if (r?.url) {
        setPublishedUrl(r.url);
        trackArtifactPublished(r.report_id || artifact?.id || '', 'public');
        onChange?.({ ...artifact, publishedUrl: r.url });
      }
    } catch (e) {
      setErr(e?.message || 'Publish failed');
    } finally {
      setBusy(false);
    }
  };
  const onUnpublish = async () => {
    if (busy) return;
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setBusy(true);
    try {
      await unpublishArtifact(publishTargetPath(artifact));
      setPublishedUrl('');
      onChange?.({ ...artifact, publishedUrl: '' });
    } catch (e) {
      setErr(e?.message || 'Unpublish failed');
    } finally {
      setBusy(false);
    }
  };
  // Open the local file only when the file is actually on this machine
  // (Electron + loopback server). When the desktop app points at a
  // REMOTE server, or in web, the path is on the server box — open the
  // HTTP `serveUrl` instead (made absolute via the API origin since an
  // Electron renderer runs from file://, where a relative URL wouldn't
  // resolve against the remote server).
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  // When we can't open a local file (web, or a desktop app pointed at a
  // remote server) the artifact's address is its HTTP serve URL, not an
  // OS path the user can't reach — show that "private" URL in the header
  // instead of the local path.
  const serveRel = artifact?.serveUrl || '';
  const privateUrl = (!canOpenLocalFile && serveRel)
    ? (serveRel.startsWith('http') ? serveRel : `${host.getApiOrigin()}${serveRel}`)
    : '';
  const onOpenOS = async () => {
    if (isBackendArtifact && canOpenLocalFile) {
      if (!backendPort) {
        setErr('Backend port not available yet — preview is still loading.');
        return;
      }
      try {
        await host.openExternal(`http://127.0.0.1:${backendPort}`);
      } catch (e) {
        setErr(e?.message || 'Open failed');
      }
      return;
    }
    if (!canOpenLocalFile) {
      const rel = artifact?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (publishedUrl || '');
      if (url) {
        try { await host.openExternal(url); }
        catch { window.open(url, '_blank', 'noreferrer'); }
        return;
      }
      setErr('This artifact is served from a remote server and has no open URL yet.');
      return;
    }
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    try {
      const result = await host.openPath(actionPath);
      if (result && result.ok === false) throw new Error(result.reason || 'Could not open artifact.');
    } catch (e) {
      setErr(e?.message || 'Open failed');
    }
  };
  // Universal "save to disk" — type-agnostic stream through the
  // sidecar's serve endpoint with Content-Disposition: attachment.
  // Used both by the header action-row Download button and by the
  // "Download full file" affordance under truncated text/CSV previews
  // in the web shell (the previous `onDownloadText` was a 200KB-
  // capped Blob fallback; this streams the real file).
  const onDownload = () => {
    if (!downloadArtifactFile(artifact, { actionPath })) {
      setErr(disabledReason || 'This artifact has no serve URL yet.');
    }
  };
  const onTrash = () => {
    if (busy) return;
    if (!hasActionPath) {
      setErr(disabledReason || 'This artifact does not have a local file path.');
      return;
    }
    setConfirmDelete(true);
  };
  const onConfirmDelete = async () => {
    // Deletion is centralized through cowork-server (not shell.trashItem)
    // so the server's unpublish-before-delete guard always runs. The whole
    // artifact folder is removed (not just the primary file) so metadata.json
    // goes too and the artifact disappears from the listing. The viewer
    // closes once the file is gone so we don't leave a dead preview on screen.
    setDeleteBusy(true);
    setErr('');
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // The server enforces the same rule as a backstop.
      if (publishedUrl) {
        await unpublishArtifact(actionPath);
      }
      await deleteArtifact(artifact?.folder || actionPath);
      setConfirmDelete(false);
      onDelete?.(actionPath);
      onClose?.();
    } catch (e) {
      setDeleteBusy(false);
      setConfirmDelete(false);
      setErr(e?.message || 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };
  const onOpenPublished = async () => {
    if (!publishedUrl) return;
    try { await host.openExternal(publishedUrl); } catch {
      window.open(publishedUrl, '_blank', 'noreferrer');
    }
  };
  // Local-path activate: hand off to the OS handler. For HTML
  // artifacts this opens the default browser; for everything else
  // (md, pdf, etc.) it routes to the user's default app.
  const onOpenLocal = async () => {
    const target = isBackendArtifact ? artifactFolder : actionPath;
    if (!target) return;
    try {
      const result = await host.openPath(target);
      if (result && result.ok === false) {
        setErr(result.reason || 'Could not open file.');
      }
    } catch (e) {
      setErr(e?.message || 'Could not open file.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      width="min(1080px, 94vw)"
      height="min(820px, 88vh)"
      labelledBy="artifact-viewer-title"
    >
      {/* Header */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--accent)', flexShrink: 0 }}>
          {Ico.doc(18)}
        </span>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <div id="artifact-viewer-title" style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15,
              color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, flex: '0 1 auto',
            }}>
              {artifact.title || artifact.path?.split('/').pop()}
            </div>
            {/* Type pill — small mono tag next to the title, drawn
                  in the same style as the kind tags on collection
                  cards. Only shown when the artifact carries a
                  metadata-declared `type` (legacy artifacts skip). */}
            {artifact.type && (
              <span
                title={`Artifact type: ${artifact.type}`}
                style={{
                  fontFamily: FONT_MONO, fontSize: 10,
                  color: 'var(--ink-4)', letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--line)',
                  padding: '2px 7px', borderRadius: 999,
                  flexShrink: 0,
                }}
              >{artifact.type}</span>
            )}
            {typeof artifact.fileCount === 'number' && artifact.fileCount > 1 && (
              <span style={{
                fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
                flexShrink: 0,
              }}>· {artifact.fileCount} files</span>
            )}
          </div>
          {/* Description — agent-supplied at create_artifact, single
                line truncated. Adds context the title alone can't. */}
          {artifact.description && (
            <div
              title={artifact.description}
              style={{
                fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-3)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                marginTop: 2, marginBottom: 2,
              }}
            >{artifact.description}</div>
          )}
          {privateUrl ? (
            <PathRow
              label="private url"
              value={privateUrl}
              onActivate={onOpenOS}
            />
          ) : (
            <PathRow
              label="local"
              value={isBackendArtifact ? folderDisplayPath : displayPath}
              copyValue={isBackendArtifact ? artifactFolder : actionPath}
              onActivate={hasActionPath ? onOpenLocal : undefined}
            />
          )}
          {publishedUrl && (
            <PathRow
              label="public url"
              value={publishedUrl}
              accent
              onActivate={onOpenPublished}
            />
          )}
          {publishedUrl && artifact?.accessProtected && (
            <AccessPasswordRow password={artifact?.accessPassword || ''} />
          )}
        </div>
          <Menu
            ariaLabel="Artifact actions"
            align="end"
            width={200}
            trigger={
              <button
                type="button"
                aria-label="More actions"
                title="More actions"
                style={{
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1px solid var(--line)',
                  color: 'var(--ink-2)',
                  width: 32, height: 30, borderRadius: 8,
                  display: 'inline-grid', placeItems: 'center',
                  transition: 'background .12s ease, color .12s ease',
                }}
                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-2)'; }}
              >
                {Ico.moreVert(15)}
              </button>
            }
            items={[
              ...(host.isWeb ? [] : [{
                label: 'Open in OS',
                icon: Ico.externalLink(13),
                disabled: !hasActionPath || (isBackendArtifact && !backendPort),
                title: isBackendArtifact && !backendPort ? 'Waiting for backend port…' : undefined,
                onClick: onOpenOS,
              }]),
              ...(artifact?.serveUrl ? [{
                label: 'Download',
                icon: Ico.download(13),
                onClick: onDownload,
              }] : []),
              {
                label: publishedUrl ? 'Unpublish' : 'Publish',
                icon: Ico.upload(13),
                disabled: busy || !hasActionPath,
                onClick: publishedUrl ? onUnpublish : onPublish,
              },
              { divider: true },
              {
                label: 'Delete',
                icon: Ico.trash(13),
                danger: true,
                disabled: busy || !hasActionPath,
                onClick: onTrash,
              },
            ]}
          />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              cursor: 'pointer',
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              width: 28, height: 28, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1,
            }}
          >×</button>
      </div>

        {/* Body — branches by artifact type:
            • text (.md/.txt/.csv) → inline render via MarkdownContent,
              a parsed CSV table, or a monospace block.
            • everything else      → sandboxed iframe served by the
              preview-mount endpoint. */}
      <div style={{ flex: 1, minHeight: 0, background: 'var(--surface-2)', overflow: isText ? 'auto' : 'hidden' }}>
        {err ? (
          <div style={{ padding: 28, color: 'var(--danger)', fontSize: 13 }}>{err}</div>
        ) : loading ? (
          <div style={{ padding: 28, color: 'var(--ink-3)', fontSize: 13 }}>Loading preview…</div>
        ) : isText && textPreview ? (
          <div style={{
            maxWidth: 920, margin: '0 auto', padding: '24px 28px',
            background: 'var(--surface)',
            minHeight: '100%',
          }}>
            {textExt === '.md' ? (
              <MarkdownContent text={textPreview.content} id={artifact.path} />
            ) : textExt === '.csv' && csvPreview ? (
              <MarkdownContent text={csvPreview.markdown} id={artifact.path} />
            ) : (
              <pre style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: FONT_MONO, fontSize: 12.5,
                color: 'var(--ink-2)',
                lineHeight: 1.55,
              }}>{textPreview.content}</pre>
            )}
            {(textPreview.truncated || (csvPreview && csvPreview.truncated)) && (
              <div style={{
                marginTop: 18, padding: '10px 14px',
                borderRadius: 8,
                background: 'var(--surface-2)',
                border: '1px solid var(--line)',
                color: 'var(--ink-3)', fontSize: 12.5,
                fontFamily: FONT_BODY,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, flexWrap: 'wrap',
              }}>
                <span>
                  {csvPreview && csvPreview.truncated
                    ? `Showing first ${csvPreview.shownRows.toLocaleString()} of ${csvPreview.totalRows.toLocaleString()} rows.`
                    : 'Preview is truncated.'}
                </span>
                <button
                  type="button"
                  onClick={host.isWeb ? onDownload : onOpenOS}
                  style={{
                    cursor: 'pointer',
                    background: 'transparent',
                    border: '1px solid var(--line)',
                    color: 'var(--accent)',
                    padding: '5px 11px', borderRadius: 6,
                    fontSize: 12, fontWeight: 600,
                    fontFamily: FONT_BODY,
                  }}
                >
                  {host.isWeb ? 'Download full file' : 'Open full file in OS'}
                </button>
              </div>
            )}
          </div>
        ) : (
          // src= (not srcdoc) so relative asset refs resolve against
          // the served URL. `allow-same-origin` is required in the cloud:
          // the artifact's backend lives behind the same auth-gated origin,
          // and its fetch() calls must carry the `instance_session` cookie
          // to pass the edge gate. Without same-origin the iframe gets an
          // opaque origin, the cookie (SameSite=Lax) is dropped on those
          // cross-site XHRs, and every backend call 401s.
          //
          // KNOWN TRADEOFF: in cloud the iframe then shares the SPA's
          // origin, so a hostile artifact can reach the authenticated cowork
          // API and the parent window. The proper fix is to serve
          // previews from a dedicated origin (e.g. cw-<id>-preview.<env>) so
          // the iframe is same-origin to itself but cross-origin to the SPA.
          previewUrl ? (
            <iframe
              title={artifact.title || 'Artifact preview'}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
              style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
            />
          ) : null
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        open={confirmDelete}
        title="Delete artifact?"
        message={`"${artifact.title || artifact.path?.split('/').pop()}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        busyLabel="Deleting…"
        onConfirm={onConfirmDelete}
        onClose={() => { if (!deleteBusy) setConfirmDelete(false); }}
      />

    </Modal>
  );
}
