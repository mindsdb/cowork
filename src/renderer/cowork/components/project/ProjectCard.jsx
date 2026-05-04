// D1 "Quiet" project card — name-led, single supporting activity line,
// demoted stats. No per-project tints, no folder colors, no path. Pin
// + ⋯ kebab reveal on hover. Click anywhere → opens the project.
//
// Design source: docs/design-handoff/Anton Projects (D1 · Quiet).

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchMemory, fetchArtifacts } from '../../api';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

function relativeAge(input) {
  if (!input) return null;
  const ts = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  if (diff < 60_000)        return 'just now';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function tasksFor(project, tasks) {
  return (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path,
  );
}

// Compute "active" — at least one task in this project has a running
// stream OR has been touched within the last hour.
function isProjectActive(project, tasks) {
  const list = tasksFor(project, tasks);
  if (list.some((t) => t.status === 'active')) return true;
  const HOUR = 60 * 60 * 1000;
  return list.some((t) => {
    const ts = Date.parse(t.updatedAt || t.subtitle || '');
    return Number.isFinite(ts) && Date.now() - ts < HOUR;
  });
}

// Pull the most recent task title as the activity line. The handoff
// asks for ~50–80 chars clamped to 2 lines via -webkit-line-clamp.
function activitySummary(project, tasks) {
  const list = tasksFor(project, tasks);
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) => {
    const ta = Date.parse(a.updatedAt || '') || 0;
    const tb = Date.parse(b.updatedAt || '') || 0;
    return tb - ta;
  });
  const top = sorted[0];
  return {
    text: top?.title || 'Untitled task',
    time: relativeAge(top?.updatedAt) || top?.subtitle || '',
  };
}

function useProjectStats(project, { tasks = [], scheduled = [] }) {
  const [memCount, setMemCount] = useState(null);
  const [artCount, setArtCount] = useState(null);

  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;
    fetchMemory(project.path).then((data) => {
      if (cancelled) return;
      const total = (data?.sections || []).reduce(
        (n, s) => n + (s.files?.length || 0),
        0,
      );
      setMemCount(total);
    }).catch(() => setMemCount(0));
    return () => { cancelled = true; };
  }, [project?.path]);

  useEffect(() => {
    if (!project?.path) return;
    let cancelled = false;
    fetchArtifacts().then((data) => {
      if (cancelled || !Array.isArray(data)) return;
      const prefix = project.path.replace(/\/+$/, '') + '/';
      setArtCount(data.filter((a) => a.path?.startsWith(prefix)).length);
    }).catch(() => setArtCount(0));
    return () => { cancelled = true; };
  }, [project?.path]);

  return {
    tasks: tasksFor(project, tasks).length,
    memories: memCount ?? 0,
    schedules: (scheduled || []).filter((s) =>
      (s.project || s.projectName) === project?.name,
    ).length,
    artifacts: artCount ?? 0,
  };
}

// Single mono stat. Zero values dim to ink-5 on both number and label
// — the spec's visual cue for "nothing here yet". Spacing: 12 / 11 px.
function D1Stat({ label, value }) {
  const isZero = !value || value === 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 5,
      fontFamily: FONT_MONO,
    }}>
      <span style={{
        fontSize: 12, fontWeight: 500,
        color: isZero ? 'var(--ink-5)' : 'var(--ink-2)',
      }}>{value ?? 0}</span>
      <span style={{
        fontSize: 11, letterSpacing: '0.02em',
        color: isZero ? 'var(--ink-5)' : 'var(--ink-4)',
      }}>{label}</span>
    </span>
  );
}

export function ProjectCard({
  project,
  isSelected,
  tasks = [],
  scheduled = [],
  pinned = false,
  onOpen,
  onTogglePin,
  onMenuOpen,
}) {
  const stats = useProjectStats(project, { tasks, scheduled });
  const summary = activitySummary(project, tasks);
  const active = isProjectActive(project, tasks);
  const [hover, setHover] = useState(false);
  const triggerRef = useRef(null);

  const showHoverActions = hover || pinned;
  const isReserved = project.name === 'general' || project.name === 'default';

  const handleCardKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.(project);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(project)}
      onKeyDown={handleCardKey}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: 'pointer',
        background: hover ? 'var(--surface-2)' : 'var(--surface)',
        border: `1px solid ${isSelected ? 'var(--accent)' : (hover ? 'var(--line-2)' : 'var(--line)')}`,
        borderRadius: 10,
        padding: '14px 16px',
        minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'background .15s ease, border-color .15s ease',
        position: 'relative',
        outline: 'none',
        font: 'inherit', color: 'inherit',
      }}
    >
      {/* Top row — folder + name + pin + ⋯ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        minWidth: 0,
      }}>
        <span style={{
          display: 'inline-flex', flexShrink: 0,
          color: 'var(--ink-3)',
        }}>
          {Ico.folder(14)}
        </span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
          letterSpacing: '-0.005em', color: 'var(--ink)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{project.name}</span>

        {/* Pin button — visible on hover for unpinned, always for pinned */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(project, !pinned); }}
          title={pinned ? 'Unpin project' : 'Pin project'}
          aria-label={pinned ? 'Unpin project' : 'Pin project'}
          aria-pressed={pinned}
          style={{
            width: 26, height: 26, borderRadius: 6,
            background: 'transparent', border: 0,
            color: pinned ? 'var(--accent)' : 'var(--ink-4)',
            opacity: pinned || showHoverActions ? 1 : 0,
            display: 'inline-grid', placeItems: 'center',
            cursor: 'pointer', flexShrink: 0,
            transition: 'opacity .15s ease, color .15s ease, background .15s ease',
            font: 'inherit',
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.pin(13)}
        </button>

        {/* ⋯ menu trigger */}
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = triggerRef.current?.getBoundingClientRect();
            onMenuOpen?.(project, rect);
          }}
          title="Project menu"
          aria-label="Project menu"
          style={{
            width: 26, height: 26, borderRadius: 6,
            background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            opacity: showHoverActions ? 1 : 0,
            display: isReserved ? 'none' : 'inline-grid',
            placeItems: 'center',
            cursor: 'pointer', flexShrink: 0,
            transition: 'opacity .15s ease, color .15s ease, background .15s ease',
            font: 'inherit',
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; e.currentTarget.style.color = 'var(--ink)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
        >
          {Ico.moreVert(15)}
        </button>
      </div>

      {/* Activity block — clamp 2 lines. Falls back to a soft prompt
          when the project has nothing yet. */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
        minWidth: 0,
      }}>
        {summary ? (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5,
            color: 'var(--ink-2)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {summary.text}
          </span>
        ) : (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5,
            color: 'var(--ink-4)', fontStyle: 'italic',
          }}>
            No activity yet
          </span>
        )}

        <span style={{
          display: 'inline-flex', alignItems: 'baseline', gap: 6,
          fontFamily: FONT_MONO, fontSize: 10.5,
          color: 'var(--ink-4)', letterSpacing: '0.04em',
        }}>
          {active && (
            <span aria-hidden style={{
              width: 5, height: 5, borderRadius: 99,
              background: 'var(--success)',
              boxShadow: '0 0 6px var(--success-glow)',
              alignSelf: 'center',
            }} />
          )}
          <span>{summary?.time || '—'}</span>
        </span>
      </div>

      {/* Stats row — short labels per spec, hairline divider above */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 14,
        alignItems: 'baseline',
        borderTop: '1px solid var(--line)',
        paddingTop: 10,
      }}>
        <D1Stat label="tasks" value={stats.tasks} />
        <D1Stat label="mem"   value={stats.memories} />
        <D1Stat label="sched" value={stats.schedules} />
        <D1Stat label="art"   value={stats.artifacts} />
      </div>
    </div>
  );
}
