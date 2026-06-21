// StoryRail.jsx — M4 unified "Story" rail for the redesigned artifact workspace.
//
// One timeline that fuses chat + versions + reviews + AI edits + system events,
// with filter chips, event COALESCING (so the rail never becomes noise), and a
// bottom composer. Self-contained: renders standalone with the mock `events`
// default below. All data/actions flow through props — no fetching here.
//
// House rules: React 19 function components + hooks, inline styles w/ CSS vars,
// no new deps. Global @keyframes (popIn / slideIn / riseIn …) are owned by a
// sibling redesign.css — referenced here by name, never redefined.

import React, { useState, useMemo, useCallback } from 'react';
import {
  getStoryKind,
  STORY_FILTERS,
  eventMatchesFilter,
  countEventsByFilter,
} from './storyEventKinds';

const STORY_RAIL_WIDTH = 332;
const AI_GRADIENT = 'linear-gradient(135deg,#A78BFA,#22D3EE)';

/* ------------------------------------------------------------------ *
 * Mock data — 9 events mixing all kinds. Includes the graceful
 * failure/recovery system entry and a run of low-signal events
 * (consecutive "preview ready" + tiny ai-edits) so coalescing is
 * visible the moment the rail mounts alone.
 * ------------------------------------------------------------------ */
export const MOCK_STORY_EVENTS = [
  {
    id: 'e1',
    kind: 'comment',
    author: { name: 'You', initials: 'JL', color: '#2a3957' },
    title: 'tightened the headline',
    body: 'Cut it from 14 words to 7 — reads punchier now.',
    when: '2m ago',
  },
  {
    id: 'e2',
    kind: 'comment',
    author: { name: 'Devin', initials: 'DP', color: '#3a4d6e' },
    title: 'commented on the chart',
    body: 'Can we annotate the Q3 spike? @Maya',
    when: '12m ago',
  },
  // --- run of low-signal system events → coalesces into one row ---
  {
    id: 'e3a',
    kind: 'system',
    author: { name: 'Anton', initials: '', color: 'var(--accent-bg)', isAI: true },
    title: 'preview ready',
    when: '20m ago',
  },
  {
    id: 'e3b',
    kind: 'system',
    author: { name: 'Anton', initials: '', color: 'var(--accent-bg)', isAI: true },
    title: 'preview ready',
    when: '22m ago',
  },
  {
    id: 'e3c',
    kind: 'system',
    author: { name: 'Anton', initials: '', color: 'var(--accent-bg)', isAI: true },
    title: 'preview ready',
    when: '24m ago',
  },
  {
    id: 'e4',
    kind: 'ai-edit',
    author: { name: 'Anton', initials: '', color: 'var(--accent-bg)', isAI: true },
    title: 'created v6 from Q3 actuals',
    body: '"Pull the latest revenue figures into the summary"',
    when: '1h ago',
    meta: { version: 6 },
  },
  // --- graceful failure / recovery (required) ---
  {
    id: 'e5',
    kind: 'system',
    author: { name: 'Anton', initials: '!', color: 'rgba(248,113,113,.2)', isAI: false },
    title: 'lost connection · retried · nothing lost',
    body: 'Reconnected automatically after 2s — your draft was safe the whole time.',
    when: '1h ago',
    meta: { tone: 'recovered' },
  },
  {
    id: 'e6',
    kind: 'review',
    author: { name: 'Maya', initials: 'MC', color: '#3a4d6e' },
    title: 'approved v5 for the launch deck',
    body: 'Looks great. Ship it. ✦',
    when: '3h ago',
  },
  {
    id: 'e7',
    kind: 'version',
    author: { name: 'You', initials: 'JL', color: '#2a3957' },
    title: 'restored v3 as v4 — earlier drafts kept',
    when: '5h ago',
    meta: { version: 4 },
  },
  {
    id: 'e8',
    kind: 'chat',
    author: { name: 'You', initials: 'JL', color: '#2a3957' },
    title: 'asked Anton to warm up the CTA',
    body: '"Make the closing call-to-action friendlier"',
    when: '6h ago',
  },
  {
    id: 'e9',
    kind: 'system',
    author: { name: 'You', initials: 'JL', color: '#2a3957' },
    title: 'started this artifact',
    when: '2d ago',
  },
];

/* ------------------------------------------------------------------ *
 * Coalescing — collapse consecutive same-kind LOW-SIGNAL events into a
 * single expandable group row ("N preview updates"). High-signal kinds
 * (chat / version / comment / review) are never merged. A group only
 * forms at 2+ in a row; a lone low-signal event stays a normal row.
 *
 * Returns a flat list of render-nodes:
 *   { type:'single', event }
 *   { type:'group', kind, label, count, events, when }   // collapsible
 * ------------------------------------------------------------------ */
function coalesce(events) {
  const out = [];
  let i = 0;
  while (i < events.length) {
    const ev = events[i];
    const meta = getStoryKind(ev.kind);
    if (meta.signal === 'low') {
      // gather the consecutive same-kind run
      let j = i + 1;
      while (j < events.length && events[j].kind === ev.kind) j++;
      const run = events.slice(i, j);
      if (run.length >= 2) {
        out.push({
          type: 'group',
          id: `grp-${ev.id}`,
          kind: ev.kind,
          label: meta.label,
          count: run.length,
          events: run,
          when: run[0].when, // newest in the run leads
        });
        i = j;
        continue;
      }
    }
    out.push({ type: 'single', id: ev.id, event: ev });
    i += 1;
  }
  return out;
}

// Plain-language summary for a collapsed group row, e.g. "3 preview updates".
function groupSummary(node) {
  const { kind, count, events } = node;
  if (kind === 'system') {
    // Use the shared leading title when the run is homogeneous.
    const sameTitle = events.every((e) => e.title === events[0].title);
    if (sameTitle) return `${count} × ${events[0].title}`;
    return `${count} system updates`;
  }
  if (kind === 'ai-edit') return `${count} quick AI edits`;
  return `${count} ${node.label.toLowerCase()}`;
}

/* ------------------------------- Avatar ------------------------------ */
function Avatar({ author }) {
  const isAI = !!author.isAI;
  const background = isAI ? AI_GRADIENT : author.color || 'var(--surface-3)';
  const label = author.initials || (isAI ? 'A' : (author.name || '?').slice(0, 1));
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        zIndex: 1,
        fontSize: 9,
        fontWeight: 700,
        color: isAI ? '#04121a' : 'var(--ink, #F2F6FF)',
        // ring the node in the surface color so the spine reads "behind" it
        boxShadow: '0 0 0 3px var(--surface)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {label}
    </div>
  );
}

/* ----------------------- Pending inline-diff mirror ---------------------- */
function PendingDiffCard({ diff, onKeep, onUndo }) {
  if (!diff) return null;

  const oldText = diff.oldText ?? diff.old ?? '';
  const newText = diff.newText ?? diff.new ?? '';
  const instruction = diff.instruction ?? diff.prompt ?? diff.lastPrompt ?? '';
  const title = diff.title ?? 'Anton proposed an edit';
  const keep = diff.onKeep ?? onKeep;
  const undo = diff.onUndo ?? onUndo;
  const showControls = !!(keep || undo);

  return (
    <div
      style={{
        background: 'linear-gradient(120deg,rgba(167,139,250,.10),rgba(34,211,238,.06))',
        border: '1px solid var(--accent)',
        borderRadius: 12,
        padding: 12,
        marginBottom: 14,
        animation: 'popIn .3s ease',
        boxShadow: '0 0 0 4px rgba(34,211,238,.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, minWidth: 0 }}>
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: AI_GRADIENT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            color: '#04121a',
            flexShrink: 0,
          }}
        >
          A
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.35 }}>
          {title}
        </span>
      </div>

      {instruction ? (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 7, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
          You asked: &quot;{instruction}&quot;
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        {oldText ? (
          <span
            style={{
              fontSize: 12,
              background: 'var(--diff-del)',
              color: '#fca5a5',
              borderRadius: 5,
              padding: '3px 7px',
              textDecoration: 'line-through',
              textDecorationColor: 'rgba(248,113,113,.7)',
              maxWidth: '100%',
              overflowWrap: 'anywhere',
            }}
          >
            {oldText}
          </span>
        ) : null}
        {newText ? (
          <span
            style={{
              fontSize: 12,
              background: 'var(--diff-add)',
              color: '#86efac',
              borderRadius: 5,
              padding: '3px 7px',
              maxWidth: '100%',
              overflowWrap: 'anywhere',
              animation: 'diffGlow 1.2s ease',
            }}
          >
            {newText}
          </span>
        ) : null}
      </div>

      {showControls ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
          {keep ? (
            <button
              type="button"
              onClick={keep}
              className="rd-no-truncate"
              style={{
                height: 26,
                padding: '0 12px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--success)',
                color: '#04150a',
                fontSize: 11.5,
                fontWeight: 600,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
              }}
            >
              Keep
            </button>
          ) : null}
          {undo ? (
            <button
              type="button"
              onClick={undo}
              className="rd-no-truncate"
              style={{
                height: 26,
                padding: '0 12px',
                borderRadius: 6,
                border: '1px solid var(--line-2)',
                background: 'transparent',
                color: 'var(--ink-3)',
                fontSize: 11.5,
                fontFamily: 'var(--font-body)',
                cursor: 'pointer',
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------- Action button (Resolve / Dismiss / Fix) ---------- */
// A compact button for the comment/review action row. `variant` picks the
// treatment: 'ghost' (Resolve/Dismiss) or 'ai' (Fix with AI, gradient-tinted).
function RowActionButton({ label, onClick, variant = 'ghost' }) {
  const ai = variant === 'ai';
  return (
    <button
      type="button"
      onClick={onClick}
      className="rd-no-truncate"
      style={{
        height: 24,
        padding: '0 10px',
        borderRadius: 6,
        border: ai ? '1px solid var(--accent)' : '1px solid var(--line-2)',
        background: ai ? 'var(--accent-bg)' : 'transparent',
        color: ai ? 'var(--accent)' : 'var(--ink-3)',
        fontSize: 11,
        fontWeight: ai ? 600 : 500,
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

/* --------------------------- A single row ---------------------------- */
function StoryRow({ event, onResolveEvent, onDismissEvent, onFixEvent }) {
  const recovered = event?.meta?.tone === 'recovered';

  // Comment & review rows are the actionable ones: full body (no truncation)
  // plus a Resolve / Dismiss / Fix-with-AI action row.
  const isActionable = event.kind === 'comment' || event.kind === 'review';
  const resolved = !!(event?.meta?.resolved || event?.resolved);
  const dismissed = !!event?.meta?.dismissed;
  const settled = resolved || dismissed; // visually dimmed, Resolve/Dismiss hidden

  // Resolve/Dismiss disappear once settled; Fix-with-AI may still be useful.
  const showResolve = isActionable && !settled && !!onResolveEvent;
  const showDismiss = isActionable && !settled && !!onDismissEvent;
  const showFix = isActionable && !!onFixEvent;
  const showActions = showResolve || showDismiss || showFix;

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        paddingBottom: 16,
        position: 'relative',
        opacity: settled ? 0.55 : 1,
      }}
    >
      <Avatar author={event.author} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{event.author.name}</span>{' '}
          {event.title}
          {settled ? (
            <span
              style={{
                marginLeft: 6,
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: '.04em',
                textTransform: 'uppercase',
                color: resolved ? 'var(--success)' : 'var(--ink-4)',
                border: `1px solid ${resolved ? 'var(--success)' : 'var(--line-2)'}`,
                borderRadius: 5,
                padding: '1px 5px',
                whiteSpace: 'nowrap',
              }}
            >
              {resolved ? 'Resolved' : 'Dismissed'}
            </span>
          ) : null}
        </div>
        {event.body ? (
          <div
            style={{
              fontSize: 11.5,
              // recovery rows lean on --success so a failure reads as "handled"
              color: recovered ? 'var(--success)' : 'var(--ink-3)',
              lineHeight: 1.5,
              marginTop: 2,
              // comment/review bodies show in full; never clamp them
              overflowWrap: 'anywhere',
              whiteSpace: isActionable ? 'pre-wrap' : undefined,
            }}
          >
            {event.body}
          </div>
        ) : null}
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--ink-4)',
            marginTop: 3,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {event.when}
        </div>
        {showActions ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {showResolve ? (
              <RowActionButton label="Resolve" onClick={() => onResolveEvent(event)} />
            ) : null}
            {showDismiss ? (
              <RowActionButton label="Dismiss" onClick={() => onDismissEvent(event)} />
            ) : null}
            {showFix ? (
              <RowActionButton label="Fix with AI" variant="ai" onClick={() => onFixEvent(event)} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ----------------- A collapsed/expandable group row ------------------ */
function StoryGroup({ node }) {
  const [open, setOpen] = useState(false);
  const kindMeta = getStoryKind(node.kind);
  return (
    <div style={{ paddingBottom: 16, position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-body)',
        }}
      >
        {/* stacked-glyph node standing in for "several events" */}
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--surface-2)',
            border: '1px solid var(--line-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            zIndex: 1,
            fontSize: 9,
            fontWeight: 700,
            color: kindMeta.accentColor,
            boxShadow: '0 0 0 3px var(--surface)',
          }}
        >
          {kindMeta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{groupSummary(node)}</span>{' '}
            <span style={{ color: 'var(--ink-4)' }}>{open ? 'hide' : 'show'}</span>
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--ink-4)',
              marginTop: 3,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {node.when}
          </div>
        </div>
      </button>

      {open ? (
        <div
          style={{
            marginTop: 10,
            marginLeft: 32, // align under the text column, clear of the spine
            paddingLeft: 12,
            borderLeft: '1.5px solid var(--line-2)',
            animation: 'riseIn .2s ease',
          }}
        >
          {node.events.map((e) => (
            <div key={e.id} style={{ paddingBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>
                <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{e.author.name}</span>{' '}
                {e.title}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: 'var(--ink-4)',
                  marginTop: 2,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {e.when}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Filter chip --------------------------- */
// A segment inside the filter track. `active` fills it with --accent-bg; the
// rest read as quiet ghosts. `count` is appended as a dimmed badge so it's
// obvious each chip is a filtered view of the same feed (e.g. "Versions 2").
function FilterChip({ chip, active, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rd-no-truncate"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 10px',
        borderRadius: 6,
        border: '1px solid transparent',
        background: active ? 'var(--accent-bg)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-3)',
        fontSize: 11.5,
        fontWeight: active ? 600 : 500,
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
        transition: 'background .12s ease, color .12s ease',
      }}
    >
      <span>{chip.label}</span>
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          color: active ? 'var(--accent)' : 'var(--ink-4)',
          opacity: active ? 0.85 : 0.7,
        }}
      >
        {count}
      </span>
    </button>
  );
}

/* ------------------------------ Collapsed handle ---------------------- */
function CollapsedHandle({ onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label="Open Story"
      className="rd-no-truncate"
      style={{
        position: 'absolute',
        right: 12,
        top: 'calc(var(--rd-topbar-height, 50px) + 14px)',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        height: 34,
        padding: '0 13px',
        borderRadius: 9,
        border: '1px solid var(--line-2)',
        background: 'var(--surface)',
        color: 'var(--ink-2)',
        fontSize: 12,
        fontWeight: 500,
        fontFamily: 'var(--font-body)',
        cursor: 'pointer',
        boxShadow: '0 8px 20px -8px rgba(0,0,0,.6)',
        whiteSpace: 'nowrap',
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m15 6-6 6 6 6" />
      </svg>
      Story
    </button>
  );
}

/* ================================ StoryRail =========================== */
export function StoryRail({
  events = MOCK_STORY_EVENTS,
  pendingDiff,
  onKeepPendingDiff,
  onUndoPendingDiff,
  filter = 'all',
  onFilterChange,
  onSend,
  composerPlaceholder = 'Ask Anton, or @mention…',
  collapsed = false,
  onToggle,
  // Optional, additive: per-event actions for comment/review rows. A button
  // only renders when its callback is provided; each is called with the event.
  onResolveEvent,
  onDismissEvent,
  onFixEvent,
}) {
  // Uncontrolled fallbacks so the rail is fully interactive when rendered
  // standalone (no parent wiring required).
  const [internalFilter, setInternalFilter] = useState(filter);
  const activeFilter = onFilterChange ? filter : internalFilter;

  const [internalCollapsed, setInternalCollapsed] = useState(collapsed);
  const isCollapsed = onToggle ? collapsed : internalCollapsed;

  const [draft, setDraft] = useState('');

  const handleFilter = useCallback(
    (id) => {
      if (onFilterChange) onFilterChange(id);
      else setInternalFilter(id);
    },
    [onFilterChange],
  );

  const handleToggle = useCallback(() => {
    if (onToggle) onToggle();
    else setInternalCollapsed((v) => !v);
  }, [onToggle]);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    if (onSend) onSend(text);
    setDraft('');
  }, [draft, onSend]);

  // Live per-filter counts from the current events, using the SAME matcher the
  // filter applies — so the badges can never disagree with what a chip shows.
  const filterCounts = useMemo(() => countEventsByFilter(events), [events]);

  // Filter → then coalesce. (Order matters: we coalesce what survives the
  // filter, so e.g. filtering to "Versions" shows them all un-grouped.)
  const nodes = useMemo(() => {
    const activeChip = STORY_FILTERS.find((c) => c.id === activeFilter);
    const filtered = activeChip
      ? events.filter((e) => eventMatchesFilter(e, activeChip))
      : events;
    return coalesce(filtered);
  }, [events, activeFilter]);

  if (isCollapsed) {
    return <CollapsedHandle onToggle={handleToggle} />;
  }

  return (
    <div
      className="rd-story-rail"
      style={{
        width: 'var(--rd-story-rail-width, 332px)',
        maxWidth: `min(var(--rd-story-rail-width, ${STORY_RAIL_WIDTH}px), calc(100vw - 88px))`,
        minWidth: 'min(280px, 100%)',
        flexShrink: 0,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-body)',
        animation: 'slideIn .3s ease',
        // give it a height so it stands alone; a parent flex row overrides this.
        height: '100%',
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Header — just the title. The collapse affordance is intentionally not
          exposed here (collapse code stays defined for programmatic use). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '13px 14px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span className="rd-no-truncate" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Story</span>
      </div>

      {/* Filter row — chips live inside a segmented track so they read as
          filters of one feed, not loose tags. Active = filled --accent-bg. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            color: 'var(--ink-4)',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
        </span>
        <div
          className="rd-scroll"
          style={{
            display: 'flex',
            gap: 4,
            padding: 3,
            borderRadius: 9,
            background: 'var(--surface-2)',
            border: '1px solid var(--line-2)',
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
          }}
        >
          {STORY_FILTERS.map((chip) => (
            <FilterChip
              key={chip.id}
              chip={chip}
              active={activeFilter === chip.id}
              count={filterCounts[chip.id] ?? 0}
              onClick={() => handleFilter(chip.id)}
            />
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div
        className="rd-scroll"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
      >
        <PendingDiffCard diff={pendingDiff} onKeep={onKeepPendingDiff} onUndo={onUndoPendingDiff} />
        {nodes.length === 0 && !pendingDiff ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-4)',
              padding: '8px 2px',
              fontFamily: 'var(--font-body)',
            }}
          >
            Nothing here yet.
          </div>
        ) : (
          <div style={{ position: 'relative' }}>
            {/* connector spine */}
            <div
              style={{
                position: 'absolute',
                left: 9,
                top: 8,
                bottom: 8,
                width: 1.5,
                background: 'var(--line-2)',
              }}
            />
            {nodes.map((node) =>
              node.type === 'group' ? (
                <StoryGroup key={node.id} node={node} />
              ) : (
                <StoryRow
                  key={node.id}
                  event={node.event}
                  onResolveEvent={onResolveEvent}
                  onDismissEvent={onDismissEvent}
                  onFixEvent={onFixEvent}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--surface-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 11,
            padding: '10px 12px',
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={composerPlaceholder}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--ink)',
              fontSize: 12.5,
              fontFamily: 'inherit',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            aria-label="Send"
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              border: 'none',
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#04121a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default StoryRail;
