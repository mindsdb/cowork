// Design reference: docs/design-handoff/Anton Projects (D1 · Quiet).

import { useEffect, useRef, useState } from 'react';
import { projectLabel } from '../../lib/projectLabel';
import Ico from '../Icons';
import { Card, Tooltip } from '../ui';
import { fetchMemory, fetchArtifacts, countNonEmptyMemory } from '../../api';
import { useRevealOnHover } from '../../hooks/useRevealOnHover';
import { relativeAge } from '../../lib/formatTime';
import { belongsToProject } from '../../lib/artifactProject';
import SharedResourceAttribution from '../SharedResourceAttribution';
import { isReservedProjectName } from '../../lib/sharedResourceAccess';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';

function tasksFor(project, tasks) {
  return (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path,
  );
}

// A running task or activity within the last hour makes a project active.
function isProjectActive(project, tasks) {
  const list = tasksFor(project, tasks);
  if (list.some((t) => t.status === 'active')) return true;
  const HOUR = 60 * 60 * 1000;
  return list.some((t) => {
    const ts = Date.parse(t.updatedAt || t.subtitle || '');
    return Number.isFinite(ts) && Date.now() - ts < HOUR;
  });
}

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
      setArtCount(data.filter((a) => belongsToProject(a, project)).length);
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

const STAT_LABELS = {
  tasks:     ['task', 'tasks'],
  memories:  ['memory', 'memories'],
  schedules: ['schedule', 'schedules'],
  artifacts: ['artifact', 'artifacts'],
};

export function visibleStats(stats = {}) {
  const out = [];
  for (const key of ['tasks', 'memories', 'schedules', 'artifacts']) {
    const value = Number(stats?.[key]) || 0;
    if (value <= 0) continue;
    const [singular, plural] = STAT_LABELS[key];
    out.push({ key, label: `${value} ${value === 1 ? singular : plural}` });
  }
  return out;
}

export function ProjectCard({
  project,
  isSelected,
  tasks = [],
  scheduled = [],
  pinned = false,
  editing = false,
  // Keep the card until DELETE succeeds and disable duplicate actions while waiting.
  deleting = false,
  onOpen,
  onTogglePin,
  onMenuOpen,
  isMenuOpen = false,
  onRenameSubmit,
  onRenameCancel,
  alwaysShowActions = false,
}) {
  const stats = useProjectStats(project, { tasks, scheduled });
  const cardStats = visibleStats(stats);
  const summary = activitySummary(project, tasks);
  const active = isProjectActive(project, tasks);
  const { revealed, hoverProps } = useRevealOnHover(isMenuOpen);
  const [actionsFocused, setActionsFocused] = useState(false);
  const triggerRef = useRef(null);
  const renameInputRef = useRef(null);

  const showHoverActions = alwaysShowActions || revealed || pinned || actionsFocused;
  const isReserved = isReservedProjectName(project.name);

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

  const handleCardClick = () => {
    if (editing || deleting) return;
    onOpen?.(project);
  };

  const submitRename = () => {
    const next = renameInputRef.current?.value ?? projectLabel(project);
    onRenameSubmit?.(next);
  };

  return (
    <Card
      as="div"
      interactive={!editing && !deleting}
      selected={isSelected || editing}
      padding="cozy"
      onActivate={editing || deleting ? undefined : handleCardClick}
      aria-busy={deleting || undefined}
      {...hoverProps}
      style={{
        cursor: editing || deleting ? 'default' : undefined,
        minHeight: 120,
        display: 'flex', flexDirection: 'column', gap: 10,
        position: 'relative',
        opacity: deleting ? 0.6 : undefined,
        transition: 'opacity .12s ease',
      }}
    >
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
            defaultValue={projectLabel(project)}
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
              letterSpacing: '0', color: 'var(--ink)',
              background: 'var(--surface-2)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '2px 6px',
              outline: 'none',
            }}
          />
        ) : (
          <span className="s-h3" style={{
            flex: 1, minWidth: 0,
            color: 'var(--ink)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{projectLabel(project)}</span>
        )}

        <Tooltip content={pinned ? 'Unpin project' : 'Pin project'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(project, !pinned); }}
            onKeyDown={(e) => e.stopPropagation()}
            onFocus={() => setActionsFocused(true)}
            onBlur={() => setActionsFocused(false)}
            aria-label={pinned ? 'Unpin project' : 'Pin project'}
            aria-pressed={pinned}
            className="project-action-trigger"
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'transparent', border: 0,
              color: pinned ? 'var(--accent)' : 'var(--ink-4)',
              opacity: pinned || showHoverActions ? 1 : 0,
              // Remove controls during deletion: opacity leaves them clickable and touch rules can
              // reveal them.
              display: deleting ? 'none' : 'inline-grid',
              placeItems: 'center',
              cursor: 'pointer', flexShrink: 0,
              transition: 'opacity .15s ease, color .15s ease, background .15s ease',
              font: 'inherit',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-3)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.pin(13)}
          </button>
        </Tooltip>

        <Tooltip content="Project menu">
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = triggerRef.current?.getBoundingClientRect();
              onMenuOpen?.(project, rect);
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onFocus={() => setActionsFocused(true)}
            onBlur={() => setActionsFocused(false)}
            aria-label="Project menu"
            className="project-action-trigger"
            style={{
              width: 26, height: 26, borderRadius: 6,
              background: 'transparent', border: 0,
              color: 'var(--ink-3)',
              opacity: showHoverActions ? 1 : 0,
              display: isReserved || deleting ? 'none' : 'inline-grid',
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
        </Tooltip>
      </div>

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 4,
        minWidth: 0,
      }}>
        {deleting ? (
          <span style={{
            fontFamily: FONT_BODY, fontSize: 13, lineHeight: 1.5,
            color: 'var(--ink-3)',
          }}>
            Deleting…
          </span>
        ) : summary ? (
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
          fontFamily: 'var(--font-sans)', fontSize: 11.5,
          color: 'var(--ink-4)',
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

      <SharedResourceAttribution resource={project} />

      {cardStats.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 14,
          alignItems: 'baseline',
          borderTop: '1px solid var(--line)',
          paddingTop: 10,
        }}>
          {cardStats.map(({ key, label }) => (
            <span key={key} style={{
              fontFamily: 'var(--font-sans)', fontSize: 12,
              color: 'var(--ink-4)',
            }}>{label}</span>
          ))}
        </div>
      )}
    </Card>
  );
}
