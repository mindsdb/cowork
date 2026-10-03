// A project as a collection item: a card in the grid (ProjectCard) or a
// row in the list (ProjectRow). Both are built from one slot set on the
// collection kit — name-led, the latest task as the description, and a
// quiet meta line (last activity, running tasks, stats). Pin + ⋯ sit in
// the kit's HoverActions; a pinned project keeps them visible at rest.
// The title is a real button stretched over the item, so it opens on
// click, Enter or Space anywhere outside the actions.

import { useEffect, useRef, useState } from 'react';
import { projectLabel } from '../../lib/projectLabel';
import Ico from '../Icons';
import { Tooltip } from '../ui';
import { cn } from '../../lib/cn';
import { ItemCard, ListItem, ITEM_MENU_TRIGGER, StatusDot } from '../collection';
import { fetchMemory, fetchArtifacts, countNonEmptyMemory } from '../../api';
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

// The pin and kebab share the kit's item-trigger look. The legacy class
// keeps their 44px coarse-pointer tap target (globals.css).
const ACTION_TRIGGER = cn(
  'project-action-trigger inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-[inherit]',
  ITEM_MENU_TRIGGER,
);

// One slot set for the grid card and the list row.
function useProjectSlots({
  project,
  isSelected = false,
  tasks = [],
  scheduled = [],
  pinned = false,
  editing = false,
  // The server is still working through this project's delete. The item stays
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
  // App.jsx sets task.status to 'active' while a turn streams, so this is
  // the project's live in-flight work.
  const running = tasksFor(project, tasks).filter((t) => t.status === 'active').length;
  const triggerRef = useRef(null);
  const renameInputRef = useRef(null);
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

  const submitRename = () => {
    const next = renameInputRef.current?.value ?? projectLabel(project);
    onRenameSubmit?.(next);
  };

  const title = editing ? (
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
      className="w-full min-w-0 rounded-md border border-solid border-accent bg-surface-2 px-1.5 py-0.5 font-body text-[length:inherit] font-medium text-ink [outline:none]"
    />
  ) : projectLabel(project);

  // Withheld (not hidden) while the delete is on the wire, and the kebab for
  // a reserved project, so no stylesheet can revive a control that must not fire.
  const actions = !deleting && (
    <>
      <Tooltip content={pinned ? 'Unpin project' : 'Pin project'}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTogglePin?.(project, !pinned); }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={pinned ? 'Unpin project' : 'Pin project'}
          aria-pressed={pinned}
          className={cn(ACTION_TRIGGER, pinned && 'text-accent hover:text-accent')}
        >
          {Ico.pin(13)}
        </button>
      </Tooltip>
      {!isReserved && (
        <Tooltip content="Project menu">
          <button
            ref={triggerRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMenuOpen?.(project, triggerRef.current?.getBoundingClientRect());
            }}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label="Project menu"
            className={ACTION_TRIGGER}
          >
            {Ico.moreVert(15)}
          </button>
        </Tooltip>
      )}
    </>
  );

  const when = summary?.time || '—';

  return {
    leading: Ico.folder(14),
    title,
    actions: actions || undefined,
    // A pinned project keeps its accent pin (and the kebab beside it) in view.
    revealActions: alwaysShowActions || isMenuOpen || pinned,
    selected: isSelected || editing,
    busy: deleting,
    onActivate: editing ? undefined : () => onOpen?.(project),
    description: deleting ? 'Deleting…'
      : summary ? summary.text
      : <span className="italic text-ink-4">No activity yet</span>,
    children: <SharedResourceAttribution resource={project} />,
    meta: (
      <>
        {active ? <StatusDot tone="success">{when}</StatusDot> : <span className="whitespace-nowrap">{when}</span>}
        {running > 0 && <span className="whitespace-nowrap text-accent">{running} running</span>}
        {cardStats.length > 0 && <span className="truncate">{cardStats.map((s) => s.label).join(' · ')}</span>}
      </>
    ),
  };
}

/** Grid layout: a project is a place you open and work in. */
export function ProjectCard(props) {
  return <ItemCard {...useProjectSlots(props)} />;
}

/** List layout: the same slots as a row, meta inline instead of columns. */
export function ProjectRow(props) {
  return <ListItem {...useProjectSlots(props)} />;
}
