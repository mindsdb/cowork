// Inline preview modal for artifacts. Renders the artifact's content in a
// sandboxed iframe (HTML / fullstack) or inline (md / csv / txt). The top
// bar has three evenly-weighted zones:
//
//   left   — artifact title (truncated)
//   middle — open-local-folder icon + a link pill (reload · URL/"/" · open-in-browser)
//   right  — Publish control (self-hosted popover) · ⋯ menu · close
//
// Publish/unpublish/update/change-access all live in the <PublishMenu>
// popover, backed by the usePublish state machine — so this component is
// just chrome + preview.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../Icons';
import {
  mountArtifactPreview,
  previewArtifact,
  unpublishArtifact,
  deleteArtifact,
} from '../../api';
import { downloadArtifactFile } from '../../lib/artifactDownload';
import { isPublishableArtifact, BACKEND_ARTIFACT_TYPES } from '../../lib/artifactKinds';
import { Modal } from '../ui/Modal';
import { Menu, Tooltip, Spinner } from '../ui';
import { ConfirmModal } from '../ConfirmModal';
import { host } from '../../../platform/host';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { usePublish } from './publish/usePublish';
import { PublishMenu } from './publish/PublishMenu';

// Extensions we render inline with the lightweight text preview path
// (server `/v1/artifacts/preview` → text body). `.md` gets the full
// markdown renderer; `.csv` gets a parsed table; `.txt` and friends
// fall back to a monospace block.
const TEXT_PREVIEW_EXTS = new Set(['.md', '.txt', '.csv']);

// Append a content-version cache-buster so the iframe re-fetches fresh
// content when the artifact is rebuilt in place. Without it the webview
// keeps serving the first-loaded response for a stable URL, so the panel
// shows the old version until it's closed and reopened (ENG-375). `version`
// is the artifact's `mtime` (max content-file mtime) from the server.
function _withVersion(url, version) {
  if (!url || version == null || version === '') return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(version)}`;
}

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

// Ghost icon button shared by every top-bar affordance (folder, reload,
// open-in-browser, kebab, close). forwardRef so it can be the render
// target of a Base UI Tooltip/Menu trigger (those inject a ref).
const IconButton = forwardRef(function IconButton(
  { size = 30, disabled = false, style, children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      {...rest}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        background: 'transparent', border: 0, color: 'var(--ink-3)',
        width: size, height: size, borderRadius: 8, flexShrink: 0,
        display: 'inline-grid', placeItems: 'center',
        transition: 'background .12s ease, color .12s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }
        rest.onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)';
        rest.onMouseLeave?.(e);
      }}
    >
      {children}
    </button>
  );
});

// Full-bleed "Preview" placeholder shown over the preview region until the
// iframe has actually painted (or while a text preview is fetching), so the
// user never sees a flash of empty grey.
function PreviewPlaceholder() {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: 'var(--surface-2)', overflow: 'hidden',
    }}>
      <span style={{
        fontFamily: FONT_DISPLAY, fontWeight: 600,
        fontSize: 'clamp(40px, 9vw, 84px)', color: 'var(--ink)', opacity: 0.06,
        transform: 'rotate(-12deg)', letterSpacing: '0.04em',
        userSelect: 'none', whiteSpace: 'nowrap',
      }}>Preview</span>
      <div style={{
        position: 'absolute', bottom: 22,
        display: 'flex', alignItems: 'center', gap: 8,
        color: 'var(--ink-4)', fontFamily: FONT_BODY, fontSize: 12,
      }}>
        <Spinner /> Loading preview…
      </div>
    </div>
  );
}

export function ArtifactViewer({ open, artifact, onClose, onChange, onDelete }) {
  const actionPath = artifact?.canonicalPath || artifact?.file_path || artifact?.path || '';
  const displayPath = artifact?.displayPath || actionPath;
  const disabledReason = artifact?.actionDisabledReason || '';
  const hasActionPath = !!actionPath && !disabledReason;
  const isBackendArtifact = BACKEND_ARTIFACT_TYPES.has(artifact?.type);
  // Backend artifacts treat the folder, not the entry html, as the
  // "thing" the user opens in their OS or browser. Prefer the server's
  // `folder` (the artifact's slug dir) — for fullstack apps the primary
  // sits in a `static/` subdir, so stripping the filename off the path
  // would point at `static/`, not the slug folder. Fall back to that
  // strip for records that don't carry `folder` (e.g. from a chat bubble).
  const artifactFolder = artifact?.folder || actionPath.replace(/[\\/][^\\/]*$/, '') || actionPath;
  // Mounted preview URL — iframe loads this with `src=` so relative
  // `<script>` / `<link>` refs in the HTML resolve against a real URL.
  // (srcdoc has no base URL → relative refs 404.)
  const [previewUrl, setPreviewUrl] = useState('');
  // Whether the iframe has finished its first paint — drives the loading
  // placeholder so it lingers past "URL is ready" until content is visible.
  const [iframeReady, setIframeReady] = useState(false);
  // Text preview state for .md/.txt/.csv — populated via
  // `/v1/artifacts/preview`. Holds `{ content, truncated, mime }`.
  const [textPreview, setTextPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [backendPort, setBackendPort] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Manual-reload counter — bumped by the link-pill reload button to
  // force a fresh mount/fetch even when the artifact's mtime is unchanged.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Per-open counter used as a cache-buster fallback for artifacts whose
  // object carries no `mtime` (e.g. chat-bubble previews built from stream
  // steps). Increments only when there's no mtime, so every (re)open of
  // such an artifact fetches fresh content (ENG-375).
  const openNonceRef = useRef(0);

  // Publish/access state machine — the single source of truth for the
  // <PublishMenu> popover and the link-pill's published-URL display.
  const pub = usePublish(artifact, { onChange, enabled: open });

  const isText = _isTextArtifact(artifact);
  const textExt = isText
    ? ((artifact?.ext || '').toLowerCase() || _extOfPath(actionPath))
    : '';
  const publishable = isPublishableArtifact(artifact);

  // Reset the painted flag whenever the mounted URL changes so the
  // placeholder reappears for the new content.
  useEffect(() => { setIframeReady(false); }, [previewUrl]);

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
    // Cache-buster for the iframe so a content change (or just reopening /
    // a manual reload) fetches fresh content instead of the webview's
    // first-loaded copy. Prefer the server's content `mtime` — it changes
    // only on a real edit — and fold in the per-open nonce + manual-reload
    // counter so reopens and the reload button always re-fetch.
    const baseVersion = artifact?.mtime ?? (openNonceRef.current += 1);
    const cacheVersion = `${baseVersion}.${reloadNonce}`;
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
          setPreviewUrl(_withVersion(iframeUrl, cacheVersion));
          if (typeof port === 'number') setBackendPort(port);
          return;
        }
        if (!url) throw new Error('Preview mount returned no URL');
        if (cancelled) return;
        setPreviewUrl(_withVersion(url, cacheVersion));
        // Adopt the server's known published URL when the artifact object
        // (e.g. a chat-bubble preview) didn't carry one. Don't blank a
        // locally-known value when the server returns "".
        if (serverPublishedUrl && !pub.publishedUrl) onChange?.({ ...artifact, publishedUrl: serverPublishedUrl });
      })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Could not load artifact'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, artifact?.path, artifact?.mtime, actionPath, hasActionPath, disabledReason, isText, reloadNonce]);

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

  const title = artifact.title || artifact.path?.split('/').pop();
  const isPublished = !!pub.publishedUrl;

  // Open the local file only when the file is actually on this machine
  // (Electron + loopback server). When the desktop app points at a REMOTE
  // server, or in web, the path is on the server box, so we fall back to
  // the HTTP serve/published URL.
  const canOpenLocalFile = host.isElectron && host.isLocalApiOrigin();
  const canOpenInBrowser = isPublished || canOpenLocalFile || !!artifact?.serveUrl;

  // Open the artifact's containing folder in the OS file manager.
  const onOpenFolder = async () => {
    if (!canOpenLocalFile) return;
    try {
      const res = await host.openPath(artifactFolder || actionPath);
      if (res && res.ok === false) setErr(res.reason || 'Could not open folder.');
    } catch (e) {
      setErr(e?.message || 'Could not open folder.');
    }
  };

  // Force-refresh the preview (re-mount / re-fetch).
  const onReload = () => {
    if (!hasActionPath) return;
    setIframeReady(false);
    setReloadNonce((n) => n + 1);
  };

  // Open the published URL in the default browser; falls back to a new
  // window if the OS handoff is unavailable.
  const onOpenPublished = async () => {
    if (!pub.publishedUrl) return;
    try { await host.openExternal(pub.publishedUrl); }
    catch { window.open(pub.publishedUrl, '_blank', 'noreferrer'); }
  };

  // Open the local file / served preview (HTML → default browser, other
  // types → their default app). Handles backend artifacts + the web shell.
  const onOpenOS = async () => {
    if (isBackendArtifact && canOpenLocalFile) {
      if (!backendPort) {
        setErr('Backend port not available yet — preview is still loading.');
        return;
      }
      try { await host.openExternal(`http://127.0.0.1:${backendPort}`); }
      catch (e) { setErr(e?.message || 'Open failed'); }
      return;
    }
    if (!canOpenLocalFile) {
      const rel = artifact?.serveUrl || '';
      const url = rel
        ? (rel.startsWith('http') ? rel : `${host.getApiOrigin()}${rel}`)
        : (pub.publishedUrl || '');
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

  // The link-pill arrow: published → open the public URL; otherwise → open
  // the local/served preview.
  const onOpenInBrowser = () => (isPublished ? onOpenPublished() : onOpenOS());

  // Universal "save to disk" — type-agnostic stream through the sidecar's
  // serve endpoint with Content-Disposition: attachment.
  const onDownload = () => {
    if (!downloadArtifactFile(artifact, { actionPath })) {
      setErr(disabledReason || 'This artifact has no serve URL yet.');
    }
  };

  const onTrash = () => {
    if (pub.busy || deleteBusy) return;
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
    // goes too and the artifact disappears from the listing.
    setDeleteBusy(true);
    setErr('');
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // The server enforces the same rule as a backstop.
      if (isPublished) await unpublishArtifact(actionPath);
      await deleteArtifact(artifact?.folder || actionPath);
      setConfirmDelete(false);
      onDelete?.(actionPath);
      onClose?.();
    } catch (e) {
      setConfirmDelete(false);
      setErr(e?.message || 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  };

  const displayUrl = (pub.publishedUrl || '').replace(/^https?:\/\//, '');

  // Shared style for the small icon buttons inside the link pill. Round to
  // match the fully-rounded pill.
  const pillBtn = {
    width: 26, height: 26, borderRadius: 999, color: 'var(--ink-4)',
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
      {/* Top bar — three evenly-weighted zones (title · link · actions). */}
      <div style={{
        flex: '0 0 auto',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
      }}>
        {/* Left — title */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
          <div
            id="artifact-viewer-title"
            title={title}
            style={{
              fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 15, color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0, paddingRight: 12,
            }}
          >{title}</div>
        </div>

        {/* Middle — open-folder + link pill */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {canOpenLocalFile && (
            <Tooltip content="Open local folder">
              <IconButton onClick={onOpenFolder} aria-label="Open local folder">{Ico.openFolder(20)}</IconButton>
            </Tooltip>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 2,
            flex: '0 1 360px', minWidth: 140,
            background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 999,
            padding: '3px 6px',
          }}>
            <IconButton size={26} onClick={onReload} disabled={!hasActionPath}
              title="Reload preview" aria-label="Reload preview" style={pillBtn}>
              {Ico.reload(20)}
            </IconButton>
            <span
              title={isPublished ? pub.publishedUrl : undefined}
              style={{
                flex: '1 1 auto', minWidth: 0, textAlign: 'center',
                fontFamily: FONT_MONO, fontSize: 11.5,
                color: isPublished ? 'var(--ink-2)' : 'var(--ink-4)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                padding: '0 2px',
              }}
            >{isPublished ? displayUrl : '/'}</span>
            <IconButton size={26} onClick={onOpenInBrowser} disabled={!canOpenInBrowser}
              title="Open in browser" aria-label="Open in browser" style={pillBtn}>
              {Ico.arrowUpRight(20)}
            </IconButton>
          </div>
        </div>

        {/* Right — publish · more · close */}
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
          {publishable && (
            <PublishMenu controller={pub} disabled={!hasActionPath} disabledReason={disabledReason} />
          )}
          <Menu
            ariaLabel="Artifact actions"
            align="end"
            width={190}
            trigger={
              <IconButton aria-label="More actions" title="More actions">
                {Ico.moreVert(16)}
              </IconButton>
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
              { divider: true },
              {
                label: 'Delete',
                icon: Ico.trash(13),
                danger: true,
                disabled: deleteBusy || !hasActionPath,
                onClick: onTrash,
              },
            ]}
          />
          <IconButton onClick={onClose} aria-label="Close" title="Close">{Ico.close(15)}</IconButton>
        </div>
      </div>

      {/* Body — text (.md/.txt/.csv) renders inline; everything else is a
          sandboxed iframe with a "Preview" placeholder until it paints. */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--surface-2)', overflow: isText ? 'auto' : 'hidden' }}>
        {err ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 }}>
            <div style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'center', maxWidth: 460, fontFamily: FONT_BODY }}>{err}</div>
          </div>
        ) : isText ? (
          loading || !textPreview ? (
            <PreviewPlaceholder />
          ) : (
            <div style={{
              maxWidth: 920, margin: '0 auto', padding: '24px 28px',
              background: 'var(--surface)', minHeight: '100%',
            }}>
              {textExt === '.md' ? (
                <MarkdownContent text={textPreview.content} id={artifact.path} />
              ) : textExt === '.csv' && csvPreview ? (
                <MarkdownContent text={csvPreview.markdown} id={artifact.path} />
              ) : (
                <pre style={{
                  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  fontFamily: FONT_MONO, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55,
                }}>{textPreview.content}</pre>
              )}
              {(textPreview.truncated || (csvPreview && csvPreview.truncated)) && (
                <div style={{
                  marginTop: 18, padding: '10px 14px', borderRadius: 8,
                  background: 'var(--surface-2)', border: '1px solid var(--line)',
                  color: 'var(--ink-3)', fontSize: 12.5, fontFamily: FONT_BODY,
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
                      cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)',
                      color: 'var(--accent)', padding: '5px 11px', borderRadius: 6,
                      fontSize: 12, fontWeight: 600, fontFamily: FONT_BODY,
                    }}
                  >
                    {host.isWeb ? 'Download full file' : 'Open full file in OS'}
                  </button>
                </div>
              )}
            </div>
          )
        ) : (
          // src= (not srcdoc) so relative asset refs resolve against the
          // served URL. `allow-same-origin` is required in the cloud so the
          // artifact's backend calls carry the auth cookie (see ENG notes).
          <>
            {previewUrl && (
              <iframe
                title={title || 'Artifact preview'}
                src={previewUrl}
                onLoad={() => setIframeReady(true)}
                sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
                style={{
                  width: '100%', height: '100%', border: 0, background: '#fff',
                  opacity: iframeReady ? 1 : 0, transition: 'opacity 180ms ease',
                }}
              />
            )}
            {(loading || !previewUrl || !iframeReady) && <PreviewPlaceholder />}
          </>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        open={confirmDelete}
        title="Delete artifact?"
        message={`"${title}" will be permanently deleted. This cannot be undone.`}
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
