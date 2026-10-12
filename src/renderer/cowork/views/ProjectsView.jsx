// Projects page.
//
// Header (title + subtitle + accent "+ New project") • Filter row
// (search ⌘K + sort + count + grid/list toggle) • cards (default) or
// rows on the collection kit. A project is a place you work in, so it
// reads as a card; the list is the same item with its meta inline.
// See components/project/ProjectCard.jsx.

import { useEffect, useMemo, useRef, useState } from 'react';
import { projectLabel, projectMatches } from '../lib/projectLabel';
import Ico from '../components/Icons';
import Composer from '../components/Composer';
import { WorkingFolderBox, ContextBox, ScheduledBox } from '../components/rail';
import { TaskList } from '../components/task';
import { ProjectCard, ProjectRow } from '../components/project/ProjectCard';
import NewProjectModal from '../components/project/NewProjectModal';
import {
  PageHeader,
  FilterRow,
  SearchInput,
  SortPill,
  ViewToggle,
  CollectionState,
  CardGrid,
  ListGroup,
  useCollectionShortcut,
  useCollectionView,
} from '../components/collection';
import {
  createProject as createProjectApi,
  renameProject,
  revealProjectInFinder,
} from '../api';
import { Button, Menu, Tooltip } from '../components/ui';
import { Crumb, CrumbSep, CrumbCurrent } from '../components/ui/Crumb';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { host } from '../../platform/host';
import SharedResourceAttribution from '../components/SharedResourceAttribution';
import {
  canUseSharedResource,
  isReservedProjectName,
} from '../lib/sharedResourceAccess';

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

/* Equality probe for the server-owned fields the detail refresh tracks. Both are
   small plain payloads, so a serialized compare is enough to tell "the server
   said the same thing again" from "hand the detail subtree a new object".
   `?? null` folds a missing field and an explicit null into one value so an
   omitted block reads the same either way. */
function sameServerField(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
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

// Page padding of the card grid and the row group, shared with their
// loading skeletons so loading does not shift the layout.
const GRID_CLASS = 'px-8 pb-[60px]';
const LIST_CLASS = 'mx-8 mb-[60px]';

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
    ? `${filtered} of ${total} projects`
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
  const canRename = !isReserved && canUseSharedResource(project, 'canRename');
  const directoryIsExternal = project?.capabilities?.directoryIsExternal === true;
  const canDelete = !isReserved && canUseSharedResource(project, 'canDelete');
  const items = [
    !hideOpen && {
      id: 'open',
      label: 'Open',
      icon: Ico.folder(14),
      onClick: () => onOpen?.(project),
    },
    !hidePin && {
      id: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: Ico.pin(14),
      onClick: () => onTogglePin?.(project, !pinned),
    },
    !isReserved && {
      id: 'rename',
      label: 'Rename…',
      icon: Ico.edit(14),
      disabled: !canRename,
      // A project pointed at a folder the user chose cannot be renamed
      // because renaming moves the directory, and that folder is theirs.
      // Saying "Admin or creator" there blames the wrong thing.
      hint: !canRename
        ? (directoryIsExternal ? 'Chosen folder' : 'Admin or creator')
        : undefined,
      title: !canRename
        ? (directoryIsExternal
            ? 'This project points at a folder you chose. Rename the folder itself instead.'
            : 'You do not have permission to rename this project.')
        : undefined,
      onClick: () => onRename?.(project),
    },
    onReveal && {
      id: 'reveal',
      label: 'Reveal in Finder',
      icon: Ico.externalLink(14),
      onClick: () => onReveal?.(project),
    },
    { divider: true },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Ico.trash(14),
      danger: true,
      disabled: undeletable || !canDelete,
      hint: !undeletable && !canDelete ? 'Admin or creator' : undefined,
      title: undeletable
        ? "The General project can't be deleted — it's the orphan-fallback workspace."
        : !canDelete
          ? 'You do not have permission to delete this project.'
          : undefined,
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

// ─── Project detail (per-project workspace) ──────────────────────────────
//
// Same shape as ChatView. Header crumb is `Projects › [name]`; left
// column is composer-on-top + per-project task list; right rail is
// Working folder + Context + Scheduled. Restored after a brief detour
// where I'd accidentally folded this into the home route — the user
// wants the in-page detail view to stay.

function ProjectDetail({
  project, projects, tasks, scheduled, scheduleRunsIndex = {}, models, modelMeta, onSend, onSelectTask,
  onDeleteTask, onMoveTaskToProject, onShowAll,
  model, onModelChange,
  effort, onEffortChange,
  codingModeEnabled = false,
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
  // The server is still working through this project's delete.
  deleting = false,
  onRenameStart,
  onRenameSubmit,
  onRenameCancel,
  onReveal,
  onDelete,
  // Clicking a row inside the rail's Scheduled Tasks card routes to
  // the schedule detail page. Wired by App.jsx — same handler the
  // ScheduledView grid uses.
  onOpenSchedule,
  onOpenSettings,
  codingModelDefault,
  harnessClaudeCodeEnabled,
  showMobileContext = false,
}) {
  const projectTasks = (tasks || [])
    .filter((t) => t.projectName === project.name || t.projectPath === project.path)
    .sort((a, b) => timestampOfProject(b, []) - timestampOfProject(a, []) || 0);
  const projectSchedules = (scheduled || [])
    .filter((s) => (s.project || s.projectName) === project.name);

  const [railOpen, setRailOpen] = useState(true);
  const [menuRect, setMenuRect] = useState(null);
  const [actionFocused, setActionFocused] = useState(false);
  const kebabRef = useRef(null);
  const renameInputRef = useRef(null);
  const isReserved = isReservedProjectName(project.name);
  const { revealed, hoverProps } = useRevealOnHover(!!menuRect);
  /* Reveal state only, never the reserved check. A reserved project's kebab is
     withheld by not rendering it at all, so no stylesheet can hand a coarse
     pointer a tappable trigger into a menu with nothing but a disabled Delete. */
  const showKebab = showMobileContext || revealed || actionFocused;

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
    const next = renameInputRef.current?.value ?? projectLabel(project);
    onRenameSubmit?.(next);
  };

  return (
    <div className={`project-detail-root flex-1 min-h-0 grid grid-rows-[1fr] bg-transparent font-body text-ink-2 relative overflow-hidden [transition:grid-template-columns_var(--dur-layout)_var(--ease-out)] ${railOpen ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-[minmax(0,1fr)_0px]'}`}>
      <div className="relative overflow-hidden grid grid-rows-[auto_1fr] min-w-0 min-h-0">
        {/* Floating expand-rail button (mirrors ChatView). */}
        {!showMobileContext && (
          <Tooltip content="Expand panel">
            <button
              type="button"
              onClick={() => setRailOpen(true)}
              aria-label="Expand panel"
              style={{
                // Dynamic: the resting/hover-mirroring transition delay differs
                // by railOpen (none vs three/two stagger steps) — not a clean binary class swap.
                transition:
                  `opacity var(--dur-layout) var(--ease-out) ${railOpen ? '0ms' : 'calc(3 * var(--dur-stagger))'}, ` +
                  `transform var(--dur-layout) var(--ease-out) ${railOpen ? '0ms' : 'calc(2 * var(--dur-stagger))'}`,
              }}
              className={`project-detail-rail-toggle absolute top-3.5 right-3.5 z-10 w-7 h-7 rounded-md inline-grid place-items-center cursor-pointer bg-transparent hover:bg-surface-2 border-0 text-ink-3 hover:text-ink [-webkit-app-region:no-drag] ${railOpen ? 'opacity-0 translate-x-2 pointer-events-none' : 'opacity-100 translate-x-0 pointer-events-auto'}`}
            >
              {Ico.panelExpandLeft(16)}
            </button>
          </Tooltip>
        )}

        {/* Header — Projects › [project] crumb. Top padding honours the
            shell's --titlebar-safe-top so the crumb drops below the traffic
            lights when the sidebar isn't docked (0 → normal 14px), staying
            left-aligned with the detail below. */}
        <div className="flex items-center justify-between pt-[max(14px,var(--titlebar-safe-top,0px))] pb-[14px] pr-7 pl-7 border-b border-t-0 border-x-0 border-solid border-line bg-transparent shrink-0 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 flex-[1_1_0] overflow-hidden">
            <Crumb label="Projects" onClick={onShowAll} title="All projects" />
            <CrumbSep />
            <div
              {...hoverProps}
              className="flex items-center gap-1 min-w-0 flex-[1_1_0]"
            >
              {editing ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  defaultValue={projectLabel(project)}
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
                  className="flex-[1_1_0] min-w-0 font-display font-semibold text-[13px] tracking-normal text-ink bg-surface-2 border border-solid border-accent rounded-[5px] py-0.5 px-1.5 outline-none"
                />
              ) : (
                <CrumbCurrent
                  label={projectLabel(project)}
                  className="flex-[0_1_auto]"
                />
              )}
              {deleting && (
                <span
                  aria-live="polite"
                  className="font-mono text-[10.5px] text-ink-4 tracking-[0.04em] shrink-0"
                >
                  Deleting…
                </span>
              )}
              {!editing && !isReserved && !deleting && (
                <button
                  ref={kebabRef}
                  type="button"
                  aria-label="Project menu"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = kebabRef.current?.getBoundingClientRect();
                    setMenuRect(rect || null);
                  }}
                  onFocus={() => setActionFocused(true)}
                  onBlur={() => setActionFocused(false)}
                  className={`project-action-trigger w-[22px] h-[22px] rounded-[5px] bg-transparent hover:bg-surface-2 border-0 text-ink-3 hover:text-ink inline-grid place-items-center shrink-0 cursor-pointer [-webkit-app-region:no-drag] [transition:opacity_var(--dur-hover)_ease,color_var(--dur-hover)_ease,background_var(--dur-hover)_ease] ${showKebab ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                >
                  {Ico.moreVert(14)}
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

        <div data-scroll="true" className="min-h-0 overflow-y-auto overflow-x-hidden pt-8 px-7 pb-[60px] bg-transparent [-webkit-app-region:no-drag]">
          <div className="max-w-[720px] mx-auto flex flex-col gap-7">
            <div className="flex flex-col gap-2">
              <SharedResourceAttribution resource={project} />
              <Composer
                onSend={onSend}
                project={project}
                onProjectChange={() => {}}
                model={model}
                onModelChange={onModelChange}
                effort={effort}
                onEffortChange={onEffortChange}
                projects={projects || []}
                models={models || []}
                modelMeta={modelMeta}
                attachments={attachments}
                connectors={connectors}
                onNavigateToConnectors={onNavigateToConnectors}
                onAttachFiles={onAttachFiles}
                onAddGoogleDriveFiles={onAddGoogleDriveFiles}
                onRemoveAttachment={onRemoveAttachment}
                disabledConnections={disabledConnections}
                onUpdateConnectorMute={onUpdateConnectorMute}
                metaReadOnly
                modelReadOnly={false}
                codingModeEnabled={codingModeEnabled}
                onOpenSettings={onOpenSettings}
                codingModelDefault={codingModelDefault}
                harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
                sendsMeta
                placeholder={`Start a new task in ${projectLabel(project)}…`}
                // Keyed on the id, not the name: renaming a project must not
                // orphan the draft the user is in the middle of typing.
                draftKey={`project:${project.id || project.name}`}
              />
            </div>

            {showMobileContext && (
              <div className="project-detail-mobile-context">
                <ContextBox
                  project={project}
                  onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
                  onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
                  onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
                />
              </div>
            )}

            <TaskList
              tasks={projectTasks}
              schedules={scheduled || []}
              scheduleRunsIndex={scheduleRunsIndex}
              onSelectTask={onSelectTask}
              onOpenSchedule={onOpenSchedule}
              onDeleteTask={onDeleteTask}
              onMoveTaskToProject={onMoveTaskToProject}
            />
          </div>
        </div>
      </div>

      {!showMobileContext && (
        <aside className={`project-detail-rail bg-transparent pt-[14px] px-[14px] pb-[22px] flex flex-col gap-[10px] overflow-x-hidden overflow-y-auto min-w-0 [-webkit-app-region:no-drag] [transition:opacity_var(--dur-layout)_ease] ${railOpen ? 'visible opacity-100' : 'invisible opacity-0'}`}>
          <div className="project-detail-rail-toggle-row flex items-center justify-end shrink-0">
            <Tooltip content="Collapse panel">
              <button
                type="button"
                onClick={() => setRailOpen(false)}
                aria-label="Collapse panel"
                className="project-detail-rail-toggle cursor-pointer bg-transparent hover:bg-surface-2 border-0 w-[26px] h-[26px] rounded-md inline-grid place-items-center text-ink-3 hover:text-ink [-webkit-app-region:no-drag]"
              >
                {Ico.panelCollapseRight(16)}
              </button>
            </Tooltip>
          </div>
          <WorkingFolderBox project={project} />
          <ContextBox
            projects={projects}
            project={project}
            onAddGoogleDriveFiles={onAddGoogleDriveProjectFiles}
            onFetchGoogleDriveFiles={onFetchGoogleDriveProjectFiles}
            onRemoveGoogleDriveFile={onRemoveGoogleDriveProjectFile}
          />
          <ScheduledBox items={projectSchedules} onSelect={onOpenSchedule} />
        </aside>
      )}
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
  modelMeta,
  model,
  onModelChange,
  effort,
  onEffortChange,
  loading = false,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  // Keys (id, else name) of the projects whose DELETE the server is still
  // working through. Their card, row, and detail header say so and stop
  // offering the actions that would fire a second one.
  deletingProjectKeys = [],
  onSendInProject,
  codingModeEnabled = false,
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
  onOpenSettings,
  codingModelDefault,
  harnessClaudeCodeEnabled,
}) {
  const { pinned, togglePin } = usePinnedProjects();
  // Phones always get the grid; see ViewToggle.
  const { view, setView, effectiveView, isMobile } = useCollectionView('anton:projects-view');
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
  /* A refetch can carry changed role capabilities or newer attribution while the
     detail page stays mounted, so those two server-owned fields are the only
     ones copied across. Name and path stay local: a list response that started
     before a rename lands after it, and spreading it would flip the breadcrumb
     back to the old name. Capabilities are assigned rather than merged so a
     response that omits them drops the previous decision instead of holding an
     allow open. An unchanged pair returns the same object so the composer,
     context box, and task list do not re-render on every poll. */
  useEffect(() => {
    setDetailProject((current) => {
      if (!current) return current;
      const fresh = projects.find((project) => (
        (current.id && project.id === current.id)
        || (!current.id && project.name === current.name)
      ));
      if (!fresh) return current;
      if (
        sameServerField(current.capabilities, fresh.capabilities)
        && sameServerField(current.attribution, fresh.attribution)
      ) return current;
      return {
        ...current,
        capabilities: fresh.capabilities,
        attribution: fresh.attribution,
      };
    });
  }, [projects]);

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

  const isDeleting = (project) => (
    !!project && deletingProjectKeys.includes(project.id || project.name)
  );

  const handleOpen = (project) => {
    onSelectProject?.(project);
    setDetailProject(project);
  };

  // Inline rename — clicking "Rename…" in the kebab puts the card into
  // edit mode. The card's title becomes an <input>; the parent owns
  // the editing-target state so only one card edits at a time.
  const handleRenameStart = (project) => {
    if (!canUseSharedResource(project, 'canRename')) return;
    setEditingProjectName(project.name);
  };
  const handleRenameCancel = () => {
    setEditingProjectName(null);
  };
  const handleRenameSubmit = async (oldName, rawNext) => {
    /* Leave edit mode before any guard can bail out. Every early return below
       used to strand the header as an input that blur and Enter both ignored,
       with Escape the only way back to the project name. */
    setEditingProjectName(null);
    /* The list is not the only place the project is known: detail can be seeded
       from selectedProject before the list loads, and a second rename is
       submitted before the refetch carrying the first one lands. */
    const sourceProject = projects.find((project) => project.name === oldName)
      || (detailProject?.name === oldName ? detailProject : null);
    if (!sourceProject) return;
    if (!canUseSharedResource(sourceProject, 'canRename')) {
      alert('You do not have permission to rename this project.');
      return;
    }
    const next = (rawNext || '').trim();
    if (!next || next === oldName) return;
    try {
      const result = await renameProject(sourceProject, next);
      const finalName = result?.name || next;
      const finalPath = result?.path || sourceProject.path;
      // If we're sitting in detail mode for the renamed project, swap
      // the local detailProject so the breadcrumb shows the new name
      // immediately — App.jsx's selectedProject won't update until the
      // user re-enters the project from the grid.
      setDetailProject((current) => {
        if (!current) return current;
        const isRenamedProject = sourceProject.id && current.id
          ? sourceProject.id === current.id
          : current.name === oldName;
        return isRenamedProject
          ? { ...current, ...result, name: finalName, path: finalPath }
          : current;
      });
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
    // Label OR slug: searching only the slug loses the project the user
    // can see in the list (ENG-1676).
    if (q) list = list.filter((p) => projectMatches(p, q));

    const ts = (p) => timestampOfProject(p, tasks);
    const taskCountOf = (p) => (tasks || []).filter((t) =>
      t.projectName === p.name || t.projectPath === p.path,
    ).length;

    list.sort((a, b) => {
      switch (sort) {
        // By the label, not the slug: an A-Z sort keyed on `untitled-project-2`
        // renders as no order at all for a non-Latin project (ENG-1676).
        case 'name':         return (projectLabel(a) || '').localeCompare(projectLabel(b) || '');
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

  // What the card and the row share; the card adds selection.
  const itemProps = (p) => ({
    project: p,
    tasks,
    scheduled,
    pinned: pinned.has(p.name),
    editing: editingProjectName === p.name,
    deleting: isDeleting(p),
    onOpen: handleOpen,
    onTogglePin: (proj, next) => togglePin(proj.name, next),
    onMenuOpen: (proj, rect) => setMenuFor({ project: proj, rect }),
    onRenameSubmit: (next) => handleRenameSubmit(p.name, next),
    onRenameCancel: handleRenameCancel,
  });

  if (detailProject) {
    return (
      <ProjectDetail
        project={detailProject}
        projects={projects}
        tasks={tasks}
        scheduled={scheduled}
        scheduleRunsIndex={scheduleRunsIndex}
        models={models}
        modelMeta={modelMeta}
        model={model}
        onModelChange={onModelChange}
        effort={effort}
        onEffortChange={onEffortChange}
        onSend={onSendInProject}
        onSelectTask={onSelectTask}
        onDeleteTask={onDeleteTask}
        onMoveTaskToProject={onMoveTaskToProject}
        codingModeEnabled={codingModeEnabled}
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
        onOpenSettings={onOpenSettings}
        codingModelDefault={codingModelDefault}
        harnessClaudeCodeEnabled={harnessClaudeCodeEnabled}
        showMobileContext={isMobile}
        onShowAll={() => setDetailProject(null)}
        editing={editingProjectName === detailProject.name}
        deleting={isDeleting(detailProject)}
        onRenameStart={handleRenameStart}
        onRenameSubmit={(rawNext) => handleRenameSubmit(detailProject.name, rawNext)}
        onRenameCancel={handleRenameCancel}
        onReveal={handleReveal}
        onDelete={(proj) => {
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
    <div className="scroll-clean flex-1 overflow-y-auto flex flex-col">
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
        view={<ViewToggle value={view} onValueChange={setView} />}
        counts={loading ? null : (
          <ProjectsCounts
            search={search}
            total={projects.length}
            filtered={visibleProjects.length}
            pinnedCount={visibleProjects.filter((p) => pinned.has(p.name)).length}
          />
        )}
      />

      <CollectionState
        loading={loading}
        total={projects.length}
        shown={visibleProjects.length}
        query={search}
        onClear={() => setSearch('')}
        // The skeleton takes the loaded layout's own wrapper classes.
        skeleton={effectiveView === 'grid' ? 'cards' : 'group'}
        skeletonClassName={effectiveView === 'grid' ? GRID_CLASS : LIST_CLASS}
        empty={{
          icon: <span className="inline-flex text-ink-4">{Ico.folder(32)}</span>,
          title: 'No projects yet',
          description: 'Create your first project to start grouping conversations and outputs.',
          action: <NewProjectButton onClick={handleNewProject} />,
          style: { flex: 1 },
        }}
      >
        {effectiveView === 'grid' ? (
          <CardGrid className={GRID_CLASS}>
            {visibleProjects.map((p) => (
              <ProjectCard key={p.name || p.path} {...itemProps(p)} isSelected={selectedProject?.name === p.name} />
            ))}
          </CardGrid>
        ) : (
          <ListGroup className={LIST_CLASS}>
            {visibleProjects.map((p) => (
              <ProjectRow key={p.name || p.path} {...itemProps(p)} />
            ))}
          </ListGroup>
        )}
      </CollectionState>

      <ProjectMenu
        open={!!menuFor}
        anchorRect={menuFor?.rect}
        project={menuFor?.project}
        pinned={menuFor ? pinned.has(menuFor.project.name) : false}
        isReserved={isReservedProjectName(menuFor?.project?.name)}
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
