// Live artifacts page — mirrors the Projects header / filter pattern.
//
// Header:    "Live artifacts" Josefin title + Inter subtitle (no CTA —
//            artifacts are produced by Anton, not authored here).
// Filter:    search (⌘K) · sort pill · count · grid/list toggle.
// Sort:      default "Published first", then Recent · Oldest · Title · Type.
// Grid:      ArtifactBubble cards as today (HTML preview, URL pill,
//            Publish/Unpublish action).
// List:      compact rows — status dot · title · kind · project · updated · ⋯.
//
// Status dot: cyan = published, green-pulse = live preview, none = local.

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from '../components/Icons';
import {
  revealArtifact, publishArtifact, unpublishArtifact, updateArtifact,
  deleteArtifact,
  publishTargetPath, artifactServeUrl, openArtifactFile,
} from '../api';
import { copyText } from '../lib/clipboard';
import { downloadArtifactFile } from '../lib/artifactDownload';
import { isHtmlArtifact, isPublishableArtifact, isBackendArtifact } from '../lib/artifactKinds';
import { trackArtifactPublished } from '../lib/analytics';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui/Modal';
import { ArtifactViewer } from '../components/artifact';
import {
  AccessChooser,
  accessDraftFromArtifact,
  isAccessDraftValid,
  buildAccessPayload,
} from '../components/artifact/publish/AccessChooser';
import { ArtifactIcon, isWebAppArtifact, splitArtifactName } from '../components/artifacts/ArtifactIcon';
import { ArtifactStatus } from '../components/artifacts/ArtifactStatus';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  HoverMenu,
  useCollectionShortcut,
} from '../components/collection';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { host } from '../../platform/host';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useRevealOnHover } from '../hooks/useRevealOnHover';

const FONT_BODY = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO = "var(--font-mono)";

const EMPTY_ARTIFACTS = [];

// Sort options for the artifacts collection. Per-page (publishing
// state isn't relevant to other collections).
const SORT_OPTIONS = [
  { id: 'published', label: 'Published first' },
  { id: 'recent', label: 'Recent' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'title', label: 'Title (A–Z)' },
  { id: 'type', label: 'Type' },
];

function ArtifactsCounts({ search, total, filtered, publishedCount }) {
  const filterActive = (search || '').trim().length > 0;
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'artifact' : 'artifacts'}`;
  return (
    <>
      {countText}
      {publishedCount > 0 && (
        <>
          {' · '}
          <span style={{ color: 'var(--accent)' }}>{publishedCount} published</span>
        </>
      )}
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function projectNameOf(artifact, projects = []) {
  const p = (artifact.path || '');
  const match = projects.find((proj) => {
    if (!proj.path) return false;
    const pre = proj.path.replace(/\/+$/, '') + '/';
    return p.startsWith(pre);
  });
  if (match) return match.name;
  // Fallback — best-effort guess from path. Look for a /projects/X/
  // segment, otherwise just show the parent dir name.
  const m = p.match(/\/projects\/([^/]+)\//);
  if (m) return m[1];
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 2] || '—';
}

// Resolve to the actual project object so the label can navigate
// the user to that project's detail view. Returns null when the
// artifact's path doesn't fall under any known project root — in
// that case the label stays informational (no click affordance).
function projectOf(artifact, projects = []) {
  const p = artifact?.path || '';
  if (!p) return null;
  return projects.find((proj) => {
    if (!proj?.path) return false;
    const pre = proj.path.replace(/\/+$/, '') + '/';
    return p.startsWith(pre);
  }) || null;
}

// Extensions we can preview inline in the in-app ArtifactViewer (text
// branch). Keep in sync with the viewer's own TEXT_PREVIEW_EXTS so the
// click handlers and the body renderer agree on what's previewable.
const _INLINE_TEXT_EXTS = new Set(['.md', '.txt', '.csv']);
function isInlinePreviewable(a) {
  if (!a) return false;
  if (isHtmlArtifact(a)) return true;
  const declared = (a.ext || '').toLowerCase();
  if (_INLINE_TEXT_EXTS.has(declared)) return true;
  const p = (a.path || '').toLowerCase();
  for (const ext of _INLINE_TEXT_EXTS) if (p.endsWith(ext)) return true;
  return false;
}

// "Updated" is already pre-formatted by the server (e.g. "3h ago",
// "Yesterday"). For sorting we need a numeric stamp — fall back to the
// raw `updatedAt` / `mtime` if present, otherwise 0 so unknown items
// sink to the bottom.
function timestampOf(a) {
  const raw = a.updatedAt || a.updated_at || a.mtime || a.modified;
  if (raw == null) return 0;
  if (typeof raw === 'number') return raw;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

// Kind pill — short uppercase tag for the file type. Pulls from
// `artifact.kind` or falls back to the file extension.
function kindOf(a) {
  if (a.kind) return String(a.kind).toLowerCase();
  const ext = (a.ext || '').replace(/^\./, '').toLowerCase();
  return ext || 'file';
}

// Bare extension (no leading dot) — used for the type subtitle on the
// card, where we want `type: html` rather than the broader "kind".
function extensionOf(a) {
  const fromExt = (a.ext || '').replace(/^\./, '').toLowerCase();
  if (fromExt) return fromExt;
  const m = (a.path || '').match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || 'file').toLowerCase();
}

// Pick a representative icon for the artifact based on its extension.
// Mirrors the rough kind buckets server-side: dashboards (HTML), docs
// (md/txt/pdf), code (py/js/css/etc), data (csv/json), images.
function iconForArtifact(a) {
  const ext = extensionOf(a);
  if (ext === 'html' || ext === 'htm') return Ico.globe;
  if (['md', 'txt', 'pdf', 'rtf', 'doc', 'docx'].includes(ext)) return Ico.doc;
  if (['py', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'sh', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return Ico.code;
  if (['csv', 'json', 'jsonl', 'tsv', 'parquet', 'sqlite', 'db'].includes(ext)) return Ico.database;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico'].includes(ext)) return Ico.image;
  return Ico.doc;
}

// ─── Action button (used by the bubble's bottom row) ─────────────────────

function ActionButton({ children, onClick, danger, primary, title }) {
  const styleBase = {
    cursor: 'pointer',
    fontFamily: FONT_BODY, fontSize: 12, fontWeight: 500,
    padding: '6px 10px', borderRadius: 7,
    display: 'inline-flex', alignItems: 'center', gap: 5,
    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
  };
  if (primary) Object.assign(styleBase, {
    background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
  });
  else if (danger) Object.assign(styleBase, {
    background: 'transparent', color: 'var(--danger)',
    border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
  });
  else Object.assign(styleBase, {
    background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--line)',
  });
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }} title={title} style={styleBase}>
      {children}
    </button>
  );
}

// ─── Published pill + URL row (shared between grid + list) ───────────────

// `mode` adds a glyph + tooltip so a password-protected or restricted publish
// is distinguishable from a public one everywhere the pill shows. Falls back to
// the legacy `protected` boolean for artifacts without an explicit accessMode.
function PublishedPill({ mode, protected: isProtected = false }) {
  const effectiveMode = mode && mode !== 'public' ? mode : (isProtected ? 'password' : 'public');
  const isRestricted = effectiveMode === 'restricted';
  const isPwd = effectiveMode === 'password';
  return (
    <span
      title={isRestricted ? 'Published — restricted to selected people'
        : isPwd ? 'Published — password protected' : 'Published'}
      style={{
        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        color: 'var(--accent)',
        padding: '1px 6px', borderRadius: 999,
        fontSize: 9, fontWeight: 700,
        lineHeight: 1.2,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        flexShrink: 0,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        fontFamily: FONT_BODY,
      }}
    >
      {isRestricted
        ? <span style={{ display: 'inline-flex' }}>{Ico.people(9)}</span>
        : isPwd
          ? <span style={{ display: 'inline-flex' }}>{Ico.lock(9)}</span>
          : <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--accent)' }} />}
      Published
    </span>
  );
}

// Shown next to PublishedPill when a published artifact's files changed after
// publish (server-computed `artifact.modified`). Amber, so it reads as
// "published version is stale" — distinct from the cyan Published pill.
function ModifiedPill() {
  return (
    <span
      title="Edited since publish — use Update to push the latest version"
      style={{
        background: 'color-mix(in srgb, #f5a623 16%, transparent)',
        border: '1px solid color-mix(in srgb, #f5a623 40%, transparent)',
        color: '#f5a623',
        padding: '1px 6px', borderRadius: 999,
        fontSize: 9, fontWeight: 700,
        lineHeight: 1.2,
        display: 'inline-flex', alignItems: 'center', gap: 4,
        flexShrink: 0,
        letterSpacing: '0.05em', textTransform: 'uppercase',
        fontFamily: FONT_BODY,
      }}
    >
      <span style={{ width: 4, height: 4, borderRadius: 99, background: '#f5a623' }} />
      Modified
    </span>
  );
}

// Publish visibility chooser — a thin wrapper over the shared
// <AccessChooser>. Owns only the draft + dialog chrome; the Public /
// Password / Restricted UI and its validation live in one place now.
// On confirm it hands back the access payload. Re-publishing pre-fills
// the existing selection.
function PublishDialog({ artifact, onCancel, onConfirm }) {
  const [draft, setDraft] = useState(() => accessDraftFromArtifact(artifact));
  if (!artifact) return null;
  const canConfirm = isAccessDraftValid(draft);
  const submit = () => { if (canConfirm) onConfirm(buildAccessPayload(draft)); };

  return (
    <Modal open onClose={onCancel} size="sm" width="min(440px, 94vw)" maxHeight="min(600px, 90vh)" labelledBy="publish-dialog-title">
      <ModalHeader
        id="publish-dialog-title"
        title="Publish to the Web"
        subtitle={artifact.title || artifact.path?.split('/').pop()}
        onClose={onCancel}
      />
      <ModalBody>
        <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', marginBottom: 8 }}>
          Who can access your app
        </div>
        <AccessChooser value={draft} onChange={setDraft} onSubmit={submit} />
      </ModalBody>
      <ModalFooter>
        <button type="button" onClick={onCancel} style={{
          cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)',
          color: 'var(--ink-2)', padding: '8px 14px', borderRadius: 8, fontFamily: FONT_BODY, fontSize: 13,
        }}>Cancel</button>
        <button type="button" onClick={submit} disabled={!canConfirm} style={{
          cursor: canConfirm ? 'pointer' : 'not-allowed',
          background: 'var(--accent)', border: '1px solid var(--accent)', color: '#fff',
          padding: '8px 16px', borderRadius: 8, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 13,
          opacity: canConfirm ? 1 : 0.5,
        }}>
          {draft.mode === 'password' ? 'Publish protected' : draft.mode === 'restricted' ? 'Publish restricted' : 'Publish'}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function PublishedUrlRow({ url, onOpen, onCopy }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e) => {
    e.stopPropagation();
    // The parent's onCopy returns a boolean indicating whether the
    // copy actually landed in the clipboard. Only flip the icon on
    // success — otherwise we were lying to the user about it working.
    const ok = await onCopy?.();
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };
  const display = url.replace(/^https?:\/\//, '');
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        overflow: 'hidden',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        title={`Open in browser: ${url}`}
        style={{
          flex: 1, minWidth: 0,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 10px',
          background: 'transparent', border: 0, cursor: 'pointer',
          fontFamily: FONT_BODY, fontSize: 12,
          color: 'var(--ink-2)', textAlign: 'left',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.color = 'var(--accent)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = 'var(--ink-2)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--accent)' }}>
          {Ico.externalLink(13)}
        </span>
        <span style={{
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {display}
        </span>
      </button>
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy URL'}
        style={{
          flexShrink: 0,
          padding: '7px 10px',
          background: 'transparent',
          border: 0, borderLeft: '1px solid var(--line)',
          cursor: 'pointer',
          color: copied ? 'var(--accent)' : 'var(--ink-3)',
          display: 'inline-flex', alignItems: 'center',
          transition: 'color 120ms ease, background 120ms ease',
        }}
        onMouseOver={(e) => {
          if (!copied) e.currentTarget.style.color = 'var(--ink)';
          e.currentTarget.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.color = copied ? 'var(--accent)' : 'var(--ink-3)';
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {copied ? Ico.check(13) : Ico.copy(13)}
      </button>
    </div>
  );
}

// ─── Card / Bubble (grid view) ───────────────────────────────────────────

// Static path row used in place of the published URL pill when the
// artifact is local-only. Mirrors the URL pill's surface so the card
// keeps a consistent slot height as state flips between published
// and not. Ellipsis-truncates a long path; full path lives in the
// `title` attribute for hover. RTL trick on the path span keeps the
// filename visible (truncates the front, not the back).
//
// Left-to-right mark (U+200E). The `direction: rtl` trick below would
// otherwise let the bidi algorithm relocate an absolute path's leading
// "/" to the visual end, rendering a bogus trailing slash. Prefixing the
// path with a strong-LTR mark pins the leading slash in place.
const LTR_MARK = String.fromCharCode(0x200e);

function LocalPathRow({ path }) {
  if (!path) return null;
  return (
    <div
      title={path}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 10px', borderRadius: 8,
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        minWidth: 0,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-4)' }}>
        {Ico.folder(12)}
      </span>
      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: FONT_MONO, fontSize: 11.5,
        color: 'var(--ink-3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        direction: 'rtl', textAlign: 'left',
      }}>{LTR_MARK + path}</span>
    </div>
  );
}

// Ghost icon button for the card header (open ↗ / ⋯). forwardRef so the
// kebab can be the anchor for the page-level HoverMenu.
const CardIconButton = forwardRef(function CardIconButton({ onClick, title, ariaLabel, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      aria-label={ariaLabel || title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      style={{
        width: 28, height: 28, borderRadius: 7,
        display: 'inline-grid', placeItems: 'center',
        background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
        color: 'var(--ink-4)', transition: 'background .12s ease, color .12s ease',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-4)'; }}
    >
      {children}
    </button>
  );
});

function ArtifactBubble({ artifact, projects = [], onOpenViewer, onMenuOpen, isMenuOpen, phase, onRetry, onOpenProject }) {
  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  // In the browser the artifact's address is its HTTP serve URL, not a local
  // OS path the user can't reach — open that "private" URL instead.
  const privateUrl = host.isWeb ? artifactServeUrl(artifact) : '';

  const { hoverProps } = useRevealOnHover(isMenuOpen);
  const kebabRef = useRef(null);

  const onOpenPublished = async () => {
    if (!published) return;
    try { await host.openExternal(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };
  const onOpenPrivate = async () => {
    if (!privateUrl) return;
    try { await host.openExternal(privateUrl); } catch {
      window.open(privateUrl, '_blank', 'noreferrer');
    }
  };

  const projectLabel = projectNameOf(artifact, projects);
  // The project the artifact belongs to. When resolved, the project label
  // becomes a clickable affordance that navigates to that project's page.
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  // Hand the click off to the parent — it owns the single shared
  // menu so the dropdown isn't rendered inside the card (cards
  // apply `transform` on hover, which would re-anchor a
  // position:fixed descendant to the card instead of the viewport).
  const openMenu = (e) => {
    e.stopPropagation();
    if (!kebabRef.current) return;
    onMenuOpen?.(artifact, kebabRef.current.getBoundingClientRect());
  };

  // Only web apps are publishable (everything else is a static Draft); the
  // name renders base-truncated with the extension always visible.
  const publishable = isWebAppArtifact(artifact);
  const { base, ext: nameExt } = splitArtifactName(artifact);
  // ↗ — open the live thing: published URL, else served URL, else local file.
  const onOpenExternal = (e) => {
    e.stopPropagation();
    if (published) onOpenPublished();
    else if (privateUrl) onOpenPrivate();
    else openArtifactFile(artifact);
  };

  return (
    <div
      className="artifact-card"
      role="button"
      tabIndex={0}
      {...hoverProps}
      onClick={() => (canPreview ? onOpenViewer(artifact) : openArtifactFile(artifact))}
      onKeyDown={(e) => { if (e.key === 'Enter') (canPreview ? onOpenViewer(artifact) : openArtifactFile(artifact)); }}
      style={{
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'border-color 160ms ease, box-shadow 200ms ease, transform 160ms ease',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02), 0 12px 28px rgba(15,16,17,0.08)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = 'var(--line)';
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(15,16,17,0.02)';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Body — icon + name·ext + actions, then the status row. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '14px 16px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            <ArtifactIcon artifact={artifact} size={18} />
          </span>
          {/* Name: base truncates, extension stays pinned + visible. */}
          <div style={{
            display: 'flex', alignItems: 'baseline', minWidth: 0, flex: 1,
            fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: 1.2,
          }} title={artifact.title}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{base}</span>
            {nameExt && <span style={{ flexShrink: 0, color: 'var(--ink-3)' }}>{nameExt}</span>}
          </div>
          {/* Actions — open-in-browser + ⋯ menu. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <CardIconButton title="Open" onClick={onOpenExternal}>{Ico.externalLink(15)}</CardIconButton>
            <CardIconButton ref={kebabRef} title="More actions" ariaLabel="Artifact menu"
              onClick={(e) => { e.stopPropagation(); openMenu(e); }}>
              {Ico.moreVert(16)}
            </CardIconButton>
          </div>
        </div>

        <div style={{ display: 'flex', minWidth: 0 }}>
          <ArtifactStatus artifact={artifact} phase={phase} publishable={publishable} onRetry={onRetry} />
        </div>
      </div>

      {/* Footer — project origin + last-updated, divided from the body. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '9px 16px', borderTop: '1px solid var(--line)', background: 'var(--surface-2)',
      }}>
        <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-4)' }}>{Ico.folder(13)}</span>
        {canOpenProject ? (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
            title={`Open ${projectMatch.name}`}
            style={{
              all: 'unset', cursor: 'pointer',
              fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
              minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              transition: 'color 120ms ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '2px'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.textDecoration = 'none'; }}
          >{projectLabel}</button>
        ) : (
          <span title={projectLabel} style={{
            fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
            minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{projectLabel}</span>
        )}
        <span style={{
          marginLeft: 'auto', flexShrink: 0,
          fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)',
        }}>{artifact.updated || '—'}</span>
      </div>
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Status dot · Title · Published · Type · Kind · Project · Updated · ⋯
//
// `Type` is the bare file extension (html, csv, png, …) and lives
// before `Kind` (the broader category — Dashboard, Data, Image, …)
// so the at-a-glance scan reads from concrete to abstract.
// Name · Project · Status · (updated + actions). The trailing column is a
// FIXED width — not `auto` — so the header grid (empty trailing cell) and each
// row grid (updated + 2 icons) distribute their fr columns identically and the
// Name/Project/Status headers line up exactly over their values.
const LIST_GRID = 'minmax(0, 2.4fr) minmax(0, 1.3fr) minmax(0, 2fr) 200px';

function ListHeaderRow() {
  const Cell = ({ children }) => (
    <div style={{
      fontFamily: FONT_BODY, fontSize: 13, fontWeight: 600, color: 'var(--ink-2)',
    }}>{children}</div>
  );
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LIST_GRID, gap: 16,
      padding: '10px 16px',
      borderBottom: '1px solid var(--line)',
    }}>
      <Cell>Name</Cell>
      <Cell>Project</Cell>
      <Cell>Status</Cell>
      <Cell />
    </div>
  );
}

function StatusDot({ artifact }) {
  const published = !!artifact.publishedUrl;
  if (published) {
    return (
      <span aria-label="Published" title="Published" style={{
        width: 8, height: 8, borderRadius: 99,
        background: 'var(--accent)',
        boxShadow: '0 0 6px var(--accent-glow)',
        flexShrink: 0,
      }} />
    );
  }
  if (artifact.live) {
    return (
      <span aria-label="Live preview" title="Live preview" className="pulse-dot" style={{
        width: 8, height: 8, borderRadius: 99,
        background: 'var(--success)',
        boxShadow: '0 0 6px var(--success-glow)',
        flexShrink: 0,
      }} />
    );
  }
  return (
    <span style={{
      width: 8, height: 8, borderRadius: 99,
      background: 'var(--ink-5)', flexShrink: 0,
    }} />
  );
}

function RowMenu({ open, anchorRect, artifact, onClose, onOpen, onReveal, onDownload, onCopyUrl, onPublish, onUnpublish, onUpdate, onDelete, isMacPlatform = false }) {
  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;
  const items = [
    {
      id: 'open',
      label: isHtml ? 'Open viewer' : 'Open',
      icon: Ico.externalLink(13),
      onClick: onOpen,
    },
    onReveal && {
      id: 'reveal',
      label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
      icon: Ico.folder(13),
      onClick: onReveal,
    },
    onDownload && artifact?.serveUrl && {
      id: 'download',
      label: 'Download',
      icon: Ico.download(13),
      onClick: onDownload,
    },
    published && {
      id: 'copy-url',
      label: 'Copy URL',
      icon: Ico.copy(13),
      onClick: onCopyUrl,
    },
    published && artifact.modified && {
      id: 'update',
      label: 'Update',
      icon: Ico.refresh(13),
      onClick: onUpdate,
    },
    isPublishableArtifact(artifact) && !published && {
      id: 'publish',
      label: 'Publish',
      icon: Ico.upload(13),
      onClick: onPublish,
    },
    published && {
      id: 'unpublish',
      label: 'Unpublish',
      icon: Ico.upload(13),
      onClick: onUnpublish,
    },
    onDelete && { divider: true },
    onDelete && {
      id: 'delete',
      label: 'Delete artifact',
      icon: Ico.trash(13),
      danger: true,
      onClick: onDelete,
    },
  ].filter(Boolean);

  return (
    <HoverMenu
      open={open}
      anchorRect={anchorRect}
      onClose={onClose}
      width={200}
      items={items}
    />
  );
}

function ArtifactRow({ artifact, projects, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish, onUpdate: doUpdate, onDelete: doDelete, onOpenProject, phase, onRetry }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  const { hovered, hoverProps } = useRevealOnHover(menuOpen);

  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  const publishable = isWebAppArtifact(artifact);
  const privateUrl = host.isWeb ? artifactServeUrl(artifact) : '';
  const { base, ext: nameExt } = splitArtifactName(artifact);
  const project = projectNameOf(artifact, projects);
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onRowOpen = () => {
    if (canPreview) onOpenViewer?.(artifact);
    else openArtifactFile(artifact);
  };
  const onOpenExternal = async (e) => {
    e.stopPropagation();
    const url = published ? artifact.publishedUrl : privateUrl;
    if (url) { try { await host.openExternal(url); } catch { window.open(url, '_blank', 'noreferrer'); } }
    else openArtifactFile(artifact);
  };
  const openMenu = (e) => {
    e.stopPropagation();
    setAnchorRect(triggerRef.current?.getBoundingClientRect() || null);
    setMenuOpen(true);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onRowOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onRowOpen(); }}
        {...hoverProps}
        style={{
          display: 'grid', gridTemplateColumns: LIST_GRID, gap: 16,
          padding: '12px 16px',
          background: hovered ? 'var(--surface-2)' : 'transparent',
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer',
          transition: 'background .12s ease',
          alignItems: 'center',
          outline: 'none',
        }}
      >
        {/* Name — icon + base (truncates) + extension (pinned, subtle). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            <ArtifactIcon artifact={artifact} size={16} />
          </span>
          <div
            title={artifact.title}
            style={{
              display: 'flex', alignItems: 'baseline', minWidth: 0,
              fontFamily: FONT_DISPLAY, fontSize: 14, fontWeight: 600, lineHeight: 1.2,
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{base}</span>
            {nameExt && <span style={{ flexShrink: 0, color: 'var(--ink-3)' }}>{nameExt}</span>}
          </div>
        </div>

        {/* Project */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-4)' }}>{Ico.folder(13)}</span>
          {canOpenProject ? (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onOpenProject(projectMatch); } }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-2)',
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                display: 'inline-block', maxWidth: '100%', transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.textDecoration = 'underline'; e.currentTarget.style.textUnderlineOffset = '2px'; }}
              onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-2)'; e.currentTarget.style.textDecoration = 'none'; }}
            >{project}</button>
          ) : (
            <span title={project} style={{
              fontFamily: FONT_BODY, fontSize: 12.5, color: 'var(--ink-2)',
              minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{project}</span>
          )}
        </div>

        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          <ArtifactStatus artifact={artifact} phase={phase} publishable={publishable} onRetry={onRetry} />
        </div>

        {/* Updated + open + ⋯ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', whiteSpace: 'nowrap' }}>
          <span style={{ fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-4)' }}>{artifact.updated || '—'}</span>
          <CardIconButton title="Open" onClick={onOpenExternal}>{Ico.externalLink(14)}</CardIconButton>
          <CardIconButton ref={triggerRef} title="More actions" ariaLabel="Artifact menu" onClick={openMenu}>{Ico.moreVert(15)}</CardIconButton>
        </div>
      </div>

      <RowMenu
        open={menuOpen}
        anchorRect={anchorRect}
        artifact={artifact}
        onClose={() => setMenuOpen(false)}
        onOpen={onRowOpen}
        onReveal={host.isWeb ? undefined : () => { try { revealArtifact(artifact.path); } catch { } }}
        onDownload={() => downloadArtifactFile(artifact)}
        onCopyUrl={onCopyUrl}
        onPublish={() => doPublish?.(artifact)}
        onUnpublish={() => doUnpublish?.(artifact)}
        onUpdate={() => doUpdate?.(artifact)}
        onDelete={doDelete ? () => doDelete(artifact) : undefined}
        isMacPlatform={host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')}
      />
    </>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

function EmptyState({ agentLabel = 'the agent' }) {
  return (
    <div style={{
      flex: 1, minHeight: 360,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 12, padding: '40px 24px',
    }}>
      <span style={{ display: 'inline-flex', color: 'var(--ink-5)' }}>{Ico.sparkle(32)}</span>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
        No artifacts yet
      </div>
      <div style={{ fontFamily: FONT_BODY, fontSize: 13.5, color: 'var(--ink-3)', maxWidth: 380, textAlign: 'center' }}>
        When {agentLabel} creates documents, dashboards, or code outputs they'll appear here.
      </div>
    </div>
  );
}

// ─── Toast ───────────────────────────────────────────────────────────────
//
// Inline banner that surfaces publish / unpublish results so failures
// (most commonly a missing ANTON_MINDS_API_KEY) don't disappear into
// the console. Auto-dismisses after a few seconds; success and error
// share the layout but have distinct accent / danger tints.

function Toast({ kind, message, onClose }) {
  if (!message) return null;
  const isError = kind === 'error';
  return (
    <div style={{
      // Position is owned by the parent wrapper now (fixed overlay),
      // so this card carries no outer margin.
      padding: '10px 14px',
      borderRadius: 8,
      background: isError
        ? 'color-mix(in srgb, var(--danger) 12%, var(--surface))'
        : 'color-mix(in srgb, var(--accent) 12%, var(--surface))',
      border: `1px solid ${isError ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'color-mix(in srgb, var(--accent) 40%, transparent)'}`,
      color: isError ? 'var(--danger)' : 'var(--ink-2)',
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: FONT_BODY, fontSize: 12.5,
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: isError ? 'var(--danger)' : 'var(--accent)' }}>
        {isError ? Ico.alert?.(14) || Ico.trash(14) : Ico.check(14)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          background: 'transparent', border: 0,
          color: 'var(--ink-3)', cursor: 'pointer',
          padding: 4, display: 'inline-grid', placeItems: 'center',
        }}
      >
        {Ico.close ? Ico.close(12) : '×'}
      </button>
    </div>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function ArtifactsView({ artifacts: initial = EMPTY_ARTIFACTS, projects = [], onOpenProject, agentLabel = 'the agent' }) {
  const [list, setList] = useState(initial);
  const [viewer, setViewer] = useState(null);
  const { isMobile } = useBreakpoint();
  const [view, setView] = useState(() =>
    localStorage.getItem('anton:artifacts-view') === 'list' ? 'list' : 'grid'
  );
  // List rows break at phone widths (5-column grid). Force grid on
  // mobile so the toggle isn't needed; the user's persisted desktop
  // preference is left untouched.
  const effectiveView = isMobile ? 'grid' : view;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('published');
  // Per-artifact-path "in flight" set so multiple cards can publish
  // independently without freezing the whole grid.
  const [busyPaths, setBusyPaths] = useState(() => new Set());
  // Artifact awaiting the publish visibility choice (public vs password).
  // Null when the chooser is closed.
  const [publishTarget, setPublishTarget] = useState(null);
  // Resolver for the promise returned by `handlePublish`, so a delegated
  // caller (the preview's Publish button) can await the whole dialog +
  // POST flow for its busy state. Settled when the chooser confirms,
  // cancels, or errors — exactly once per flow.
  const publishResolveRef = useRef(null);
  const settlePublish = () => {
    publishResolveRef.current?.();
    publishResolveRef.current = null;
  };
  // Page-level state for the shared HoverMenu — mounting the menu at
  // the parent (and not inside a card) is required because cards
  // apply `transform` on hover, which would re-anchor a position:fixed
  // descendant to the card itself instead of the viewport.
  const [menuFor, setMenuFor] = useState(null); // { artifact, rect }
  const isMacPlatform = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  // Toast surfaces publish/unpublish results — primarily so failures
  // don't disappear into the console.
  const [toast, setToast] = useState(null); // { kind: 'ok'|'error', message }
  const searchRef = useRef(null);

  // Reflect parent refreshes exactly. The parent refetches when the
  // route opens and after streams complete; if a file was trashed from
  // another surface, the refreshed prop is the source of truth and the
  // local grid must drop the stale card.
  useEffect(() => {
    setList(initial);
    setViewer((cur) => {
      if (!cur) return cur;
      const fresh = initial.find((a) => a.path === cur.path);
      return fresh ? { ...cur, ...fresh } : null;
    });
  }, [initial]);

  // Persist view toggle.
  useEffect(() => { localStorage.setItem('anton:artifacts-view', view); }, [view]);

  // ⌘K focuses the search input.
  useCollectionShortcut(searchRef);

  // Auto-dismiss the toast after 5s — long enough to read, short enough
  // not to linger across navigations.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  const updateOne = (updated) => {
    setList((prev) => prev.map((a) => a.path === updated.path ? { ...a, ...updated } : a));
    setViewer((cur) => (cur && cur.path === updated.path ? { ...cur, ...updated } : cur));
  };

  const removeOne = (path) => {
    setList((prev) => prev.filter((a) => a.path !== path));
    setViewer((cur) => (cur && cur.path === path ? null : cur));
  };

  const setBusy = (path, isBusy) => {
    setBusyPaths((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  // Per-path transient status the status pills read: 'publishing' |
  // 'updating' | 'unpublishing' | 'failed'. Cleared (idle) when the action
  // settles successfully; 'failed' sticks until the user retries. Pure map
  // → the pill is whatever's here, so the status can't get stuck.
  const [statusByPath, setStatusByPath] = useState({});
  const setPhase = (path, phase) => setStatusByPath((prev) => {
    if (!phase) {
      if (!(path in prev)) return prev;
      const { [path]: _drop, ...rest } = prev;
      return rest;
    }
    return { ...prev, [path]: phase };
  });

  // Centralized publish — single source of truth for state updates,
  // toast dispatch, and busy bookkeeping. Mirrors anton's /publish
  // command flow: POST → server zips, scrubs credentials, uploads to
  // MindsHub, persists report_id in `.published.json`. We then reflect
  // the returned URL into the local list so the UI flips to "Published"
  // without a refetch.
  // Publishing is two steps: choose visibility (public / password) in a
  // small dialog, then confirmPublish does the actual POST. Re-publishing
  // a protected artifact pre-fills its existing password.
  const handlePublish = (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return Promise.resolve();
    if (!isPublishableArtifact(artifact)) {
      setToast({ kind: 'error', message: 'Only HTML and Markdown artifacts can be published.' });
      return Promise.resolve();
    }
    // Settle any prior unresolved flow before starting a new one so a
    // delegated awaiter is never left hanging.
    settlePublish();
    setPublishTarget(artifact);
    return new Promise((resolve) => { publishResolveRef.current = resolve; });
  };

  const confirmPublish = async (access) => {
    const artifact = publishTarget;
    setPublishTarget(null);
    if (!artifact?.path || busyPaths.has(artifact.path)) { settlePublish(); return; }
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'publishing');
    try {
      const r = await publishArtifact(publishTargetPath(artifact), access);
      if (r?.url) {
        // Server is authoritative (it degrades an empty restricted/password
        // selection back to public); fall back to the requested access.
        const m = r.accessMode || access?.mode || 'public';
        updateOne({
          ...artifact,
          publishedUrl: r.url,
          accessMode: m,
          accessProtected: m === 'password',
          accessPassword: m === 'password' ? (access?.password || '') : '',
          accessEmails: m === 'restricted' ? (r.accessEmails || access?.emails || []) : [],
          orgAllowed: m === 'restricted' ? !!(r.orgAllowed ?? access?.org_allowed) : false,
        });
        setPhase(artifact.path, null);
        const label = m === 'password' ? 'password protected' : m === 'restricted' ? 'restricted' : null;
        trackArtifactPublished(r.report_id || artifact.id || '', m);
        setToast({
          kind: 'ok',
          message: label ? `Published (${label}) — ${r.url}` : `Published — ${r.url}`,
        });
      } else {
        setPhase(artifact.path, 'failed');
        setToast({ kind: 'error', message: 'Publish returned no URL.' });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      // Map the most common failure to a clearer next step.
      const friendly = /minds_api_key/i.test(msg) || /minds api key/i.test(msg)
        ? 'Set your Minds API key in Settings to publish artifacts.'
        : `Publish failed: ${msg}`;
      setPhase(artifact.path, 'failed');
      setToast({ kind: 'error', message: friendly });
    } finally {
      setBusy(artifact.path, false);
      settlePublish();
    }
  };

  const handleUnpublish = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'unpublishing');
    try {
      await unpublishArtifact(publishTargetPath(artifact));
      updateOne({ ...artifact, publishedUrl: '' });
      setToast({ kind: 'ok', message: 'Unpublished from MindsHub.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Unpublish failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
      setPhase(artifact.path, null);
    }
  };

  const handleUpdate = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    setPhase(artifact.path, 'updating');
    try {
      const r = await updateArtifact(publishTargetPath(artifact));
      // Server refreshed last_md5 + published_mtime, so the artifact is no
      // longer "modified". Reflect it locally without a refetch.
      updateOne({ ...artifact, modified: false, publishedUrl: r?.url || artifact.publishedUrl });
      setToast({ kind: 'ok', message: 'Updated published version.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Update failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
      setPhase(artifact.path, null);
    }
  };

  const handleTrash = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    try {
      // Unpublish first so deletion never leaves an orphaned public copy.
      // If this fails we abort and keep the artifact (the server enforces
      // the same rule as a backstop).
      if (artifact.publishedUrl) {
        await unpublishArtifact(artifact.path);
      }
      await deleteArtifact(artifact.folder || artifact.path);
      removeOne(artifact.path);
      setToast({ kind: 'ok', message: 'Deleted.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Delete failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
    }
  };

  // Filter + sort.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = (list || []).slice();
    if (q) out = out.filter((a) =>
      (a.title || '').toLowerCase().includes(q)
      || (a.path || '').toLowerCase().includes(q)
      || (a.kind || '').toLowerCase().includes(q),
    );

    out.sort((a, b) => {
      switch (sort) {
        case 'recent': return timestampOf(b) - timestampOf(a);
        case 'oldest': return timestampOf(a) - timestampOf(b);
        case 'title': return (a.title || '').localeCompare(b.title || '');
        case 'type': return kindOf(a).localeCompare(kindOf(b));
        case 'published':
        default: {
          const pa = a.publishedUrl ? 0 : 1;
          const pb = b.publishedUrl ? 0 : 1;
          if (pa !== pb) return pa - pb;
          // Within each group, recency.
          return timestampOf(b) - timestampOf(a);
        }
      }
    });
    return out;
  }, [list, search, sort]);

  const total = (list || []).length;
  // Published count reflects the *visible* set so it tracks the filter
  // (e.g. "Showing 5 of 12 · 2 published" surfaces what's in the view,
  // not the global count). The numerator stays accurate while the
  // denominator changes with the search.
  const publishedCount = visible.filter((a) => a.publishedUrl).length;

  return (
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through.
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
      // Query container so the artifacts grid picks its column count from the
      // actual panel width (not the viewport) — see .artifacts-grid @container.
      containerType: 'inline-size',
    }}>
      <PageHeader
        title="Live Artifacts"
        subtitle={`Documents, dashboards, and code ${agentLabel} produces. Publish to share a live URL.`}
        // 20px below the subtitle text so the page reads with a
        // little air before the search-row begins. The 20px spacer
        // below the header still adds the standard between-section
        // rhythm — together they make Live Artifacts breathe a touch
        // more than other collection pages, where the action button
        // already anchors the lower edge of the header.
        subtitleBottom={20}
      />

      {/* Toast is portalled to document.body so it renders after modals
          in DOM order, which prevents iframes inside modals from
          compositing on top of it regardless of z-index. */}
      {createPortal(
        <div style={{
          position: 'fixed', top: 24, right: 32, zIndex: 90,
          pointerEvents: toast?.message ? 'auto' : 'none',
          maxWidth: 420,
        }}>
          <Toast
            kind={toast?.kind}
            message={toast?.message}
            onClose={() => setToast(null)}
          />
        </div>,
        document.body,
      )}

      {/* Subtitle → search-row gap. Set to 20px per the design;
          ProjectsView uses 18px because its header has an anchor
          button on the right ("+ New project"), which reads as
          slightly taller — Artifacts compensates with a few extra. */}
      <div style={{ height: 20 }} />

      {total > 0 && (
        <FilterRow
          search={
            <SearchInput
              value={search}
              onChange={setSearch}
              inputRef={searchRef}
              placeholder="Search artifacts"
            />
          }
          sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
          view={<span className="artifacts-view-toggle"><ToggleGroup value={view} onValueChange={setView} size="sm" aria-label="View" options={[{ value: 'grid', label: 'Grid', icon: Ico.grid(12) }, { value: 'list', label: 'List', icon: Ico.list(12) }]} /></span>}
        />
      )}

      {total === 0 ? (
        <EmptyState agentLabel={agentLabel} />
      ) : effectiveView === 'grid' ? (
        <div className="artifacts-grid" style={{
          // Grid layout (display + responsive columns + gap) lives in CSS
          // (.artifacts-grid in globals.css): 2 cols, 3 when wide, 1 on
          // mobile — pure CSS media queries, no JS resize listener.
          padding: '6px 32px 60px',
          marginTop: 18,
        }}>
          {visible.map((a) => (
            <ArtifactBubble
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onMenuOpen={(art, rect) => setMenuFor((prev) =>
                prev?.artifact?.path === art.path ? null : { artifact: art, rect },
              )}
              isMenuOpen={menuFor?.artifact?.path === a.path}
              phase={statusByPath[a.path]}
              onRetry={() => handlePublish(a)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: '6px 32px 60px', marginTop: 18 }}>
          <ListHeaderRow />
          {visible.map((a) => (
            <ArtifactRow
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              onUpdate={handleUpdate}
              onDelete={handleTrash}
              onOpenProject={onOpenProject}
              phase={statusByPath[a.path]}
              onRetry={() => handlePublish(a)}
            />
          ))}
        </div>
      )}

      <ArtifactViewer
        open={!!viewer}
        artifact={viewer}
        onClose={() => setViewer(null)}
        onChange={updateOne}
        onDelete={removeOne}
        onPublish={handlePublish}
      />

      {publishTarget && (
        <PublishDialog
          artifact={publishTarget}
          onCancel={() => { setPublishTarget(null); settlePublish(); }}
          onConfirm={confirmPublish}
        />
      )}

      {/* Single shared menu for the whole grid — anchored to whichever
          card the user just clicked. Mounted here at the page level
          (not inside each card) so the dropdown's `position: fixed`
          stays viewport-relative regardless of card-level transforms. */}
      <HoverMenu
        open={!!menuFor}
        anchorRect={menuFor?.rect}
        onClose={() => setMenuFor(null)}
        items={(() => {
          const a = menuFor?.artifact;
          if (!a) return [];
          const isHtml = isHtmlArtifact(a);
          const isBackend = isBackendArtifact(a);
          const published = !!a.publishedUrl;
          const busyA = busyPaths.has(a.path);
          const items = [];
          if (published) {
            if (a.modified) {
              items.push({
                id: 'update',
                label: busyA ? 'Working…' : 'Update',
                icon: Ico.refresh(13),
                onClick: () => handleUpdate(a),
              });
            }
            items.push({
              id: 'unpublish',
              label: busyA ? 'Working…' : 'Unpublish',
              icon: Ico.power(13),
              onClick: () => handleUnpublish(a),
            });
          } else if (isHtml) {
            items.push({
              id: 'publish',
              label: busyA ? 'Publishing…' : 'Publish',
              icon: Ico.power(13),
              onClick: () => handlePublish(a),
            });
          }
          items.push({
            id: 'preview',
            label: 'Preview',
            icon: (Ico.eye?.(13) || Ico.sparkle(13)),
            onClick: () => setViewer(a),
          });
          // Fullstack apps can't be opened from their static entry html
          // (it needs the backend), so only offer "Open in browser" for
          // them once published — then it opens the live public URL.
          // Unpublished fullstack gets no open/reveal item.
          if (isHtml && (!isBackend || published)) {
            items.push({
              id: 'open',
              label: 'Open in browser',
              icon: (Ico.link?.(13) || Ico.globe?.(13) || Ico.doc(13)),
              onClick: () => {
                if (a.publishedUrl) {
                  try { host.openExternal(a.publishedUrl); }
                  catch { window.open(a.publishedUrl, '_blank', 'noreferrer'); }
                } else {
                  openArtifactFile(a);
                }
              },
            });
          } else if (!isBackend && !host.isWeb) {
            // Reveal hits the server's /artifacts/reveal endpoint which
            // shells out to the OS opener — meaningful only on the
            // desktop where the renderer and server share a filesystem.
            items.push({
              id: 'reveal',
              label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
              icon: Ico.folder(13),
              onClick: () => { try { revealArtifact(a.path); } catch { } },
            });
          }
          items.push({ separator: true });
          items.push({
            id: 'delete',
            label: 'Delete',
            icon: Ico.trash(13),
            danger: true,
            onClick: () => handleTrash(a),
          });
          return items;
        })()}
      />
    </div>
  );
}
