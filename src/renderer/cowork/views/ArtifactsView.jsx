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

const FONT_BODY    = "var(--font-body)";
const FONT_DISPLAY = "var(--font-display)";
const FONT_MONO    = "var(--font-mono)";

// ─── Header ──────────────────────────────────────────────────────────────

function ArtifactsHeader() {
  return (
    <div style={{
      padding: '28px 32px 0',
      display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{
          margin: 0,
          fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 600,
          letterSpacing: '-0.005em', color: 'var(--ink)',
        }}>Live artifacts</h1>
        <p style={{
          margin: 0, fontFamily: FONT_BODY, fontSize: 13.5,
          color: 'var(--ink-3)', lineHeight: 1.5,
        }}>
          Documents, dashboards, and code Anton produces. Publish HTML to share a live URL.
        </p>
      </div>
    </div>
  );
}

// ─── Filter row ──────────────────────────────────────────────────────────

function SearchInput({ value, onChange, inputRef }) {
  return (
    <div style={{
      flex: '0 1 320px', minWidth: 220,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '7px 11px', borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      <span style={{ display: 'inline-flex', flexShrink: 0, color: 'var(--ink-3)' }}>
        {Ico.search(13)}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Search artifacts"
        style={{
          flex: 1, minWidth: 0,
          background: 'transparent', border: 0, outline: 'none',
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
        }}
      />
      <span style={{
        flexShrink: 0,
        padding: '1px 5px', borderRadius: 3,
        background: 'var(--surface-3)',
        border: '1px solid var(--line-2)',
        fontFamily: FONT_MONO, fontSize: 10,
        color: 'var(--ink-4)',
      }}>⌘K</span>
    </div>
  );
}

const SORT_OPTIONS = [
  { id: 'published',   label: 'Published first' },
  { id: 'recent',      label: 'Recent' },
  { id: 'oldest',      label: 'Oldest' },
  { id: 'title',       label: 'Title (A–Z)' },
  { id: 'type',        label: 'Type' },
];

function SortPill({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = SORT_OPTIONS.find((o) => o.id === value) || SORT_OPTIONS[0];
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 11px', borderRadius: 7,
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          color: 'var(--ink-2)',
          fontFamily: FONT_BODY, fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>Sort:</span>
        <span>{current.label}</span>
        <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>
          {Ico.chevDown(11)}
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: 180, zIndex: 20,
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          padding: '4px 0',
        }}>
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => { onChange?.(opt.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center',
                width: 'calc(100% - 8px)', margin: '0 4px',
                padding: '7px 10px', borderRadius: 5,
                background: opt.id === value ? 'var(--surface-2)' : 'transparent',
                border: 0,
                fontFamily: FONT_BODY, fontSize: 12.5,
                color: 'var(--ink-2)', textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = opt.id === value ? 'var(--surface-2)' : 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }) {
  const Btn = ({ id, icon, label }) => {
    const active = value === id;
    return (
      <button
        type="button"
        onClick={() => onChange?.(id)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 5,
          background: active ? 'var(--surface-3)' : 'transparent',
          color: active ? 'var(--ink)' : 'var(--ink-3)',
          border: 0,
          boxShadow: active ? 'inset 0 0 0 1px var(--line-2)' : 'none',
          fontFamily: FONT_BODY, fontSize: 12,
          cursor: 'pointer',
          transition: 'background .15s ease, color .15s ease',
        }}
        title={label}
      >
        {icon}
        <span>{label}</span>
      </button>
    );
  };
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      padding: 2, borderRadius: 7,
      background: 'var(--surface-2)',
      border: '1px solid var(--line)',
    }}>
      <Btn id="grid" icon={Ico.grid(12)} label="Grid" />
      <Btn id="list" icon={Ico.list(12)} label="List" />
    </div>
  );
}

function FilterRow({
  search, onSearchChange, sort, onSortChange, view, onViewChange,
  total, filtered, publishedCount, searchRef,
}) {
  const filterActive = (search || '').trim().length > 0;
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'artifact' : 'artifacts'}`;
  return (
    <div style={{
      padding: '0 32px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {/* Top row — search + sort on the left, view toggle on the right */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <SearchInput value={search} onChange={onSearchChange} inputRef={searchRef} />
        <SortPill value={sort} onChange={onSortChange} />
        <span style={{ flex: 1 }} />
        <ViewToggle value={view} onChange={onViewChange} />
      </div>

      {/* Count line — independent of the controls; updates on filter */}
      <div style={{
        fontFamily: FONT_MONO, fontSize: 11,
        color: 'var(--ink-4)', letterSpacing: '0.04em',
      }}>
        {countText}
        {publishedCount > 0 && (
          <>
            {' · '}
            <span style={{ color: 'var(--accent)' }}>{publishedCount} published</span>
          </>
        )}
      </div>
    </div>
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

function isHtmlArtifact(a) {
  return (a.ext || '').toLowerCase() === '.html'
    || (a.path || '').toLowerCase().endsWith('.html');
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
        padding: '3px 8px', borderRadius: 999,
        fontSize: 10.5, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        flexShrink: 0,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        fontFamily: FONT_BODY,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 99, background: 'var(--accent)' }} />
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

function ArtifactBubble({ artifact, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish, busy }) {
  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onOpenPublished = async () => {
    if (!published) return;
    try { await window.antontron?.openExternal?.(artifact.publishedUrl); } catch {
      window.open(artifact.publishedUrl, '_blank', 'noreferrer');
    }
  };

  const Icon = iconForArtifact(artifact);
  const ext = extensionOf(artifact);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => isHtml ? onOpenViewer(artifact) : openArtifact(artifact.path)}
      onKeyDown={(e) => { if (e.key === 'Enter') (isHtml ? onOpenViewer(artifact) : openArtifact(artifact.path)); }}
      style={{
        position: 'relative',
        cursor: 'pointer',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 12,
        padding: 16,
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
      {/* Status badge — top right, same slot the preview-overlay used.
          Published wins over Live when both apply. */}
      {(published || artifact.live) && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
          pointerEvents: 'none',
        }}>
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
        </div>
      )}

      {/* Header: small inline icon + title, with `type: <ext>` mono
          subtitle directly under it. The status badge floats absolute
          at the top-right; we reserve right padding so a long title
          can't overlap it. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
        paddingRight: (published || artifact.live) ? 96 : 0,
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
        <span style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>
          type: <span style={{ color: 'var(--ink-3)' }}>{ext}</span>
        </span>
      </div>

      {/* URL pill (only when published) */}
      {published && (
        <PublishedUrlRow
          url={artifact.publishedUrl}
          onOpen={onOpenPublished}
          onCopy={onCopyUrl}
        />
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {published ? (
          <ActionButton onClick={() => doUnpublish?.(artifact)} danger title="Unpublish from Minds">
            {busy ? 'Working…' : 'Unpublish'}
          </ActionButton>
        ) : isHtml ? (
          <ActionButton onClick={() => doPublish?.(artifact)} primary title="Publish to Minds">
            {busy ? 'Publishing…' : 'Publish'}
          </ActionButton>
        ) : null}
        <ActionButton onClick={() => openArtifact(artifact.path)} title="Open file">Open</ActionButton>
        <ActionButton onClick={() => revealArtifact(artifact.path)} title="Reveal in Finder">Reveal</ActionButton>
      </div>
    </div>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Status dot · Title · Published · Kind · Project · Updated · ⋯
const LIST_GRID = '24px 2fr 100px 70px 1fr 110px 36px';

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

function RowMenu({ open, anchorRect, artifact, onClose, onOpen, onReveal, onCopyUrl, onPublish, onUnpublish }) {
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
        <>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <Item label="Unpublish" icon={Ico.trash(13)} danger onClick={onUnpublish} />
        </>
      )}
    </div>
  );
}

function ArtifactRow({ artifact, projects, onOpenViewer, onPublish: doPublish, onUnpublish: doUnpublish }) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);

  const isHtml = isHtmlArtifact(artifact);
  const published = !!artifact.publishedUrl;
  const project = projectNameOf(artifact, projects);

  const onCopyUrl = async () => {
    if (!published) return false;
    return copyText(artifact.publishedUrl);
  };
  const onRowOpen = () => {
    if (isHtml) onOpenViewer?.(artifact);
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

        <div style={{
          fontFamily: FONT_MONO, fontSize: 11,
          color: 'var(--ink-3)', letterSpacing: '0.06em', textTransform: 'uppercase',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{kindOf(artifact)}</div>

        <div style={{
          fontFamily: FONT_BODY, fontSize: 12.5,
          color: 'var(--ink-2)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{project}</div>

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
      margin: '12px 32px 0',
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

export default function ArtifactsView({ artifacts: initial = [], projects = [] }) {
  const [list, setList] = useState(initial);
  const [viewer, setViewer] = useState(null);
  const [view, setView] = useState(() =>
    localStorage.getItem('anton:artifacts-view') === 'list' ? 'list' : 'grid'
  );
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('published');
  // Per-artifact-path "in flight" set so multiple cards can publish
  // independently without freezing the whole grid.
  const [busyPaths, setBusyPaths] = useState(() => new Set());
  // Toast surfaces publish/unpublish results — primarily so failures
  // don't disappear into the console.
  const [toast, setToast] = useState(null); // { kind: 'ok'|'error', message }
  const searchRef = useRef(null);

  // Reflect prop changes (parent may refresh on stream completion).
  if (list !== initial && list.length === 0 && initial.length > 0) {
    setList(initial);
  }

  // Persist view toggle.
  useEffect(() => { localStorage.setItem('anton:artifacts-view', view); }, [view]);

  // ⌘K focuses the search input.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
  // mdb.ai, persists report_id in `.published.json`. We then reflect
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
      setToast({ kind: 'ok', message: 'Unpublished from mdb.ai.' });
    } catch (e) {
      setToast({ kind: 'error', message: `Unpublish failed: ${e?.message || e}` });
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
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
    }}>
      <ArtifactsHeader />

      <Toast
        kind={toast?.kind}
        message={toast?.message}
        onClose={() => setToast(null)}
      />

      <div style={{ height: 18 }} />

      {total > 0 && (
        <FilterRow
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          total={total}
          filtered={visible.length}
          publishedCount={publishedCount}
          searchRef={searchRef}
        />
      )}

      {total === 0 ? (
        <EmptyState />
      ) : view === 'grid' ? (
        <div style={{
          padding: '6px 32px 60px',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14,
          marginTop: 18,
        }}>
          {visible.map((a) => (
            <ArtifactBubble
              key={a.id || a.path}
              artifact={a}
              onOpenViewer={setViewer}
              onPublish={handlePublish}
              onUnpublish={handleUnpublish}
              busy={busyPaths.has(a.path)}
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
            />
          ))}
        </div>
      )}

      <ArtifactViewer
        open={!!viewer}
        artifact={viewer}
        onClose={() => setViewer(null)}
        onChange={updateOne}
      />
    </div>
  );
}
