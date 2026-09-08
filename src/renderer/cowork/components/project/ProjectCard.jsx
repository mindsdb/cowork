// D1 "Quiet" project card — name-led, single supporting activity line,
// demoted stats. No per-project tints, no folder colors, no path. Pin
// + ⋯ kebab reveal on hover. Click anywhere → opens the project.
//
// Design source: docs/design-handoff/Anton Projects (D1 · Quiet).

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

// Full-word pluralized labels for the stats row, keyed the same as the
// `useProjectStats` shape. Pure — exported so the pluralization + zero-
// filtering logic can be unit-tested without mounting the card.
const STAT_LABELS = {
  tasks:     ['task', 'tasks'],
  memories:  ['memory', 'memories'],
  schedules: ['schedule', 'schedules'],
  artifacts: ['artifact', 'artifacts'],
};

// Zero/undefined stats are omitted entirely (not dimmed) — a quieter
// take on "nothing here yet" than the old D1Stat's ink-5 treatment.
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
  // The server is still working through this project's delete. The card stays
  // put until DELETE succeeds, so it says it is waiting and drops the actions
  // that would fire a second one.
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

  const handleCardClick = () => {
    if (editing || deleting) return; // ignore card clicks while editing or deleting
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
      className="min-h-[120px] flex flex-col gap-[10px] relative"
      style={{
        // Dynamic (app-state) + a transition that must stay inline: an inline
        // style beats .card.interactive's unlayered `transition: var(--card-transition)`,
        // so moving it to a utility would silently swap the transition.
        cursor: editing || deleting ? 'default' : undefined,
        opacity: deleting ? 0.6 : undefined,
        transition: 'opacity .12s ease',
      }}
    >
      {/* Top row — folder + name + pin + ⋯ */}
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex shrink-0 text-ink-3">
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
            className="flex-1 min-w-0 font-[family-name:var(--font-display)] text-[16px] font-semibold tracking-[0] text-ink bg-surface-2 border border-solid border-accent rounded-[6px] py-[2px] px-[6px] [outline:none]"
          />
        ) : (
          <span className="s-h3 flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{projectLabel(project)}</span>
        )}

        {/* Pin button — visible on hover for unpinned, always for pinned */}
        <Tooltip content={pinned ? 'Unpin project' : 'Pin project'}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTogglePin?.(project, !pinned); }}
            onKeyDown={(e) => e.stopPropagation()}
            onFocus={() => setActionsFocused(true)}
            onBlur={() => setActionsFocused(false)}
            aria-label={pinned ? 'Unpin project' : 'Pin project'}
            aria-pressed={pinned}
            className="project-action-trigger w-[26px] h-[26px] rounded-[6px] bg-transparent hover:bg-surface-3 border-0 place-items-center cursor-pointer shrink-0 [transition:opacity_.15s_ease,color_.15s_ease,background_.15s_ease] font-[inherit]"
            style={{
              color: pinned ? 'var(--accent)' : 'var(--ink-4)',
              opacity: pinned || showHoverActions ? 1 : 0,
              // Taken out of flow rather than faded while the delete is on the
              // wire: an opacity-0 control stays clickable, and the coarse-
              // pointer rule would paint it back in on touch.
              display: deleting ? 'none' : 'inline-grid',
            }}
          >
            {Ico.pin(13)}
          </button>
        </Tooltip>

        {/* ⋯ menu trigger */}
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
            className="project-action-trigger w-[26px] h-[26px] rounded-[6px] bg-transparent hover:bg-surface-3 border-0 text-ink-3 hover:text-ink place-items-center cursor-pointer shrink-0 [transition:opacity_.15s_ease,color_.15s_ease,background_.15s_ease] font-[inherit]"
            style={{
              opacity: showHoverActions ? 1 : 0,
              display: isReserved || deleting ? 'none' : 'inline-grid',
            }}
          >
            {Ico.moreVert(15)}
          </button>
        </Tooltip>
      </div>

      {/* Activity block — clamp 2 lines. Falls back to a soft prompt
          when the project has nothing yet. */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {deleting ? (
          <span className="font-[family-name:var(--font-body)] text-[13px] leading-[1.5] text-ink-3">
            Deleting…
          </span>
        ) : summary ? (
          <span className="font-[family-name:var(--font-body)] text-[13px] leading-[1.5] text-ink-2 line-clamp-2">
            {summary.text}
          </span>
        ) : (
          <span className="font-[family-name:var(--font-body)] text-[13px] leading-[1.5] text-ink-4 italic">
            No activity yet
          </span>
        )}

        <span className="inline-flex items-baseline gap-[6px] font-[family-name:var(--font-sans)] text-[11.5px] text-ink-4">
          {active && (
            <span aria-hidden className="w-[5px] h-[5px] rounded-full bg-[var(--success)] shadow-[0_0_6px_var(--success-glow)] self-center" />
          )}
          <span>{summary?.time || '—'}</span>
        </span>
      </div>

      <SharedResourceAttribution resource={project} />

      {/* Stats row — full-word pluralized labels, hairline divider
          above. Zero/undefined stats are omitted; when nothing is
          left to show, the row (and its divider) don't render at
          all rather than showing an empty strip. */}
      {cardStats.length > 0 && (
        <div className="flex flex-wrap gap-[14px] items-baseline border-t border-x-0 border-b-0 border-solid border-line pt-[10px]">
          {cardStats.map(({ key, label }) => (
            <span key={key} className="font-[family-name:var(--font-sans)] text-[12px] text-ink-4">{label}</span>
          ))}
        </div>
      )}
    </Card>
  );
}
