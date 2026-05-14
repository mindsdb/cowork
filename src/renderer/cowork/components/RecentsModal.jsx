// RecentsModal — opened from the sidebar's "Show more" row.
// Surfaces up to 100 of the most recent tasks with their project +
// last-active timestamp, plus a hover-only trash to delete.
//
// The sidebar's inline list is intentionally short (sized to fit the
// window height) — this modal is the escape hatch when the user
// needs to scroll back further than the inline list can show.

import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';

const FONT_BODY = "var(--font-body, 'Inter', system-ui, sans-serif)";
const FONT_MONO = "var(--font-mono, 'JetBrains Mono', monospace)";

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 172800) return 'Yesterday';
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return `${Math.floor(secs / 604800)} w ago`;
}

function Row({ task, onSelect, onDelete }) {
  const [hover, setHover] = useState(false);
  const [trashHover, setTrashHover] = useState(false);
  // The right edge holds either the time-ago OR the trash glyph —
  // never both. Same Y, same X, swapped on hover. We reserve no
  // dedicated trash column so the time stretches all the way to
  // the end of the row when idle.
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setTrashHover(false); }}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center', justifyContent: 'space-between',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 6,
        background: hover ? 'color-mix(in srgb, var(--ink) 4%, transparent)' : 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-body)',
        color: hover ? 'var(--ink)' : 'var(--ink-2)',
        transition: 'background .1s ease, color .12s ease',
      }}
    >
      <span style={{
        fontSize: 13,
        minWidth: 0, flex: 1,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {task.title || 'Untitled'}
      </span>
      {hover ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
          onMouseEnter={() => setTrashHover(true)}
          onMouseLeave={() => setTrashHover(false)}
          title="Delete this task"
          aria-label="Delete this task"
          style={{
            background: 'transparent', border: 0, padding: 0,
            display: 'inline-flex', alignItems: 'center',
            cursor: 'pointer',
            color: trashHover ? 'var(--danger)' : 'var(--ink-3)',
            transition: 'color 120ms ease',
          }}
        >
          {Ico.trash(13)}
        </button>
      ) : (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10.5,
          color: 'var(--ink-4)', letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
        }}>
          {timeAgo(task.updatedAt || task.subtitle)}
        </span>
      )}
    </div>
  );
}

// Group tasks by `projectName`. Returned groups are sorted by their
// most-recent task's updatedAt (so the group whose work is freshest
// floats to the top); within each group, tasks keep the input order
// (callers already sort by recency before passing them in).
function groupByProject(tasks) {
  const ts = (raw) => {
    if (raw == null) return 0;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  };
  const map = new Map();
  for (const task of tasks) {
    const key = task.projectName || '(no project)';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  }
  const groups = Array.from(map.entries()).map(([projectName, items]) => ({
    projectName,
    items,
    latest: Math.max(0, ...items.map((t) => ts(t.updatedAt || t.subtitle))),
  }));
  groups.sort((a, b) => b.latest - a.latest);
  return groups;
}

export default function RecentsModal({ open, onClose, tasks = [], onSelect, onDelete }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    // Focus the search input on open — frequent flow is "open ⌘K-ish, type a fragment, hit return".
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const filtered = q
    ? tasks.filter((t) => (
      (t.title || '').toLowerCase().includes(q) ||
      (t.projectName || '').toLowerCase().includes(q)
    ))
    : tasks;

  return (
    // The "modal" is a full-width drop-down panel that runs flush
    // against the left+right edges of the window. Centering it would
    // require borderRadius for legibility; here we want it to read as
    // a slab pinned in place — corners would only show if the panel
    // were inset, which it isn't.
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 95,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'stretch',
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        WebkitAppRegion: 'no-drag',
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          // Hangs from the top, full window width, capped height.
          // No radius (the panel runs edge-to-edge so corners don't
          // exist visually). Border + shadow only on the bottom — top
          // sits flush against the window chrome.
          width: '100%',
          maxHeight: 'min(560px, 86vh)',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--line)',
          borderRadius: 0,
          boxShadow: '0 14px 32px rgba(15, 16, 17, 0.22)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: FONT_BODY,
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--ink-3)' }}>{Ico.search(14)}</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recent tasks…"
            aria-label="Search recent tasks"
            style={{
              flex: 1, minWidth: 0,
              background: 'transparent', border: 0, outline: 'none',
              fontFamily: FONT_BODY, fontSize: 13.5,
              color: 'var(--ink)',
            }}
          />
          <span style={{
            fontFamily: FONT_MONO, fontSize: 10.5, color: 'var(--ink-4)',
            letterSpacing: '0.04em',
          }}>
            {filtered.length} of {tasks.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'transparent', border: 0,
              color: 'var(--ink-3)', cursor: 'pointer',
              display: 'inline-grid', placeItems: 'center',
              fontSize: 18, lineHeight: 1,
            }}
          >×</button>
        </div>

        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '8px 6px',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          {filtered.length === 0 ? (
            <div style={{
              padding: '32px 20px', textAlign: 'center',
              color: 'var(--ink-4)', fontSize: 13,
            }}>
              {q ? 'No tasks match.' : 'No recent tasks yet.'}
            </div>
          ) : (
            groupByProject(filtered).map((group) => (
              <div key={group.projectName} style={{
                display: 'flex', flexDirection: 'column', gap: 1,
                marginBottom: 6,
              }}>
                {/* Project header — small uppercase mono label with a
                    count chip. Reads as a section divider, not as a
                    clickable row, so each task underneath stays the
                    primary affordance. */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px 4px',
                  fontFamily: FONT_MONO, fontSize: 10.5,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--ink-4)',
                }}>
                  <span style={{
                    minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{group.projectName}</span>
                  <span style={{
                    flex: 1, height: 1, background: 'var(--line)',
                  }} />
                  <span style={{ color: 'var(--ink-4)' }}>{group.items.length}</span>
                </div>
                {group.items.map((t) => (
                  <Row
                    key={t.id}
                    task={t}
                    onSelect={() => { onSelect?.(t.id); onClose?.(); }}
                    onDelete={() => onDelete?.(t.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
