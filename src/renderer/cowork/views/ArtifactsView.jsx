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

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import {
  openArtifact, revealArtifact,
  publishArtifact, unpublishArtifact,
} from '../api';
import { copyText } from '../lib/clipboard';
import { ArtifactViewer } from '../components/artifact';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  ViewToggle,
  HoverMenu,
  useCollectionShortcut,
} from '../components/collection';
import { host } from '../../platform/host';
import { useBreakpoint } from '../hooks/useBreakpoint';

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO    = "var(--font-mono)";

const EMPTY_ARTIFACTS = [];

// Sort options for the artifacts collection. Per-page (publishing
// state isn't relevant to other collections).
const SORT_OPTIONS = [
  { id: 'published',   label: 'Published first' },
  { id: 'recent',      label: 'Recent' },
  { id: 'oldest',      label: 'Oldest' },
  { id: 'title',       label: 'Title (A–Z)' },
  { id: 'type',        label: 'Type' },
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

function isHtmlArtifact(a) {
  return (a.ext || '').toLowerCase() === '.html'
    || (a.path || '').toLowerCase().endsWith('.html');
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

function PublishedPill() {
  return (
    <span
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
      <span style={{ width: 4, height: 4, borderRadius: 99, background: 'var(--accent)' }} />
      Published
    </span>
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
      }}>{path}</span>
    </div>
  );
}

function ArtifactBubble({ artifact, projects = [], onOpenViewer, onMenuOpen, isMenuOpen, busy, onOpenProject }) {
  const isHtml = isHtmlArtifact(artifact);
  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;

  const [hover, setHover] = useState(false);
  const kebabRef = useRef(null);

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onOpenPublished = async () => {
    if (!published) return;
    try { await host.openExternal(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };

  const Icon = iconForArtifact(artifact);
  const ext = extensionOf(artifact);
  const projectLabel = projectNameOf(artifact, projects);
  // The project the artifact belongs to. When resolved, the project
  // label becomes a clickable affordance (renders as a button) that
  // navigates the user to that project's detail page.
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

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => canPreview ? onOpenViewer(artifact) : openArtifact(artifact.path)}
      onKeyDown={(e) => { if (e.key === 'Enter') (canPreview ? onOpenViewer(artifact) : openArtifact(artifact.path)); }}
      style={{
        position: 'relative',
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        // Card geometry matches ProjectCard so the two grids feel
        // like the same family: 10px radius, 14/16 padding, 120 min
        // height, 10px column gap.
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'border-color 160ms ease, box-shadow 200ms ease, transform 160ms ease',
        boxShadow: '0 1px 0 rgba(15,16,17,0.02)',
        minHeight: 120,
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
      {/* Top-right cluster: status pill (left) + hover-revealed
          kebab (right). The kebab is always rightmost so the user's
          eye finds it in the same place regardless of pill state.
          We toggle `visibility` (not display/opacity-without-space)
          so the pill keeps its X position whether the kebab is
          showing or not. */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        display: 'flex', alignItems: 'center', gap: 6,
        zIndex: 2,
      }}>
        {(published || artifact.live) && (
          <span style={{ pointerEvents: 'none' }}>
            {published ? <PublishedPill /> : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontFamily: FONT_BODY, fontSize: 11,
                color: 'var(--accent)', fontWeight: 500,
                border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
                padding: '3px 8px', borderRadius: 999,
              }}>
                <span className="pulse-dot" style={{
                  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
                }} />
                Live
              </span>
            )}
          </span>
        )}
        <button
          ref={kebabRef}
          type="button"
          aria-label="Artifact menu"
          title="More actions"
          // Stop propagation on BOTH mousedown and click — the card
          // itself is a click-able role="button" that opens the
          // artifact, and a single `e.stopPropagation()` inside
          // onClick wasn't reliably preventing the parent handler in
          // every state (e.g. when the kebab was rendered while
          // visibility was just transitioning).
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); openMenu(e); }}
          style={{
            width: 26, height: 26, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            color: 'var(--ink-3)',
            background: 'transparent', border: 0, padding: 0,
            cursor: 'pointer',
            visibility: (hover || isMenuOpen) ? 'visible' : 'hidden',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'var(--surface-2)';
            e.currentTarget.style.color = 'var(--ink)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-3)';
          }}
        >
          {Ico.moreVert(14)}
        </button>
      </div>

      {/* Header: small inline icon + title, with `type: <ext>` mono
          subtitle directly under it. The kebab + status badge cluster
          floats absolute at the top-right; we reserve right padding
          so a long title can't overlap them. The kebab is always
          there in layout (even when hidden) so the padding doesn't
          jump on hover. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
        paddingRight: (published || artifact.live) ? 110 : 40,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, minWidth: 0,
        }}>
          <span style={{
            display: 'inline-flex', flexShrink: 0,
            color: 'var(--ink-3)',
          }}>
            {/* Icons take size as a positional arg — calling
                `Icon(14)` returns the rendered SVG at the right size.
                The earlier `<Icon size={20} />` was rendering each
                glyph at its 100%-width fallback (huge). */}
            {Icon(14)}
          </span>
          <span style={{
            fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
            color: 'var(--ink)', minWidth: 0, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{artifact.title}</span>
        </div>
        {/* Description — agent-supplied at create_artifact time. Two-
            line clamp keeps the card height stable across artifacts
            with short and long descriptions; the full text is in the
            modal viewer. */}
        {artifact.description && (
          <span
            title={artifact.description}
            style={{
              fontFamily: FONT_BODY, fontSize: 12, color: 'var(--ink-3)',
              lineHeight: 1.4,
              display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2,
              overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {artifact.description}
          </span>
        )}
        {/* project: <name> — sits above the type line so the workspace
            origin reads first. Ellipsis-truncates so a long project
            name can't push the card out of grid alignment; full name
            is in `title` for hover. */}
        <span
          title={projectLabel}
          style={{
            fontFamily: FONT_MONO, fontSize: 11,
            color: 'var(--ink-4)', letterSpacing: '0.04em',
            display: 'flex', alignItems: 'baseline', gap: 4,
            minWidth: 0,
          }}
        >
          <span style={{ flexShrink: 0 }}>project:</span>
          {canOpenProject ? (
            <button
              type="button"
              // Same mousedown+click+keydown hardening the list row uses —
              // the grid card's outer `<div role="button">` opens the
              // artifact viewer, and we don't want the project click
              // to fall through to that.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenProject(projectMatch);
                }
              }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-3)', minWidth: 0, flex: '0 1 auto',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-3)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{projectLabel}</button>
          ) : (
            <span style={{
              color: 'var(--ink-3)', minWidth: 0, flex: '0 1 auto',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{projectLabel}</span>
          )}
        </span>
        {/* type line — prefer the artifact's declared `type` (e.g.
            `html-app`, `fullstack-stateless-app`) since that's the
            metadata's source of truth; fall back to the bare
            extension for legacy artifacts that predate the rename.
            file-count chip surfaces multi-file artifacts at a glance
            without competing with the title for space. */}
        <span style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
          display: 'flex', alignItems: 'baseline', gap: 8,
          minWidth: 0,
        }}>
          <span>
            type: <span style={{ color: 'var(--ink-3)' }}>{artifact.type || ext}</span>
          </span>
          {typeof artifact.fileCount === 'number' && artifact.fileCount > 1 && (
            <span title={`${artifact.fileCount} files in this artifact`}>
              · <span style={{ color: 'var(--ink-3)' }}>{artifact.fileCount} files</span>
            </span>
          )}
        </span>
      </div>

      {/* Surface the public URL when published; fall back to the
          local path (ellipsis-truncated) when not — every card now
          shows where the artifact actually lives. */}
      {published ? (
        <PublishedUrlRow
          url={artifact.publishedUrl}
          onOpen={onOpenPublished}
          onCopy={onCopyUrl}
        />
      ) : (
        <LocalPathRow path={artifact.path} />
      )}

      {/* Spacer pushes the meta + actions to the bottom of the card so
          the layout stays stable across cards of varying state. */}
      <div style={{ flex: 1 }} />

      <div style={{
        fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.04em',
        color: 'var(--ink-4)',
      }}>
        {artifact.updated || '—'}
      </div>
      {/* The shared HoverMenu lives at the page level (parent
          owns the menu state) — see the comment on
          components/collection/HoverMenu for why this matters. */}
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Status dot · Title · Published · Type · Kind · Project · Updated · ⋯
//
// `Type` is the bare file extension (html, csv, png, …) and lives
// before `Kind` (the broader category — Dashboard, Data, Image, …)
// so the at-a-glance scan reads from concrete to abstract.
const LIST_GRID = '24px 2fr 100px 60px 70px 1fr 110px 36px';

function ListHeaderRow() {
  const Cell = ({ children, align }) => (
    <div style={{
      fontFamily: FONT_MONO, fontSize: 10.5,
      color: 'var(--ink-4)', letterSpacing: '0.10em',
      textTransform: 'uppercase',
      textAlign: align || 'left',
    }}>{children}</div>
  );
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
      padding: '10px 14px',
      borderBottom: '1px solid var(--line)',
    }}>
      <Cell />
      <Cell>Title</Cell>
      <Cell>Published</Cell>
      <Cell>Type</Cell>
      <Cell>Kind</Cell>
      <Cell>Project</Cell>
      <Cell>Updated</Cell>
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

function RowMenu({ open, anchorRect, artifact, onClose, onOpen, onReveal, onCopyUrl, onPublish, onUnpublish, onDelete }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) onClose?.(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open || !anchorRect) return null;

  const W = 200;
  const left = Math.min(window.innerWidth - W - 8, Math.max(8, anchorRect.right - W));
  const top = anchorRect.bottom + 4;
  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;

  const Item = ({ label, icon, onClick, danger }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); onClose?.(); }}
      style={{
        width: 'calc(100% - 8px)', margin: '0 4px',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 5,
        background: 'transparent', border: 0,
        fontFamily: FONT_BODY, fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--ink-2)',
        textAlign: 'left',
        cursor: 'pointer',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.background = danger
          ? 'color-mix(in srgb, var(--danger) 12%, transparent)'
          : 'var(--surface-2)';
      }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0, color: danger ? 'var(--danger)' : 'var(--ink-3)' }}>{icon}</span>}
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', top, left, zIndex: 60,
        width: W,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 8,
        boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
        padding: '4px 0',
        WebkitAppRegion: 'no-drag',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <Item label={isHtml ? 'Open viewer' : 'Open'} icon={Ico.externalLink(13)} onClick={onOpen} />
      <Item label="Reveal in Finder" icon={Ico.folder(13)} onClick={onReveal} />
      {published && <Item label="Copy URL" icon={Ico.copy(13)} onClick={onCopyUrl} />}
      {isHtml && !published && (
        <Item label="Publish" icon={Ico.upload(13)} onClick={onPublish} />
      )}
      {published && (
        <Item label="Unpublish" icon={Ico.upload(13)} onClick={onUnpublish} />
      )}
      {/* Delete sits at the bottom under a divider so it reads as a
          terminal / destructive action distinct from the rest of
          the menu. Routes through the parent's `handleTrash` which
          uses Electron's `shell.trashItem` — the file goes to the
          OS Trash, not unlinked, so the action is recoverable. */}
      {onDelete && (
        <>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <Item label="Delete artifact" icon={Ico.trash(13)} danger onClick={onDelete} />
        </>
      )}
    </div>
  );
}

function ArtifactRow({ artifact, projects, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish, onDelete: doDelete, onOpenProject }) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);

  const isHtml = isHtmlArtifact(artifact);
  const canPreview = isInlinePreviewable(artifact);
  const published = !!artifact.publishedUrl;
  const project = projectNameOf(artifact, projects);
  const projectMatch = projectOf(artifact, projects);
  const canOpenProject = !!(projectMatch && typeof onOpenProject === 'function');

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onRowOpen = () => {
    if (canPreview) onOpenViewer?.(artifact);
    else openArtifact(artifact.path);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onRowOpen}
        onKeyDown={(e) => { if (e.key === 'Enter') onRowOpen(); }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
          padding: '12px 14px',
          background: hover ? 'var(--surface)' : 'transparent',
          borderBottom: '1px solid var(--line)',
          cursor: 'pointer',
          transition: 'background .12s ease',
          alignItems: 'center',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <StatusDot artifact={artifact} />
        </div>

        <div style={{
          fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
          color: 'var(--ink)', minWidth: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{artifact.title}</div>

        {/* Published column — pill when published, Live indicator when
            actively streaming, em-dash for plain local artifacts. Keeps
            the column width fixed so rows align cleanly. */}
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {published ? (
            <PublishedPill />
          ) : artifact.live ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontFamily: FONT_BODY, fontSize: 11, color: 'var(--accent)', fontWeight: 500,
              flexShrink: 0,
            }}>
              <span className="pulse-dot" style={{
                width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)',
              }} />
              Live
            </span>
          ) : (
            <span style={{ color: 'var(--ink-5)', fontFamily: FONT_MONO, fontSize: 11 }}>—</span>
          )}
        </div>

        {/* Type — prefer the metadata-declared `type` (html-app,
            fullstack-stateless-app, …); fall back to the primary
            file's extension for legacy artifacts. Mono + uppercase
            so it reads as a tag rather than a label. */}
        <div
          title={artifact.type || extensionOf(artifact)}
          style={{
            fontFamily: FONT_MONO, fontSize: 11,
            color: 'var(--ink-4)', letterSpacing: '0.06em', textTransform: 'uppercase',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >{artifact.type || extensionOf(artifact)}</div>

        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{kindOf(artifact)}</div>

        <div style={{
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          minWidth: 0,
        }}>
          {canOpenProject ? (
            <button
              type="button"
              // Stop propagation on BOTH mousedown and click — the
              // surrounding row is a `role="button"` whose onClick
              // opens the artifact, and a single onClick stopPropagation
              // wasn't reliably preventing the row handler from firing
              // first. Same defensive pattern the kebab uses.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onOpenProject(projectMatch); }}
              onKeyDown={(e) => {
                // Block keyboard Enter / Space from also bubbling to
                // the row's `onKeyDown` (which would re-open the
                // artifact). Activates the navigation in-place.
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onOpenProject(projectMatch);
                }
              }}
              title={`Open ${projectMatch.name}`}
              style={{
                all: 'unset', cursor: 'pointer',
                color: 'var(--ink-2)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                maxWidth: '100%', display: 'inline-block',
                transition: 'color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = 'var(--accent)';
                e.currentTarget.style.textDecoration = 'underline';
                e.currentTarget.style.textUnderlineOffset = '2px';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = 'var(--ink-2)';
                e.currentTarget.style.textDecoration = 'none';
              }}
            >{project}</button>
          ) : project}
        </div>

        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>{artifact.updated || '—'}</div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAnchorRect(triggerRef.current?.getBoundingClientRect() || null);
              setMenuOpen(true);
            }}
            aria-label="Artifact menu"
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              opacity: hover || menuOpen ? 1 : 0,
              display: 'inline-grid', placeItems: 'center',
              cursor: 'pointer',
              transition: 'opacity .15s ease, color .15s ease, background .15s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
          >
            {Ico.moreVert(15)}
          </button>
        </div>
      </div>

      <RowMenu
        open={menuOpen}
        anchorRect={anchorRect}
        artifact={artifact}
        onClose={() => setMenuOpen(false)}
        onOpen={onRowOpen}
        onReveal={() => revealArtifact(artifact.path)}
        onCopyUrl={onCopyUrl}
        onPublish={() => doPublish?.(artifact)}
        onUnpublish={() => doUnpublish?.(artifact)}
        onDelete={doDelete ? () => doDelete(artifact) : undefined}
      />
    </>
  );
}

// ─── Empty state ─────────────────────────────────────────────────────────

function EmptyState() {
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
        When Anton creates documents, dashboards, or code outputs they'll appear here.
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

export default function ArtifactsView({ artifacts: initial = EMPTY_ARTIFACTS, projects = [], onOpenProject }) {
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

  // Centralized publish — single source of truth for state updates,
  // toast dispatch, and busy bookkeeping. Mirrors anton's /publish
  // command flow: POST → server zips, scrubs credentials, uploads to
  // MindsHub, persists report_id in `.published.json`. We then reflect
  // the returned URL into the local list so the UI flips to "Published"
  // without a refetch.
  const handlePublish = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    if (!isHtmlArtifact(artifact)) {
      setToast({ kind: 'error', message: 'Only HTML artifacts can be published.' });
      return;
    }
    setBusy(artifact.path, true);
    try {
      const r = await publishArtifact(artifact.path);
      if (r?.url) {
        updateOne({ ...artifact, publishedUrl: r.url });
        setToast({ kind: 'ok', message: `Published — ${r.url}` });
      } else {
        setToast({ kind: 'error', message: 'Publish returned no URL.' });
      }
    } catch (e) {
      const msg = e?.message || String(e);
      // Map the most common failure to a clearer next step.
      const friendly = /minds_api_key/i.test(msg) || /minds api key/i.test(msg)
        ? 'Set your Minds API key in Settings to publish artifacts.'
        : `Publish failed: ${msg}`;
      setToast({ kind: 'error', message: friendly });
    } finally {
      setBusy(artifact.path, false);
    }
  };

  const handleUnpublish = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    try {
      await unpublishArtifact(artifact.path);
      updateOne({ ...artifact, publishedUrl: '' });
      setToast({ kind: 'ok', message: 'Unpublished from MindsHub.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Unpublish failed: ${e?.message || e}` });
    } finally {
      setBusy(artifact.path, false);
    }
  };

  // Move the file to the OS Trash and drop it from the local list.
  // Reuses the Electron `shell.trashItem` IPC the artifact viewer
  // also calls, so the deletion is reversible from the user's
  // Trash / Recycle Bin (no extra confirm modal needed).
  const handleTrash = async (artifact) => {
    if (!artifact?.path || busyPaths.has(artifact.path)) return;
    setBusy(artifact.path, true);
    try {
      const result = await host.trashItem(artifact.path);
      if (result && result.ok === false) {
        throw new Error(result.reason || 'Could not move to Trash.');
      }
      removeOne(artifact.path);
      setToast({ kind: 'ok', message: 'Moved to Trash.' });
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
        case 'recent':    return timestampOf(b) - timestampOf(a);
        case 'oldest':    return timestampOf(a) - timestampOf(b);
        case 'title':     return (a.title || '').localeCompare(b.title || '');
        case 'type':      return kindOf(a).localeCompare(kindOf(b));
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
    }}>
      <PageHeader
        title="Live Artifacts"
        subtitle="Documents, dashboards, and code Anton produces. Publish to share a live URL."
        // 20px below the subtitle text so the page reads with a
        // little air before the search-row begins. The 20px spacer
        // below the header still adds the standard between-section
        // rhythm — together they make Live Artifacts breathe a touch
        // more than other collection pages, where the action button
        // already anchors the lower edge of the header.
        subtitleBottom={20}
      />

      {/* Toast floats over the page so it can't perturb the
          subtitle → search spacing. */}
      <div style={{
        position: 'fixed', top: 24, right: 32, zIndex: 70,
        pointerEvents: toast?.message ? 'auto' : 'none',
        maxWidth: 420,
      }}>
        <Toast
          kind={toast?.kind}
          message={toast?.message}
          onClose={() => setToast(null)}
        />
      </div>

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
          view={<span className="artifacts-view-toggle"><ViewToggle value={view} onChange={setView} /></span>}
          counts={
            <ArtifactsCounts
              search={search}
              total={total}
              filtered={visible.length}
              publishedCount={publishedCount}
            />
          }
        />
      )}

      {total === 0 ? (
        <EmptyState />
      ) : effectiveView === 'grid' ? (
        <div className="artifacts-grid" style={{
          padding: '6px 32px 60px',
          // Same grid geometry as ProjectsView so cards line up at
          // the same density across pages.
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14,
          marginTop: 18,
        }}>
          {visible.map((a) => (
            <ArtifactBubble
              key={a.id || a.path}
              artifact={a}
              projects={projects}
              onOpenViewer={setViewer}
              onMenuOpen={(art, rect) => setMenuFor({ artifact: art, rect })}
              isMenuOpen={menuFor?.artifact?.path === a.path}
              busy={busyPaths.has(a.path)}
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
              // host.trashItem is Electron-only — gate the delete
              // option to native runs so the web shell doesn't show
              // a menu item that wouldn't work.
              onDelete={!host.isWeb ? handleTrash : undefined}
              onOpenProject={onOpenProject}
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
      />

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
          const published = !!a.publishedUrl;
          const busyA = busyPaths.has(a.path);
          const items = [];
          if (published) {
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
          if (isHtml) {
            items.push({
              id: 'open',
              label: 'Open in browser',
              icon: (Ico.link?.(13) || Ico.globe?.(13) || Ico.doc(13)),
              onClick: () => {
                if (a.publishedUrl) {
                  try { host.openExternal(a.publishedUrl); }
                  catch { window.open(a.publishedUrl, '_blank', 'noreferrer'); }
                } else {
                  openArtifact(a.path);
                }
              },
            });
          } else if (!host.isWeb) {
            // Reveal hits the server's /artifacts/reveal endpoint which
            // shells out to the OS opener — meaningful only on the
            // desktop where the renderer and server share a filesystem.
            items.push({
              id: 'reveal',
              label: isMacPlatform ? 'Show in Finder' : 'Show in Explorer',
              icon: Ico.folder(13),
              onClick: () => { try { revealArtifact(a.path); } catch {} },
            });
          }
          // Delete uses host.trashItem (OS Trash) — no equivalent in web.
          if (!host.isWeb) {
            items.push({ separator: true });
            items.push({
              id: 'delete',
              label: 'Delete',
              icon: Ico.trash(13),
              danger: true,
              onClick: () => handleTrash(a),
            });
          }
          return items;
        })()}
      />
    </div>
  );
}
