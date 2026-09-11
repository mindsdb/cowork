// RecentsModal — opened from the sidebar's "Show more" row.
// Surfaces up to 100 of the most recent tasks with their project +
// last-active timestamp, plus a hover-only trash to delete.
//
// The sidebar's inline list is intentionally short (sized to fit the
// window height) — this modal is the escape hatch when the user
// needs to scroll back further than the inline list can show.

import { useEffect, useRef, useState } from 'react';
import { projectLabelByName } from '../lib/projectLabel';
import Ico from './Icons';
import { Tooltip } from './ui';
import { relativeAge } from '../lib/formatTime';

function Row({ task, onSelect, onDelete }) {
  const [hover, setHover] = useState(false);
  // The right edge holds either the time-ago OR the trash glyph —
  // never both. Same Y, same X, swapped on hover. We reserve no
  // dedicated trash column so the time stretches all the way to
  // the end of the row when idle. `hover` also gates which child
  // renders, so it stays JS state (the row tint/colour ride it too).
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      className="flex items-center justify-between gap-2 py-[6px] px-[10px] rounded-[6px] cursor-pointer font-[family-name:var(--font-body)] [transition:background_.1s_ease,color_.12s_ease]"
      style={{
        background: hover ? 'color-mix(in srgb, var(--ink) 4%, transparent)' : 'transparent',
        color: hover ? 'var(--ink)' : 'var(--ink-2)',
      }}
    >
      <span className="text-[13px] min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
        {task.title || 'Untitled'}
      </span>
      {hover ? (
        <Tooltip content="Delete this task">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            aria-label="Delete this task"
            className="bg-transparent border-0 p-0 inline-flex items-center cursor-pointer text-ink-3 hover:text-danger [transition:color_120ms_ease]"
          >
            {Ico.trash(13)}
          </button>
        </Tooltip>
      ) : (
        <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.02em] whitespace-nowrap">
          {relativeAge(task.updatedAt || task.subtitle) || task.subtitle || ''}
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

export default function RecentsModal({ open, onClose, tasks = [], onSelect, onDelete, projects = [] }) {
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
      className="fixed inset-0 z-[95] flex items-start justify-stretch bg-[rgba(0,0,0,0.45)] [backdrop-filter:blur(2px)] [-webkit-backdrop-filter:blur(2px)] [-webkit-app-region:no-drag]"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        // Hangs from the top, full window width, capped height. No radius (runs
        // edge-to-edge). Border + shadow on the bottom only — top sits flush
        // against the window chrome.
        className="w-full max-h-[min(560px,86vh)] bg-surface border-b border-t-0 border-x-0 border-solid border-line rounded-none shadow-sh-popup flex flex-col overflow-hidden font-[family-name:var(--font-body)]"
      >
        <div className="flex items-center gap-[10px] py-3 px-[14px] border-b border-t-0 border-x-0 border-solid border-line">
          <span className="inline-flex text-ink-3">{Ico.search(14)}</span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recent tasks…"
            aria-label="Search recent tasks"
            className="flex-1 min-w-0 bg-transparent border-0 [outline:none] font-[family-name:var(--font-body)] text-[13.5px] text-ink"
          />
          <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4 tracking-[0.04em]">
            {filtered.length} of {tasks.length}
          </span>
          <Tooltip content="Close">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-[26px] h-[26px] rounded-[6px] bg-transparent border-0 text-ink-3 cursor-pointer inline-grid place-items-center text-[18px] leading-none"
            >×</button>
          </Tooltip>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-[6px] flex flex-col gap-1">
          {filtered.length === 0 ? (
            <div className="py-8 px-5 text-center text-ink-4 text-[13px]">
              {q ? 'No tasks match.' : 'No recent tasks yet.'}
            </div>
          ) : (
            groupByProject(filtered).map((group) => (
              <div key={group.projectName} className="flex flex-col gap-px mb-[6px]">
                {/* Project header — small uppercase mono label with a
                    count chip. Reads as a section divider, not as a
                    clickable row, so each task underneath stays the
                    primary affordance. */}
                <div className="flex items-center gap-2 pt-2 px-3 pb-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.12em] uppercase text-ink-4">
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{projectLabelByName(projects, group.projectName)}</span>
                  <span className="flex-1 h-px bg-line" />
                  <span className="text-ink-4">{group.items.length}</span>
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
