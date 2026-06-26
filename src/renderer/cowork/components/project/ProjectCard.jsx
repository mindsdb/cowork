// D1 "Quiet" project card — name-led, single supporting activity line,
// demoted stats. No per-project tints, no folder colors, no path. Pin
// + ⋯ kebab reveal on hover. Click anywhere → opens the project.
//
// Design source: docs/design-handoff/Anton Projects (D1 · Quiet).

import { useEffect, useRef, useState } from 'react';
import Ico from '../Icons';
import { fetchMemory, fetchArtifacts, countNonEmptyMemory } from '../../api';
import { useRevealOnHover } from '../../hooks/useRevealOnHover';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-body)';
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
    if (!project?.id && !project?.path) return;
    let cancelled = false;
    fetchMemory(project).then((data) => {
      if (cancelled) return;
      setMemCount(countNonEmptyMemory(data));
    }).catch(() => setMemCount(0));
    return () => { cancelled = true; };
  }, [project?.id, project?.path]);

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
      fontFamily: FONT_BODY,
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
  editing = false,
  onOpen,
  onTogglePin,
  onMenuOpen,
  isMenuOpen = false,
  onRenameSubmit,
  onRenameCancel,
}) {
  const stats = useProjectStats(project, { tasks, scheduled });
  const summary = activitySummary(project, tasks);
  const active = isProjectActive(project, tasks);
  const { hovered, revealed, hoverProps } = useRevealOnHover(isMenuOpen);
  const triggerRef = useRef(null);
  const renameInputRef = useRef(null);

  const showHoverActions = revealed || pinned;
  const isReserved = project.name === 'general' || project.name === 'default';

  // When entering edit mode, focus + select the entire name on the
  // next paint so the user can type immediately to replace it (or
  // arrow-key into the existing name to tweak).
  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => {
      const el = renameInputRef.current;
      if (!el) return;
      el.focus();
      try { el.select(); } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const handleCardKey = (e) => {
    if (editing) return; // typing in the input — let the input handle it
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen?.(project);
    }
  };

  const handleCardClick = (e) => {
    if (editing) return; // ignore card clicks while editing
    onOpen?.(project);
  };

  const submitRename = () => {
    const next = renameInputRef.current?.value ?? project.name;
    onRenameSubmit?.(next);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      className="cw-card"
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      {...hoverProps}
      style={{
        padding: '14px 16px',
        minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative',
        ...(editing ? { cursor: 'default', borderColor: 'var(--accent)' } : {}),
        ...(isSelected && !editing ? { borderColor: 'var(--accent)' } : {}),
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
        {editing ? (
          <input
            ref={renameInputRef}
            type="text"
            defaultValue={project.name}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                submitRename();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onRenameCancel?.();
              }
            }}
            onBlur={submitRename}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            style={{
              flex: 1, minWidth: 0,
              fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
              letterSpacing: '-0.005em', color: 'var(--ink)',
              background: 'var(--surface-2)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '2px 6px',
              outline: 'none',
            }}
          />
        ) : (
          <span style={{
            flex: 1, minWidth: 0,
            fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
            letterSpacing: '-0.005em', color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{project.name}</span>
        )}

        {/* Pin button — visible on hover for unpinned, always for pinned */}
        <button
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(project, !pinned); }}
          title={pinned ? 'Unpin project' : 'Pin project'}
          aria-label={pinned ? 'Unpin project' : 'Pin project'}
          aria-pressed={pinned}
          style={{
            color: pinned ? 'var(--accent)' : 'var(--ink-4)',
            opacity: pinned || showHoverActions ? 1 : 0,
            flexShrink: 0,
          }}
        >
          {Ico.pin(13)}
        </button>

        {/* ⋯ menu trigger */}
        <button
          ref={triggerRef}
          type="button"
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            const rect = triggerRef.current?.getBoundingClientRect();
            onMenuOpen?.(project, rect);
          }}
          title="Project menu"
          aria-label="Project menu"
          style={{
            opacity: showHoverActions ? 1 : 0,
            display: isReserved ? 'none' : undefined,
            flexShrink: 0,
          }}
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
          fontFamily: FONT_BODY, fontSize: 10.5,
          color: 'var(--ink-4)', letterSpacing: '0.01em',
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
