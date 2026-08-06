// Projects page — D1 "Quiet" direction.
//
// Header (title + subtitle + accent "+ New project") • Filter row
// (search ⌘K + sort + count + grid/list toggle) • Grid OR list. Each
// card surfaces a single activity line, mono timestamp w/ active dot,
// and a demoted stats row (tasks · mem · sched · art) with zero values
// dimmed. Pin + ⋯ menu reveal on hover.
//
// Design source: docs/design-handoff/Anton Projects (D1).

import { useEffect, useMemo, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { WorkingFolderBox, ContextBox, ScheduledBox } from '../components/rail';
import { TaskList } from '../components/task';
import { ProjectCard } from '../components/project/ProjectCard';
import NewProjectModal from '../components/project/NewProjectModal';
import { useBreakpoint } from '../hooks/useBreakpoint';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  useCollectionShortcut,
} from '../components/collection';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import {
  createProject as createProjectApi,
  renameProject,
  revealProjectInFinder,
  fetchMemory, fetchArtifacts, countNonEmptyMemory,
} from '../api';
import { Button, Menu, EmptyState } from '../components/ui';
import { Crumb, CrumbSep, CrumbCurrent } from '../components/ui/Crumb';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { host } from '../../platform/host';

const FONT_BODY    = 'var(--font-body)';
const FONT_DISPLAY = 'var(--font-display)';
const FONT_MONO    = 'var(--font-mono)';

// ─── Pin persistence (localStorage) ──────────────────────────────────────
//
// The server doesn't track project pin state today, so we keep it client-
// side. Format: a JSON array of project names. Reserved/missing keys are
// ignored gracefully. Any caller that mutates the list re-emits a
// 'storage' event-equivalent via a custom event so the components can
// react without coupling to the storage primitive directly.
const PIN_KEY = 'anton:pinned-projects';
const PIN_EVENT = 'anton:pinned-projects:change';

function readPinned() {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writePinned(set) {
  try {
    localStorage.setItem(PIN_KEY, JSON.stringify([...set]));
    window.dispatchEvent(new Event(PIN_EVENT));
  } catch {
    // Storage might be disabled (private browsing). Silently ignore —
    // the pin state simply won't persist across reloads.
  }
}

function usePinnedProjects() {
  const [pinned, setPinned] = useState(() => readPinned());
  useEffect(() => {
    const sync = () => setPinned(readPinned());
    window.addEventListener(PIN_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PIN_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const togglePin = (name, next) => {
    const cur = readPinned();
    if (next === undefined) next = !cur.has(name);
    if (next) cur.add(name);
    else cur.delete(name);
    writePinned(cur);
  };
  return { pinned, togglePin };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function timestampOfProject(project, tasks) {
  const list = (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path,
  );
  let max = 0;
  for (const t of list) {
    const ts = Date.parse(t.updatedAt || t.subtitle || '') || 0;
    if (ts > max) max = ts;
  }
  return max;
}

function isActive(project, tasks) {
  const list = (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path,
  );
  if (list.some((t) => t.status === 'active')) return true;
  const HOUR = 60 * 60 * 1000;
  const ts = timestampOfProject(project, tasks);
  return ts > 0 && Date.now() - ts < HOUR;
}

function activitySummaryFor(project, tasks) {
  const list = (tasks || []).filter((t) =>
    t.projectName === project?.name || t.projectPath === project?.path,
  );
  if (list.length === 0) return null;
  const sorted = [...list].sort((a, b) =>
    (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0),
  );
  return sorted[0];
}

// ─── Header ──────────────────────────────────────────────────────────────

// Reuse the global `.btn-primary` styling — same accent button used for
// "+ Schedule task" and the rest of the page-header CTAs. Keeps the
// type, height, padding and accent-glow consistent across pages.
function NewProjectButton({ onClick }) {
  return (
    <Button variant="primary" className="proj-new-action" onClick={onClick}>
      {Ico.plus(14)} New project
    </Button>
  );
}

// Sort options for the projects collection. Kept here (and not in
// the kit) because the choices are page-specific.
const SORT_OPTIONS = [
  { id: 'recent',       label: 'Recent' },
  { id: 'name',         label: 'Name' },
  { id: 'most-active',  label: 'Most active' },
  { id: 'least-active', label: 'Least active' },
];

function ProjectsCounts({ search, total, filtered, pinnedCount }) {
  const filterActive = (search || '').trim().length > 0;
  const countText = filterActive
    ? `Showing ${filtered} of ${total}`
    : `${total} ${total === 1 ? 'project' : 'projects'}`;
  return (
    <>
      {countText}
      {pinnedCount > 0 && (
        <>
          {' · '}
          <span className="text-accent">{pinnedCount} pinned</span>
        </>
      )}
    </>
  );
}

// ─── Project menu (kebab popover) ────────────────────────────────────────

function ProjectMenu({ open, anchorRect, project, pinned, isReserved, undeletable = false, hideOpen = false, hidePin = false, onClose, onOpen, onRename, onTogglePin, onReveal, onDelete }) {
  const items = [
    !hideOpen && {
      id: 'open',
      label: 'Open',
      icon: Ico.folder(13),
      onClick: () => onOpen?.(project),
    },
    !hidePin && {
      id: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: Ico.pin(13),
      onClick: () => onTogglePin?.(project, !pinned),
    },
    !isReserved && {
      id: 'rename',
      label: 'Rename…',
      icon: Ico.edit(13),
      onClick: () => onRename?.(project),
    },
    onReveal && {
      id: 'reveal',
      label: 'Reveal in Finder',
      icon: Ico.externalLink(13),
      onClick: () => onReveal?.(project),
    },
    { divider: true },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Ico.trash(13),
      danger: true,
      disabled: undeletable,
      title: undeletable ? "The General project can't be deleted — it's the orphan-fallback workspace." : undefined,
      onClick: () => onDelete?.(project),
    },
  ].filter(Boolean);

  return (
    <Menu
      open={open}
      anchor={anchorRect}
      onClose={onClose}
      align="end"
      width={200}
      zIndex={60}
      ariaLabel="Project actions"
      items={items}
    />
  );
}

// ─── Trailing "+ New project" card ───────────────────────────────────────

// "+ New project" tile — clicking flips the card into an inline edit
// mode with a focused input. Enter creates, Escape (or empty + blur)
// cancels back to the dashed prompt. Same pattern as the rename
// affordance on the regular cards. Replaces the previous
// `window.prompt` flow which Electron renderers can silently disable.
function NewProjectCard({ onCreate, creating, onCreatingChange }) {
  const [hover, setHover] = useState(false);
  // Parent-driven editing state so the page header / empty-state CTA
  // can flip the card open without it having to be clicked first.
  const editing = !!creating;
  const setEditing = (v) => onCreatingChange?.(v);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const submit = async () => {
    const next = (inputRef.current?.value || '').trim();
    if (!next) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onCreate?.(next);
      setEditing(false);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[projects] create failed', e);
      alert(`Could not create project: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="min-h-[120px] rounded-card px-4 py-4 bg-surface border border-accent flex flex-col gap-3 justify-center font-[var(--font-body)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 text-ink-3">
            {Ico.folder(14)}
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Project name"
            disabled={busy}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={() => {
              // Blur commits if there's a value, otherwise cancels.
              const val = (inputRef.current?.value || '').trim();
              if (val) submit();
              else cancel();
            }}
            className="flex-1 min-w-0 font-[var(--font-display)] text-[16px] font-semibold tracking-[0] text-ink bg-surface-2 border border-line rounded-card-row px-2 py-1 outline-none"
          />
        </div>
        <div className="font-mono text-xs text-ink-4 tracking-[0.04em]">
          {busy ? 'Creating…' : '↵ create · esc cancel'}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="min-h-[120px] rounded-card px-4 py-4 bg-transparent flex flex-col items-center justify-center gap-2 cursor-pointer [transition:border-color_.15s_ease,color_.15s_ease]"
      style={{
        border: `1px dashed ${hover ? 'var(--accent)' : 'var(--line-2)'}`,
        color: hover ? 'var(--accent)' : 'var(--ink-3)',
      }}
    >
      <span className="inline-flex">{Ico.plus(16)}</span>
      <span className="font-[var(--font-body)] text-sm font-medium">New project</span>
    </button>
  );
}

// ─── List view ───────────────────────────────────────────────────────────

// Adds an "Active" column between Tasks and Memories — the count of
// currently-streaming tasks in this project. Client-side derivable
// from `tasks` (status === 'active'), so no new server endpoint
// needed; the data is already on the client.
//
// Name leads with the most fr-share so long names don't ellipsize at
// the typical sidebar width — the prior 1.6fr lost the name to the
// "Last activity" cell. Updated column was dropped (the activity
// summary already implies recency); the freed width goes to Name.
const LIST_GRID = '3fr 1.2fr 64px 64px 64px 64px 64px 36px';

function ListHeader() {
  const Cell = ({ children, align }) => (
    <div className="font-mono text-xs text-ink-4 tracking-[0.10em] uppercase" style={{ textAlign: align || 'left' }}>{children}</div>
  );
  return (
    <div className="grid gap-4 px-4 py-3 border-b border-line" style={{ gridTemplateColumns: LIST_GRID }}>
      <Cell>Name</Cell>
      <Cell>Last activity</Cell>
      <Cell align="right">Tasks</Cell>
      <Cell align="right">Active</Cell>
      <Cell align="right">Memories</Cell>
      <Cell align="right">Sched.</Cell>
      <Cell align="right">Artifacts</Cell>
      <Cell />
    </div>
  );
}

function D1Num({ value }) {
  const isZero = !value;
  return (
    <span className="font-mono text-sm text-right tabular-nums" style={{ color: isZero ? 'var(--ink-5)' : 'var(--ink)' }}>{value ?? 0}</span>
  );
}

// Same shape as D1Num but with a pulsing accent dot + accent number
// when > 0. Used by the "Active" column so live projects stand out
// without dragging in a full status pill.
function ActiveNum({ value }) {
  const isZero = !value;
  return (
    <span className="inline-flex items-center justify-end gap-2 font-mono text-sm text-right tabular-nums" style={{ color: isZero ? 'var(--ink-5)' : 'var(--accent)' }}>
      {!isZero && (
        <span aria-hidden className="pulse-dot" style={{
          width: 6, height: 6, borderRadius: '50%',
          background: 'var(--accent)',
          boxShadow: '0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)',
          flexShrink: 0,
        }} />
      )}
      {value ?? 0}
    </span>
  );
}

// Lazy memory + artifact counts per project, identical to the card.
// We could lift this to a single fetch + share but per-row keeps the
// list view drop-in simple.
function useRowStats(project) {
  const [mem, setMem] = useState(0);
  const [art, setArt] = useState(0);
  useEffect(() => {
    if (!project?.id && !project?.path) return;
    let cancelled = false;
    fetchMemory(project).then((data) => {
      if (cancelled) return;
      setMem(countNonEmptyMemory(data));
    }).catch(() => {});
    fetchArtifacts().then((data) => {
      if (cancelled || !Array.isArray(data)) return;
      const prefix = project.path.replace(/\/+$/, '') + '/';
      setArt(data.filter((a) => a.path?.startsWith(prefix)).length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [project?.id, project?.path]);
  return { mem, art };
}

function ListRow({
  project, tasks, scheduled, pinned, onOpen, onTogglePin, onMenuOpen, isMenuOpen = false,
  // Inline-edit plumbing — wired from the parent the same way the
  // grid `ProjectCard` is, so the kebab → Rename action works in both
  // views. Earlier the list row showed no input when editing, which
  // forced users to flip to grid view to actually rename.
  editing = false,
  onRenameSubmit,
  onRenameCancel,
}) {
  const { hovered, revealed, hoverProps } = useRevealOnHover(isMenuOpen);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const { mem, art } = useRowStats(project);
  const summary = activitySummaryFor(project, tasks);
  const projectTasks = (tasks || []).filter((t) => t.projectName === project.name || t.projectPath === project.path);
  const taskCount = projectTasks.length;
  // App.jsx sets task.status to 'active' while a turn is streaming
  // and back to 'idle' on completion, so this count reflects the
  // live in-flight work for the project.
  const activeTaskCount = projectTasks.filter((t) => t.status === 'active').length;
  const schedCount = (scheduled || []).filter((s) => (s.project || s.projectName) === project.name).length;
  const active = isActive(project, tasks);
  const isReserved = project.name === 'general' || project.name === 'default';

  // Auto-focus + select-all when the row enters edit mode so the user
  // can start typing the new name immediately.
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    try { el.setSelectionRange(0, el.value.length); } catch {}
  }, [editing]);

  const submitRename = () => {
    const next = inputRef.current?.value ?? project.name;
    onRenameSubmit?.(next);
  };

  return (
    <div
      role={editing ? undefined : 'button'}
      tabIndex={editing ? undefined : 0}
      onClick={editing ? undefined : () => onOpen?.(project)}
      {...hoverProps}
      onKeyDown={(e) => { if (!editing && e.key === 'Enter') onOpen?.(project); }}
      style={{
        display: 'grid', gridTemplateColumns: LIST_GRID, gap: 14,
        padding: '12px 14px',
        background: hovered ? 'var(--surface)' : 'transparent',
        borderBottom: '1px solid var(--line)',
        cursor: editing ? 'default' : 'pointer',
        transition: 'background .12s ease',
        alignItems: 'center',
        outline: 'none',
      }}
    >
      {/* Name */}
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden style={{
          width: 6, height: 6, borderRadius: 99,
          background: active ? 'var(--success)' : 'var(--ink-5)',
          boxShadow: active ? '0 0 6px var(--success-glow)' : 'none',
          flexShrink: 0,
        }} />
        <span className="inline-flex text-ink-3 shrink-0">
          {Ico.folder(13)}
        </span>
        {editing ? (
          <input
            ref={inputRef}
            defaultValue={project.name}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); onRenameCancel?.(); }
            }}
            onBlur={submitRename}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            style={{
              flex: '1 1 0', minWidth: 0,
              fontFamily: FONT_DISPLAY, fontSize: 14.5, fontWeight: 600,
              color: 'var(--ink)',
              background: 'var(--surface-2)',
              border: '1px solid var(--accent)',
              borderRadius: 5, padding: '2px 6px', outline: 'none',
            }}
          />
        ) : (
          <span className="font-[var(--font-display)] text-base font-semibold text-ink min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{project.name}</span>
        )}
        {pinned && !editing && (
          <span className="inline-flex text-accent shrink-0">
            {Ico.pin(11)}
          </span>
        )}
      </div>

      {/* Last activity */}
      <div className="font-[var(--font-body)] text-sm text-ink-2 overflow-hidden text-ellipsis whitespace-nowrap">
        {summary?.title || <span className="text-ink-4 italic">No activity yet</span>}
      </div>

      {/* Number cells */}
      <D1Num value={taskCount} />
      <ActiveNum value={activeTaskCount} />
      <D1Num value={mem} />
      <D1Num value={schedCount} />
      <D1Num value={art} />

      {/* ⋯ menu */}
      <div className="flex justify-end">
        <button
          ref={triggerRef}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = triggerRef.current?.getBoundingClientRect();
            onMenuOpen?.(project, rect);
          }}
          aria-label="Project menu"
          style={{
            width: 26, height: 26, borderRadius: 6,
            background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            opacity: revealed || isReserved ? 1 : 0,
            display: isReserved ? 'none' : 'inline-grid',
            placeItems: 'center',
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
  );
}

// ─── Empty / loading ─────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="min-h-[120px] rounded-card px-4 py-4 border border-line bg-surface flex flex-col gap-3">
      <div className="proj-shimmer h-[14px] w-[60%] bg-surface-2 rounded-[4px]" />
      <div className="flex-1 flex flex-col gap-2">
        <div className="proj-shimmer h-[11px] w-[90%] bg-surface-2 rounded-[4px]" />
        <div className="proj-shimmer h-[11px] w-[70%] bg-surface-2 rounded-[4px]" />
      </div>
      <div className="proj-shimmer h-[12px] w-[50%] bg-surface-2 rounded-[4px]" />
    </div>
  );
}

// ─── Project detail (per-project workspace) ──────────────────────────────
//
// Same shape as ChatView. Header crumb is `Projects › [name]`; left
// column is composer-on-top + per-project task list; right rail is
// Working folder + Context + Scheduled. Restored after a brief detour
// where I'd accidentally folded this into the home route — the user
// wants the in-page detail view to stay.

function ProjectDetail({
  project, projects, tasks, scheduled, scheduleRunsIndex = {}, models, onSend, onSelectTask,
  onDeleteTask, onMoveTaskToProject, onShowAll,
  attachments = [],
  connectors = [],
  onAttachFiles,
  onAddGoogleDriveFiles,
  onAddGoogleDriveProjectFiles,
  onFetchGoogleDriveProjectFiles,
  onRemoveGoogleDriveProjectFile,
  onRemoveAttachment,
  disabledConnections = [],
  onUpdateConnectorMute,
  onNavigateToConnectors,
  // Header kebab + inline rename — lets users rename / reveal / delete
  // the active project without bouncing back to the grid. Pin is
  // intentionally absent: the only pin store today is localStorage on
  // the grid cards, and exposing the toggle here would imply the
  // detail view participates in that state.
  editing = false,
  onRenameStart,
  onRenameSubmit,
  onRenameCancel,
  onReveal,
  onDelete,
  // Clicking a row inside the rail's Scheduled Tasks card routes to
  // the schedule detail page. Wired by App.jsx — same handler the
  // ScheduledView grid uses.
  onOpenSchedule,
}) {
  const projectTasks = (tasks || [])
    .filter((t) => t.projectName === project.name || t.projectPath === project.path)
    .sort((a, b) => timestampOfProject(b, []) - timestampOfProject(a, []) || 0);
  const projectSchedules = (scheduled || [])
    .filter((s) => (s.project || s.projectName) === project.name);

  const [railOpen, setRailOpen] = useState(true);
  const [menuRect, setMenuRect] = useState(null);
  const kebabRef = useRef(null);
  const renameInputRef = useRef(null);
  const isReserved = project.name === 'general' || project.name === 'default';
  const { revealed, hoverProps } = useRevealOnHover(!!menuRect);
  const showKebab = !isReserved && revealed;

  // Focus + select-all the inline input on mount of the editing state.
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
    const next = renameInputRef.current?.value ?? project.name;
    onRenameSubmit?.(next);
  };

  return (
    <div className="project-detail-root" style={{
      flex: 1, minHeight: 0,
      display: 'grid',
      gridTemplateColumns: railOpen ? 'minmax(0, 1fr) 320px' : 'minmax(0, 1fr) 0px',
      gridTemplateRows: '1fr',
      transition: 'grid-template-columns 220ms cubic-bezier(.2,.7,.3,1)',
      background: 'transparent',
      fontFamily: FONT_BODY,
      color: 'var(--ink-2)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'relative', overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        minWidth: 0, minHeight: 0,
      }}>
        {/* Floating expand-rail button (mirrors ChatView). */}
        <button
          type="button"
          className="project-detail-rail-toggle"
          onClick={() => setRailOpen(true)}
          title="Expand panel"
          aria-label="Expand panel"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 10,
            width: 28, height: 28, borderRadius: 6,
            display: 'inline-grid', placeItems: 'center',
            cursor: 'pointer', background: 'transparent', border: 0,
            color: 'var(--ink-3)',
            opacity: railOpen ? 0 : 1,
            transform: railOpen ? 'translateX(8px)' : 'translateX(0)',
            pointerEvents: railOpen ? 'none' : 'auto',
            transition:
              `opacity 280ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '120ms'}, ` +
              `transform 360ms cubic-bezier(0.32,0.72,0,1) ${railOpen ? '0ms' : '80ms'}`,
            WebkitAppRegion: 'no-drag',
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
          onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
        >
          {Ico.panelExpandLeft(15)}
        </button>

        {/* Header — Projects › [project] crumb. Top padding honours the
            shell's --titlebar-safe-top so the crumb drops below the traffic
            lights when the sidebar isn't docked (0 → normal 14px), staying
            left-aligned with the detail below. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          paddingTop: 'max(14px, var(--titlebar-safe-top, 0px))', paddingBottom: 14, paddingRight: 28,
          paddingLeft: 28,
          borderBottom: '1px solid var(--line)',
          background: 'transparent',
          flexShrink: 0,
          minWidth: 0, overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0, flex: '1 1 0',
            overflow: 'hidden',
          }}>
            <Crumb label="Projects" onClick={onShowAll} title="All projects" />
            <CrumbSep />
            <div
              {...hoverProps}
              style={{
                display: 'flex', alignItems: 'center', gap: 4,
                minWidth: 0, flex: '1 1 0',
              }}
            >
              {editing ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  defaultValue={project.name}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
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
                    flex: '1 1 0', minWidth: 0,
                    fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 13,
                    letterSpacing: '0', color: 'var(--ink)',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--accent)',
                    borderRadius: 5, padding: '2px 6px', outline: 'none',
                  }}
                />
              ) : (
                <CrumbCurrent
                  label={project.name}
                  style={{ flex: '0 1 auto' }}
                />
              )}
              {!editing && (
                <button
                  ref={kebabRef}
                  type="button"
                  aria-label="Project menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = kebabRef.current?.getBoundingClientRect();
                    setMenuRect(rect || null);
                  }}
                  style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: 'transparent', border: 0,
                    color: 'var(--ink-3)',
                    display: 'inline-grid', placeItems: 'center',
                    flexShrink: 0,
                    opacity: showKebab ? 1 : 0,
                    pointerEvents: showKebab ? 'auto' : 'none',
                    cursor: 'pointer',
                    transition: 'opacity .15s ease, color .15s ease, background .15s ease',
                    WebkitAppRegion: 'no-drag',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
                >
                  {Ico.moreVert(13)}
                </button>
              )}
            </div>
          </div>
        </div>

        <ProjectMenu
          open={!!menuRect}
          anchorRect={menuRect}
          project={project}
          isReserved={isReserved}
          undeletable={project.name === 'general'}
          hideOpen
          hidePin
          onClose={() => setMenuRect(null)}
          onRename={() => onRenameStart?.(project)}
          onReveal={host.isWeb ? undefined : () => onReveal?.(project)}
          onDelete={() => onDelete?.(project)}
        />

        <div data-scroll="true" className="min-h-0 overflow-y-auto overflow-x-hidden pt-8 px-[28px] pb-[60px] bg-transparent [-webkit-app-region:no-drag]">
          <div className="max-w-[720px] mx-auto flex flex-col gap-[28px]">
            <Composer
              onSend={onSend}
              project={project}
              onProjectChange={() => {}}
              model={null}
              onModelChange={() => {}}
              projects={projects || []}
              models={models || []}
              attachments={attachments}
              connectors={connectors}
              onNavigateToConnectors={onNavigateToConnectors}
              onAttachFiles={onAttachFiles}
              onAddGoogleDriveFiles={onAddGoogleDriveFiles}
              onRemoveAttachment={onRemoveAttachment}
              disabledConnections={disabledConnections}
              onUpdateConnectorMute={onUpdateConnectorMute}
              hideModel
              metaReadOnly
              placeholder={`Start a new task in ${project.name}…`}
            />

            <TaskList
              tasks={projectTasks}
              projects={projects || []}
              schedules={scheduled || []}
              scheduleRunsIndex={scheduleRunsIndex}
              emptyMessage={`No tasks in this project yet — type a prompt above to start one.`}
              onSelectTask={onSelectTask}
              onOpenSchedule={onOpenSchedule}
              onDeleteTask={onDeleteTask}
              onMoveTaskToProject={onMoveTaskToProject}
            />
          </div>
        </div>
      </div>

      <aside className="project-detail-rail" style={{
        background: 'transparent',
        padding: '14px 14px 22px',
        visibility: railOpen ? 'visible' : 'hidden',
        opacity: railOpen ? 1 : 0,
        transition: 'opacity 180ms ease',
        display: 'flex', flexDirection: 'column', gap: 10,
        overflowX: 'hidden', overflowY: 'auto',
        minWidth: 0,
        WebkitAppRegion: 'no-drag',
      }}>
        <div className="project-detail-rail-toggle-row flex items-center justify-end shrink-0">
          <button
            type="button"
            className="project-detail-rail-toggle"
            onClick={() => setRailOpen(false)}
            title="Collapse panel"
            aria-label="Collapse panel"
            style={{
              cursor: 'pointer', background: 'transparent', border: 0,
              width: 26, height: 26, borderRadius: 6,
              display: 'inline-grid', placeItems: 'center',
              color: 'var(--ink-3)',
              WebkitAppRegion: 'no-drag',
            }}
            onMouseOver={(e) => { e.currentTarget.style.color = 'var(--ink)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
            onMouseOut={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.background = 'transparent'; }}
          >
            {Ico.panelCollapseRight(15)}
          </button>
        </div>
        <WorkingFolderBox project={project} />
        <ContextBox
          project={project}
          onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
          onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
          onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
        />
        <ScheduledBox items={projectSchedules} onSelect={onOpenSchedule} />
      </aside>
    </div>
  );
}

// ─── Composed view ───────────────────────────────────────────────────────

export default function ProjectsView({
  projects = [],
  selectedProject,
  tasks = [],
  scheduled = [],
  // Flat sessionId → scheduleId map. Forwarded to TaskList so the
  // project view's task list collapses scheduled runs the same way
  // TasksView does.
  scheduleRunsIndex = {},
  models = [],
  loading = false,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onSendInProject,
  onSelectTask,
  onDeleteTask,
  onMoveTaskToProject,
  attachments = [],
  connectors = [],
  onAttachFiles,
  onAddGoogleDriveFiles,
  onAddGoogleDriveProjectFiles,
  onFetchGoogleDriveProjectFiles,
  onRemoveGoogleDriveProjectFile,
  onRemoveAttachment,
  disabledConnections = [],
  onUpdateConnectorMute,
  onNavigateToConnectors,
  // Forwarded to ProjectDetail's rail Scheduled Tasks card —
  // clicking a row routes to the schedule detail page.
  onOpenSchedule,
  agentLabel = 'the agent',
}) {
  const { pinned, togglePin } = usePinnedProjects();
  const { isMobile } = useBreakpoint();
  const [view, setView] = useState(() =>
    localStorage.getItem('anton:projects-view') === 'list' ? 'list' : 'grid'
  );
  // List rows use a 5-column grid that breaks at phone widths. Force
  // grid mode on mobile so the toggle isn't needed; the user's
  // persisted desktop preference is preserved when they go back wide.
  const effectiveView = isMobile ? 'grid' : view;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [menuFor, setMenuFor] = useState(null); // { project, rect }
  // Card whose title is currently in inline-edit mode. Only one at a
  // time — null means no card is editing. The card owns the input;
  // we own the "which card" state.
  const [editingProjectName, setEditingProjectName] = useState(null);
  const searchRef = useRef(null);

  // Detail-mode state — when a project is "open" the page swaps from
  // the grid/list to the per-project workspace. Seeded from the
  // app-level selectedProject so the chat-header crumb (which sets
  // selectedProject + routes here) lands directly in detail.
  const [detailProject, setDetailProject] = useState(selectedProject || null);
  useEffect(() => { setDetailProject(selectedProject || null); }, [selectedProject]);

  // Persist view preference.
  useEffect(() => { localStorage.setItem('anton:projects-view', view); }, [view]);

  // ⌘K focuses the search input.
  useCollectionShortcut(searchRef);

  // Create flow — the "+ New project" button (header, empty-state,
  // trailing dashed card) opens the NewProjectModal. The modal owns
  // the full create + anton.md + file-upload pipeline; this view
  // only needs to know "did a project get created?" to refetch.
  const [creating, setCreating] = useState(false);
  const handleNewProject = () => {
    setCreating(true);
  };

  // External open trigger — fired by the mobile FAB menu's "New
  // project" option. The modal lives inside ProjectsView, so the FAB
  // navigates to this route and dispatches the event once we're
  // mounted (App.jsx handles the timing).
  useEffect(() => {
    const onOpen = () => setCreating(true);
    window.addEventListener('anton:open-new-project', onOpen);
    return () => window.removeEventListener('anton:open-new-project', onOpen);
  }, []);
  const handleCreateProject = async (name) => {
    if (onCreateProject) await onCreateProject({ name });
    else await createProjectApi(name);
    // App-level listener refetches projects on this event.
    window.dispatchEvent(new CustomEvent('anton:projects-changed'));
  };

  const handleOpen = (project) => {
    onSelectProject?.(project);
    setDetailProject(project);
  };

  // Inline rename — clicking "Rename…" in the kebab puts the card into
  // edit mode. The card's title becomes an <input>; the parent owns
  // the editing-target state so only one card edits at a time.
  const handleRenameStart = (project) => {
    setEditingProjectName(project.name);
  };
  const handleRenameCancel = () => {
    setEditingProjectName(null);
  };
  const handleRenameSubmit = async (oldName, rawNext) => {
    const next = (rawNext || '').trim();
    setEditingProjectName(null);
    if (!next || next === oldName) return;
    try {
      const result = await renameProject(oldName, next);
      const finalName = result?.name || next;
      const finalPath = result?.path || detailProject?.path;
      // If we're sitting in detail mode for the renamed project, swap
      // the local detailProject so the breadcrumb shows the new name
      // immediately — App.jsx's selectedProject won't update until the
      // user re-enters the project from the grid.
      if (detailProject?.name === oldName) {
        setDetailProject({ ...detailProject, name: finalName, path: finalPath });
      }
      // App-level listener refetches projects on this event.
      window.dispatchEvent(new CustomEvent('anton:projects-changed'));
    } catch (e) {
      alert(`Rename failed: ${e?.message || e}`);
    }
  };

  const handleReveal = async (project) => {
    if (!project?.path) return;
    try { await revealProjectInFinder(project.path); } catch {}
  };

  // Filter + sort, with pinned items always at the top.
  const visibleProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...projects];
    if (q) list = list.filter((p) => (p.name || '').toLowerCase().includes(q));

    const ts = (p) => timestampOfProject(p, tasks);
    const taskCountOf = (p) => (tasks || []).filter((t) =>
      t.projectName === p.name || t.projectPath === p.path,
    ).length;

    list.sort((a, b) => {
      switch (sort) {
        case 'name':         return a.name.localeCompare(b.name);
        case 'most-active':  return taskCountOf(b) - taskCountOf(a);
        case 'least-active': return taskCountOf(a) - taskCountOf(b);
        case 'recent':
        default:             return ts(b) - ts(a);
      }
    });

    // Pinned to top, preserving relative sort within each group.
    const pinnedList   = list.filter((p) => pinned.has(p.name));
    const unpinnedList = list.filter((p) => !pinned.has(p.name));
    return [...pinnedList, ...unpinnedList];
  }, [projects, tasks, search, sort, pinned]);

  if (detailProject) {
    return (
      <ProjectDetail
        project={detailProject}
        projects={projects}
        tasks={tasks}
        scheduled={scheduled}
        scheduleRunsIndex={scheduleRunsIndex}
        models={models}
        onSend={onSendInProject}
        onSelectTask={onSelectTask}
        onDeleteTask={onDeleteTask}
        onMoveTaskToProject={onMoveTaskToProject}
        attachments={attachments}
        connectors={connectors}
        onNavigateToConnectors={onNavigateToConnectors}
        onAttachFiles={onAttachFiles}
        onAddGoogleDriveFiles={onAddGoogleDriveFiles}
        onAddGoogleDriveProjectFiles={onAddGoogleDriveProjectFiles}
        onFetchGoogleDriveProjectFiles={onFetchGoogleDriveProjectFiles}
        onRemoveGoogleDriveProjectFile={onRemoveGoogleDriveProjectFile}
        onRemoveAttachment={onRemoveAttachment}
        disabledConnections={disabledConnections}
        onUpdateConnectorMute={onUpdateConnectorMute}
        onShowAll={() => setDetailProject(null)}
        editing={editingProjectName === detailProject.name}
        onRenameStart={handleRenameStart}
        onRenameSubmit={(rawNext) => handleRenameSubmit(detailProject.name, rawNext)}
        onRenameCancel={handleRenameCancel}
        onReveal={handleReveal}
        onDelete={(proj) => {
          // Bounce back to the grid first so we don't render a detail
          // page for a project that's about to disappear, then defer
          // the destructive call to App.jsx's confirmation flow.
          setDetailProject(null);
          onDeleteProject?.(proj);
        }}
        onOpenSchedule={onOpenSchedule}
      />
    );
  }

  return (
    // Background intentionally omitted so the gravity-field canvas
    // painted behind the React root shows through. Earlier this was
    // `background: 'var(--bg)'`, which masked the field on this view.
    <div className="scroll-clean" style={{
      flex: 1, overflowY: 'auto',
      display: 'flex', flexDirection: 'column',
    }}>
      <PageHeader
        title="Projects"
        subtitle={`Workspaces ${agentLabel} uses to group conversations, memory, and outputs.`}
        actions={<NewProjectButton onClick={handleNewProject} />}
        // Bake the breathing room into the header itself rather than a
        // sibling spacer. The previous 18px spacer div collapsed in
        // some grid-view layouts (the flex column let it disappear
        // under certain content heights), which made the gap between
        // subtitle and the search bar look smaller in grid than in
        // list. Embedding it as `marginBottom` on the subtitle makes
        // the spacing immune to whatever the body below decides to do.
      />

      <FilterRow
        search={
          <SearchInput
            value={search}
            onChange={setSearch}
            inputRef={searchRef}
            placeholder="Search projects"
          />
        }
        sort={<SortPill value={sort} onChange={setSort} options={SORT_OPTIONS} />}
        view={<span className="proj-view-toggle"><ToggleGroup value={view} onValueChange={setView} size="md" aria-label="View" options={[{ value: 'grid', label: 'Grid', icon: Ico.grid(13) }, { value: 'list', label: 'List', icon: Ico.list(13) }]} /></span>}
        counts={
          <ProjectsCounts
            search={search}
            total={projects.length}
            filtered={visibleProjects.length}
            pinnedCount={visibleProjects.filter((p) => pinned.has(p.name)).length}
          />
        }
      />

      {loading ? (
        <div className="pt-2 px-8 pb-[60px] grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 mt-5">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<span className="inline-flex text-ink-4">{Ico.folder(32)}</span>}
          title="No projects yet"
          description="Create your first project to start grouping conversations and outputs."
          action={<NewProjectButton onClick={handleNewProject} />}
          style={{ flex: 1 }}
        />
      ) : effectiveView === 'grid' ? (
        <div className="pt-2 px-8 pb-[60px] grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 mt-5">
          {visibleProjects.map((p) => (
            <ProjectCard
              key={p.name || p.path}
              project={p}
              isSelected={selectedProject?.name === p.name}
              tasks={tasks}
              scheduled={scheduled}
              pinned={pinned.has(p.name)}
              editing={editingProjectName === p.name}
              onOpen={handleOpen}
              onTogglePin={(proj, next) => togglePin(proj.name, next)}
              onMenuOpen={(proj, rect) => setMenuFor({ project: proj, rect })}
              isMenuOpen={menuFor?.project?.name === p.name}
              onRenameSubmit={(next) => handleRenameSubmit(p.name, next)}
              onRenameCancel={handleRenameCancel}
            />
          ))}
          {/* Trailing dashed "+ New project" card — clicking just
              opens the modal (no inline-edit mode any more). The
              modal handles name + instructions + file uploads in a
              single confirmable surface. */}
          <button
            type="button"
            onClick={handleNewProject}
            className="proj-new-tile min-h-[120px] rounded-card px-4 py-4 bg-transparent border border-dashed border-line-2 text-ink-3 flex flex-col items-center justify-center gap-2 cursor-pointer [transition:border-color_.15s_ease,color_.15s_ease] font-[inherit]"
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.color = 'var(--accent)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = 'var(--line-2)';
              e.currentTarget.style.color = 'var(--ink-3)';
            }}
          >
            <span className="inline-flex">{Ico.plus(16)}</span>
            <span className="font-[var(--font-body)] text-sm font-medium">
              New project
            </span>
          </button>
        </div>
      ) : (
        <div className="pt-2 px-8 pb-[60px] mt-5">
          <ListHeader />
          {visibleProjects.map((p) => (
            <ListRow
              key={p.name || p.path}
              project={p}
              tasks={tasks}
              scheduled={scheduled}
              pinned={pinned.has(p.name)}
              onOpen={handleOpen}
              onTogglePin={(proj, next) => togglePin(proj.name, next)}
              onMenuOpen={(proj, rect) => setMenuFor({ project: proj, rect })}
              isMenuOpen={menuFor?.project?.name === p.name}
              editing={editingProjectName === p.name}
              onRenameSubmit={(next) => handleRenameSubmit(p.name, next)}
              onRenameCancel={handleRenameCancel}
            />
          ))}
        </div>
      )}

      <ProjectMenu
        open={!!menuFor}
        anchorRect={menuFor?.rect}
        project={menuFor?.project}
        pinned={menuFor ? pinned.has(menuFor.project.name) : false}
        isReserved={menuFor?.project?.name === 'general' || menuFor?.project?.name === 'default'}
        onClose={() => setMenuFor(null)}
        onOpen={handleOpen}
        onRename={handleRenameStart}
        onTogglePin={(proj, next) => togglePin(proj.name, next)}
        onReveal={host.isWeb ? undefined : handleReveal}
        onDelete={(proj) => onDeleteProject?.(proj)}
      />

      {/* "Start a new project" modal — replaces the inline-edit
          dashed card pattern. Owns name + instructions + file
          uploads, then notifies the parent so the projects list
          refetches and the new project appears in the grid. */}
      <NewProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          // Reuse the existing parent callback so the App-level
          // listener refetches projects and updates the active
          // project pointer. `result.name` is the canonical
          // sanitised name returned by the server.
          onCreateProject?.({ name: result?.name, _alreadyCreated: true });
        }}
      />
    </div>
  );
}
