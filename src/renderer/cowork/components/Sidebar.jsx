import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner, Kbd, Badge, Input, Button, Tooltip } from './ui';
import { TaskMenu } from './TaskMenu';
import RecentsModal from './RecentsModal';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { host } from '../../platform/host';
import { relativeAge } from '../lib/formatTime';
import { useAccountUser } from '../hooks/useAccountUser';
import UserMenu from './UserMenu';
import WorkspaceSelector from './WorkspaceSelector';
import OnboardingChecklist from './onboarding/OnboardingChecklist';
import FirstArtifactTip from './onboarding/FirstArtifactTip';
import { CodeSidebarSessions } from '../code/CodeSidebarSessions';
import WorkspaceModeSwitch from './WorkspaceModeSwitch';

const UPDATE_TONE_CLASS = {
  ready: {
    box: 'bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] hover:bg-[color-mix(in_srgb,var(--sage-500)_22%,transparent)]',
    dot: 'bg-[var(--sage-500,#5D9287)]',
    action: 'text-[var(--sage-500,#5D9287)]',
  },
  progress: {
    box: 'bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)]',
    dot: 'bg-[var(--sage-500,#5D9287)]',
    action: 'text-[var(--sage-500,#5D9287)]',
  },
  error: {
    box: 'bg-[rgba(196,127,0,0.12)] border-[rgba(196,127,0,0.30)] hover:bg-[rgba(196,127,0,0.22)]',
    dot: 'bg-[var(--warning,#c47f00)]',
    action: 'text-[var(--warning,#c47f00)]',
  },
};

const IS_MAC = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const shortcut = (key) => `${MOD_LABEL}${key}`;

function NavItem({ icon, label, active, onClick, badge, comingSoon, elementRef }) {
  return (
    <button
      ref={elementRef}
      className={`nav-item${active ? ' active' : ''}`}
      onClick={comingSoon ? undefined : onClick}
      aria-label={label}
      data-coming-soon={comingSoon ? '' : undefined}
      style={comingSoon ? { opacity: 0.55, cursor: 'default' } : undefined}
    >
      <span className="nav-row__icon inline-flex shrink-0 items-center">{icon}</span>
      {/* min-w-0 allows long labels to truncate within the sidebar instead of wrapping. */}
      <span className="nav-row__label flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {badge != null && (
        <Badge variant="muted" size="xs">{badge}</Badge>
      )}
      {comingSoon && (
        <Badge variant="muted" size="xs">Soon</Badge>
      )}
    </button>
  );
}

function RecentItem({ task, onClick, projects, onPin, onUnpin, onRename, onDelete, onMoveToProject, showTimestamp = true, isActive = false, selected = false, agentLabel }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const triggerRef = useRef(null);
  // Latch Enter/Escape so the subsequent blur cannot commit twice or undo cancellation.
  const renameDone = useRef(false);
  const { revealed: showKebab, hoverProps } = useRevealOnHover(menuOpen);

  const startRename = () => {
    setDraft(task.title || '');
    renameDone.current = false;
    setEditing(true);
  };
  const submitRename = () => {
    if (renameDone.current) return;
    renameDone.current = true;
    setEditing(false);
    const next = draft.trim();
    if (!next || next === (task.title || '').trim()) return;
    onRename?.(task.id, next);
  };

  const openMenu = (e) => {
    e.stopPropagation();
    e.preventDefault();
    // The menu ignores outside presses on its trigger, so a second trigger click must close it.
    if (menuOpen) { setMenuOpen(false); return; }
    if (!triggerRef.current) return;
    setAnchorRect(triggerRef.current.getBoundingClientRect());
    setMenuOpen(true);
  };

  // Reserve one slot for timestamp/kebab cross-fades so hovering cannot shift rows.
  return (
    <div
      className="relative flex"
      {...hoverProps}
    >
      {editing ? (
        <Input
          size="sm"
          value={draft}
          onChange={setDraft}
          aria-label="Rename task"
          autoFocus
          onFocus={(e) => { try { e.target.select(); } catch {} }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
            else if (e.key === 'Escape') {
              e.preventDefault();
              renameDone.current = true;
              setEditing(false);
            }
          }}
          onBlur={submitRename}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="flex-1 min-w-0"
        />
      ) : (
      <button className={`recent-item${selected ? ' is-selected' : ''} flex-1 min-w-0`} onClick={onClick} aria-label={task.title}>
        <span className="recent-row__title overflow-hidden text-ellipsis whitespace-nowrap flex-1 pr-2">
          {task.title || 'Untitled'}
          {task._scheduleGroup && (() => {
            const n = task._scheduleGroup.runs;
            return (
              <span className="text-ink-4 font-normal ml-1.5 whitespace-nowrap">
                <span className="text-ink-5 mr-1">·</span>
                {n} {n === 1 ? 'run' : 'runs'}
              </span>
            );
          })()}
        </span>

        <span className="relative w-[50px] h-[18px] -mr-1.5 shrink-0 inline-flex items-center justify-end">
          <span
            className="absolute inset-0 inline-flex items-center justify-end font-[family-name:var(--font-sans)] text-xs text-ink-4 gap-1.5 [transition:opacity_120ms_ease]"
            style={{ opacity: (showKebab || (!showTimestamp && !isActive)) ? 0 : 1 }}
          >
            {isActive ? (
              <span
                className="pulse-dot inline-block w-[7px] h-[7px] mr-[7.5px] rounded-full bg-accent shadow-[0_0_0_2px_color-mix(in_srgb,var(--sage-500)_18%,transparent)]"
                title={`${agentLabel || 'Anton'} is working on this task`}
                aria-label="Active"
              />
            ) : (
              showTimestamp ? (relativeAge(task.updatedAt || task.subtitle) || task.subtitle || '') : ''
            )}
          </span>
          <span
            ref={triggerRef}
            role="button"
            aria-label="Task menu"
            onClick={openMenu}
            className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex w-[22px] h-[22px] items-center justify-center text-ink-3 rounded-[5px] cursor-pointer hover:bg-surface-2 hover:text-ink [transition:opacity_120ms_ease,background_120ms_ease,color_120ms_ease]"
            style={{ opacity: showKebab ? 1 : 0, pointerEvents: showKebab ? 'auto' : 'none' }}
          >
            {Ico.moreVert(13)}
          </span>
        </span>
      </button>
      )}

      <TaskMenu
        task={task}
        projects={projects}
        agentLabel={agentLabel}
        open={menuOpen}
        anchorRect={anchorRect}
        onClose={() => setMenuOpen(false)}
        onPin={() => onPin?.(task)}
        onUnpin={() => onUnpin?.(task.id)}
        hideRename={!onRename}
        onRename={startRename}
        onDelete={() => onDelete?.(task.id)}
        hideMoveToProject={!onMoveToProject}
        onMoveToProject={() => onMoveToProject?.(task)}
      />
    </div>
  );
}

export default function Sidebar({
  tasks,
  // Distinguish loading and failure from a confirmed empty account; default ready preserves
  // existing callers.
  tasksStatus = 'ready',
  onRetryTasks,
  pins = [],
  scheduledCount = 0,
  projectsCount = 0,
  artifactsCount = 0,
  connectorsCount = 0,
  activeRoute,
  activeTaskId,
  activeWorkspace = 'cowork',
  showWorkspaceSwitch = false,
  activeCodeRoute = null,
  codingSessions = [],
  activeCodingSessionId = null,
  serverOnline,
  serverBusy = false,
  serverBusyKind = 'starting', // 'starting' | 'stopping'
  onNavigate,
  onWorkspaceChange = () => {},
  onSelectTask,
  onNewTask,
  onSelectCodingSession,
  onSetCodingSessionPinned,
  onNewCodingTask,
  onOpenCodingProjects,
  onOpenCodingConnectors,
  onOpenCodingSkills,
  onOpenSearch,
  collapsed = false,
  onToggleCollapsed,
  onPinTask,
  onUnpinTask,
  onRenameTask,
  onDeleteTask,
  onMoveTaskToProject,
  projects = [],
  // Group sibling schedule runs so recurring tasks cannot flood recents.
  schedules = [],
  scheduleRunsIndex = {},
  onOpenSchedule,
  onToggleServer,
  onShowServerHelp,
  // The single derived update banner (deriveUpdateBanner), or null.
  updateBanner = null,
  onUpdateAction, // (action: 'apply-ota' | 'shell-auto' | 'download-installer') => void
  onDismissUpdate, // dismisses the (dismissible) manual installer notice
  agentLabel,
  settingsActive = false,
  isSsoConnected = false,
  // Show-nav-counters also controls each Recent row's time-since slot.
  showCounters = true,
  navTitle = null,
  navLogo = null,
  // Omit onStartChat to hide the onboarding checklist.
  onStartChat = null,
  // App owns arming/permanent dismissal; opening Live Artifacts also dismisses the anchored tip.
  artifactTipOpen = false,
  onArtifactTipDismiss,
}) {
  const codeRoute = activeWorkspace === 'code';
  const accountUser = useAccountUser(isSsoConnected);

  // Keep quick toggles while the status pill hides the user menu that normally hosts those
  // controls.
  const showsStatusPill = !host.isWeb && (!serverOnline || serverBusy);
  const showsUserMenu = !showsStatusPill && !!accountUser;

  // Join pins separately: the conversations endpoint does not know pinned state.
  const pinnedIds = new Set(
    (pins || []).filter((p) => p.item_type === 'conversation').map((p) => p.item_id)
  );
  const tasksWithPin = tasks.map((t) =>
    pinnedIds.has(t.id) ? { ...t, pinned: true } : t
  );

  // Derive activity from the same _streaming placeholders as ChatView so dots track stream
  // lifecycle.
  const activeTaskIds = new Set(
    tasks
      .filter((t) => (t.messages || []).some((m) => m && m.role === '_streaming'))
      .map((t) => t.id)
  );

  // Exclude pinned tasks from recents to avoid duplicate rows.
  const recentsRaw = tasksWithPin.filter((t) => !pinnedIds.has(t.id));

  // Group schedule runs using the newest run timestamp so recurring tasks do not flood recents.
  const _ts = (raw) => {
    if (!raw) return 0;
    if (typeof raw === 'number') return raw;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
  };
  const _scheduleById = new Map((schedules || []).map((s) => [s?.id, s]));
  const _resolveSchedId = (t) => t?.scheduledId || scheduleRunsIndex?.[t?.id] || null;

  const recentsAll = (() => {
    const out = [];
    const groups = new Map();
    for (const t of recentsRaw) {
      const sid = _resolveSchedId(t);
      if (!sid) {
        out.push(t);
        continue;
      }
      let g = groups.get(sid);
      if (!g) {
        const sched = _scheduleById.get(sid);
        const baseTitle = sched?.title || t.title || 'Scheduled task';
        g = {
          id: `sched:${sid}`,
          title: baseTitle,
          subtitle: t.subtitle,
          updatedAt: t.updatedAt,
          // Orphan schedules use general, matching the server's _run_schedule fallback.
          projectName: sched?.project || t.projectName || 'general',
          _scheduleGroup: { scheduleId: sid, runs: 1, baseTitle },
        };
        groups.set(sid, g);
        out.push(g);
      } else {
        g._scheduleGroup.runs += 1;
        if (_ts(t.updatedAt || t.subtitle) > _ts(g.updatedAt || g.subtitle)) {
          g.subtitle = t.subtitle;
          g.updatedAt = t.updatedAt;
        }
      }
    }
    for (const g of out) {
      if (!g._scheduleGroup) continue;
      g.title = g._scheduleGroup.baseTitle;
    }
    // Sort locally: in-session task updates preserve array order until refetch.
    // Fall back to subtitle timestamps for legacy schedule rows.
    out.sort((a, b) => _ts(b.updatedAt || b.subtitle) - _ts(a.updatedAt || a.subtitle));
    return out;
  })();

  const [recentsHeadingHover, setRecentsHeadingHover] = useState(false);
  // Cap recents at 100; View all reaches older tasks.
  const recents = recentsAll.slice(0, 100);
  // Recents modal remains wired for the currently hidden Show more control.
  const hasMoreRecents = false;

  const [recentsModalOpen, setRecentsModalOpen] = useState(false);

  const artifactsNavRef = useRef(null);


  const pinnedTasks = (pins || [])
    .filter((pin) => pin.item_type === 'conversation')
    .map((pin) => {
      const found = tasksWithPin.find((task) => task.id === pin.item_id);
      return found
        ? { ...found, pinned: true }
        : { id: pin.item_id, title: pin.title || pin.item_id, status: 'idle', pinned: true };
    })
    .slice(0, 8);

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''} shrink-0 h-full bg-[var(--sidebar-bg,var(--surface))] border border-solid border-line rounded-[14px] shadow-sh-2 origin-left flex flex-col overflow-hidden will-change-[width,opacity,transform,filter] [transition:width_380ms_cubic-bezier(0.22,1,0.36,1),opacity_260ms_cubic-bezier(0.32,0.72,0,1),transform_420ms_cubic-bezier(0.22,1,0.36,1),filter_240ms_cubic-bezier(0.32,0.72,0,1)]`}
      aria-hidden={collapsed || undefined}
      inert={collapsed ? true : undefined}
      style={{
        width: collapsed ? 0 : 'clamp(240px, 24vw, 320px)',
        opacity: collapsed ? 0 : 1,
        transform: collapsed
          ? 'translateX(-12px) scale(0.985)'
          : 'translateX(0) scale(1)',
        filter: collapsed ? 'blur(6px)' : 'blur(0)',
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
    >
      <div
        className="anton-sidebar__chrome drag-region shrink-0"
        // Inline padding overrides legacy chrome CSS and reserves Electron's traffic-light inset.
        style={{ padding: `9px 14px 8px ${host.isWeb ? 14 : 88}px` }}
      >
        <div className="flex-1" />
        <div
          className="anton-sidebar__chrome-left ml-auto"
          // Inline gap overrides the later legacy chrome CSS.
          style={{ gap: 4 }}
        >
          <div className="anton-sidebar__chrome-buttons">
            {/* Keep the collapse button's slot mounted when unavailable so the search icon cannot shift. */}
            {(() => {
              const canToggle = typeof onToggleCollapsed === 'function';
              return (
                <Tooltip content={canToggle ? `${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}  (${shortcut('B')})` : ''}>
                  <button
                    className="icon-btn [-webkit-app-region:no-drag] origin-center"
                    onClick={canToggle ? onToggleCollapsed : undefined}
                    disabled={!canToggle}
                    aria-hidden={canToggle ? undefined : 'true'}
                    tabIndex={canToggle ? undefined : -1}
                    aria-label={canToggle ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : undefined}
                    style={{
                      // Inline transition overrides .icon-btn's later CSS, which would discard
                      // opacity/transform/filter transitions.
                      opacity: canToggle ? 1 : 0,
                      transform: canToggle
                        ? 'scale(1) rotate(0deg)'
                        : 'scale(0.72) rotate(-8deg)',
                      filter: canToggle ? 'blur(0)' : 'blur(2px)',
                      pointerEvents: canToggle ? 'auto' : 'none',
                      cursor: canToggle ? 'pointer' : 'default',
                      transition:
                        'opacity 220ms cubic-bezier(0.32, 0.72, 0, 1), ' +
                        'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), ' +
                        'filter 220ms cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                  >
                    {collapsed ? Ico.sidebarExpandRight(15) : Ico.sidebarCollapseLeft(15)}
                  </button>
                </Tooltip>
              );
            })()}
            <Tooltip content={`Search  (${shortcut('K')})`}>
              <button
                className="icon-btn [-webkit-app-region:no-drag]"
                onClick={onOpenSearch}
                aria-label="Search"
              >
                {Ico.search(15)}
              </button>
            </Tooltip>
          </div>
          <span
            aria-hidden="true"
            className="text-ink-3 opacity-50 text-[13px] select-none"
          >·</span>
          {navLogo && (
            <img
              src={navLogo}
              alt=""
              aria-hidden="true"
              className="anton-sidebar__logo"
            />
          )}
          <div className="anton-sidebar__wordmark">{navTitle || 'MindsHub'}</div>
        </div>
      </div>

      <div
        className="flex-1 min-h-0 flex flex-col"
        style={{
          opacity: collapsed ? 0 : 1,
          transform: collapsed ? 'translateY(2px)' : 'translateY(0)',
          pointerEvents: collapsed ? 'none' : 'auto',
          transition:
            'opacity 240ms cubic-bezier(0.32, 0.72, 0, 1) ' +
              `${collapsed ? '0ms' : '80ms'}, ` +
            'transform 320ms cubic-bezier(0.22, 1, 0.36, 1) ' +
              `${collapsed ? '0ms' : '80ms'}`,
        }}
      >
        {!host.isWeb && showWorkspaceSwitch && (
          <WorkspaceModeSwitch
            value={activeWorkspace}
            onChange={onWorkspaceChange}
          />
        )}

        {accountUser && <WorkspaceSelector user={accountUser} />}

        <div className="anton-sidebar__cta-wrap">
          <Button
            variant="tinted"
            block
            size="lg"
            onClick={codeRoute ? onNewCodingTask : onNewTask}
            // Override .btn's gap to align with nav rows.
            style={{ gap: 9 }}
          >
            {Ico.plus(14)}
            <span className="flex-1 text-left font-medium">{codeRoute ? 'New code task' : 'New task'}</span>
            <Kbd>{shortcut('N')}</Kbd>
          </Button>
        </div>

        {!codeRoute && (
          <div className="nav-list px-2.5 flex flex-col gap-px">
            <NavItem icon={Ico.folder(15)}  label="Projects"        onClick={() => onNavigate('projects')}  active={activeRoute === 'projects'}  badge={showCounters ? (projectsCount  || null) : null} />
            <NavItem icon={Ico.clock(15)}   label="Scheduled Tasks" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={showCounters ? (scheduledCount || null) : null} />
            <NavItem
              icon={Ico.sparkle(15)}
              label="Live Artifacts"
              elementRef={artifactsNavRef}
              onClick={() => {
                // Opening Live Artifacts also permanently dismisses the tip.
                if (artifactTipOpen) onArtifactTipDismiss?.();
                onNavigate('artifacts');
              }}
              active={activeRoute === 'artifacts'}
              badge={showCounters ? (artifactsCount || null) : null}
            />
            {/* Retain the customize route key for existing links while the label follows connection state. */}
            <NavItem
              icon={Ico.link(15)}
              label={connectorsCount > 0 ? 'Connected Apps and Data' : 'Connect Apps and Data'}
              onClick={() => onNavigate('customize')}
              active={activeRoute === 'customize'}
              badge={showCounters ? (connectorsCount || null) : null}
            />
          </div>
        )}

        {codeRoute ? (
          <>
            <div className="nav-list px-2.5 flex flex-col gap-px code-sidebar-nav">
              <NavItem
                icon={Ico.folder(15)}
                label="Projects"
                onClick={onOpenCodingProjects}
                active={activeCodeRoute === 'projects'}
              />
              <NavItem
                icon={Ico.link(15)}
                label="Connectors"
                onClick={onOpenCodingConnectors}
                active={activeCodeRoute === 'connectors'}
              />
              <NavItem
                icon={Ico.cube(15)}
                label="Skills"
                onClick={onOpenCodingSkills}
                active={activeCodeRoute === 'skills'}
              />
            </div>
            <CodeSidebarSessions
              sessions={codingSessions}
              selectedId={activeCodingSessionId}
              onSelect={onSelectCodingSession}
              onSetPinned={onSetCodingSessionPinned}
            />
          </>
        ) : (
        <>
        <div className="section-label">Agent</div>
        <div className="nav-list px-2.5 flex flex-col gap-px">
          <NavItem icon={Ico.brain(15)} label="Memories"       onClick={() => onNavigate('memory')} active={activeRoute === 'memory'} />
          <NavItem icon={Ico.cube(15)}  label="Skills library" onClick={() => onNavigate('skills')} active={activeRoute === 'skills'} />
        </div>

        {pinnedTasks.length > 0 && (
          <>
            <div className="section-label">Pinned</div>
            <div className="px-2.5 flex flex-col gap-px">
              {pinnedTasks.map((task) => (
                <RecentItem
                  key={task.id}
                  task={task}
                  projects={projects}
                  onClick={() => onSelectTask(task.id)}
                  onPin={onPinTask}
                  onUnpin={onUnpinTask}
                  onRename={onRenameTask}
                  onDelete={onDeleteTask}
                  onMoveToProject={onMoveTaskToProject}
                  showTimestamp={showCounters}
                  isActive={activeTaskIds.has(task.id)}
                  selected={activeTaskId === task.id}
                  agentLabel={agentLabel}
                />
              ))}
            </div>
          </>
        )}

        {/* The heading fills the row so its empty space also reveals View all on hover. */}
        <div
          className="section-label recents-heading flex items-baseline gap-2 cursor-default w-full"
          onMouseEnter={() => setRecentsHeadingHover(true)}
          onMouseLeave={() => setRecentsHeadingHover(false)}
        >
          <span className="flex-1">RECENT TASKS</span>
          <Tooltip content="View all tasks">
            <button
              type="button"
              className="recents-viewall bg-transparent border-0 p-0 font-[family-name:var(--font-body)] text-xs tracking-[0.02em] normal-case"
              onClick={() => onNavigate?.('tasks')}
              style={{
                cursor: recentsHeadingHover ? 'pointer' : 'default',
                opacity: recentsHeadingHover ? 1 : 0,
                transform: recentsHeadingHover ? 'translateX(0)' : 'translateX(2px)',
                pointerEvents: recentsHeadingHover ? 'auto' : 'none',
              }}
            >
              View all →
            </button>
          </Tooltip>
        </div>
        <div className="scroll-clean px-2.5 flex-1 min-h-0 overflow-y-auto flex flex-col gap-px">
          {/* Use tasksWithPin for emptiness; an account whose tasks are all pinned still has tasks. */}
          {tasksStatus === 'loading' && tasksWithPin.length === 0 && (
            <div aria-busy="true" aria-label="Loading tasks" className="flex flex-col gap-px">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="px-2 py-2">
                  <div
                    className="animate-pulse rounded"
                    style={{ height: 10, width: `${72 - i * 9}%`, background: 'var(--border, rgba(128,128,128,0.25))' }}
                  />
                </div>
              ))}
            </div>
          )}
          {tasksStatus === 'failed' && tasksWithPin.length === 0 && (
            // A failed fetch must not look like an empty account.
            <div role="alert" className="px-2 py-3 text-xs" style={{ color: 'var(--text-secondary, #6b7280)' }}>
              <div>Couldn&rsquo;t load your tasks.</div>
              {onRetryTasks && (
                <button
                  type="button"
                  onClick={onRetryTasks}
                  className="mt-1 bg-transparent border-0 p-0 underline cursor-pointer text-xs"
                  style={{ color: 'inherit' }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          {tasksStatus === 'ready' && tasksWithPin.length === 0 && (
            <div className="px-2 py-3 text-xs" style={{ color: 'var(--text-secondary, #6b7280)' }}>
              No tasks yet
            </div>
          )}
          {recents.map((t) => {
            // Schedule-group rows open schedule history; per-task mutations do not apply to a
            // synthetic group.
            const isGroup = !!t._scheduleGroup;
            return (
              <RecentItem
                key={t.id}
                task={t}
                projects={projects}
                onClick={() => isGroup
                  ? onOpenSchedule?.(t._scheduleGroup.scheduleId)
                  : onSelectTask(t.id)}
                onPin={isGroup ? undefined : onPinTask}
                onUnpin={isGroup ? undefined : onUnpinTask}
                onRename={isGroup ? undefined : onRenameTask}
                onDelete={isGroup ? undefined : onDeleteTask}
                onMoveToProject={isGroup ? undefined : onMoveTaskToProject}
                showTimestamp={showCounters}
                isActive={!isGroup && activeTaskIds.has(t.id)}
                selected={!isGroup && activeTaskId === t.id}
                agentLabel={agentLabel}
              />
            );
          })}
          {hasMoreRecents && (
            <button
              type="button"
              onClick={() => setRecentsModalOpen(true)}
              className="recents-show-more mt-1.5 mx-0 mb-1 py-[7px] px-2.5 bg-transparent border border-dashed border-line-2 rounded-[7px] text-ink-3 font-[family-name:var(--font-body)] text-[12px] cursor-pointer flex items-center justify-between gap-2 hover:bg-surface-2 hover:border-line hover:text-ink [transition:background_120ms_ease,color_120ms_ease,border-color_120ms_ease]"
            >
              <span>Show more</span>
              <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4">
                +{recentsAll.length - recents.length}
              </span>
            </button>
          )}
        </div>
        </>
        )}

        {!codeRoute && onStartChat && <OnboardingChecklist onStartChat={onStartChat} />}

        {/* deriveUpdateBanner chooses one shell-first update notice. */}
        {updateBanner && (() => {
          const tone = UPDATE_TONE_CLASS[updateBanner.tone] || UPDATE_TONE_CLASS.ready;
          const box = `mt-0 mx-2.5 mb-1.5 py-2 px-3 border border-solid rounded-lg flex items-center gap-2 w-[calc(100%-20px)] [-webkit-app-region:no-drag] ${tone.box}`;
          const dot = <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone.dot}`} />;
          const label = (
            <span className="flex-1 text-[11.5px] text-left text-ink font-[family-name:var(--font-sans)]">
              {updateBanner.title}
            </span>
          );
          const action = updateBanner.actionLabel ? (
            <span className={`text-2xs font-[family-name:var(--font-mono)] tracking-[0.03em] uppercase font-semibold ${tone.action}`}>
              {updateBanner.actionLabel}
            </span>
          ) : null;

          if (updateBanner.dismissible) {
            return (
              <div className={box}>
                <Tooltip content={`A new version of MindsHub Cowork is available${updateBanner.version ? ` (${updateBanner.version})` : ''} — download the installer, then quit the app and open it to update`}>
                  <button
                    type="button"
                    onClick={() => onUpdateAction?.(updateBanner.action)}
                    className="flex-1 flex items-center gap-2 bg-transparent border-0 p-0 m-0 cursor-pointer text-left font-[inherit]"
                  >
                    {dot}{label}{action}
                  </button>
                </Tooltip>
                <Tooltip content="Dismiss">
                  <button
                    type="button"
                    onClick={onDismissUpdate}
                    aria-label="Dismiss update notice"
                    className="bg-transparent border-0 py-0 px-0.5 m-0 cursor-pointer text-ink-3 text-base leading-none shrink-0"
                  >
                    ×
                  </button>
                </Tooltip>
              </div>
            );
          }

          return (
            <button
              type="button"
              onClick={updateBanner.action ? () => onUpdateAction?.(updateBanner.action) : undefined}
              disabled={updateBanner.disabled}
              className={`${box} font-[inherit] cursor-pointer disabled:cursor-default [transition:background_120ms_ease]`}
            >
              {dot}{label}{action}
            </button>
          );
        })()}

        <div className="anton-sidebar__footer">
          {/* Only server lifecycle status is Electron-only; Settings must remain reachable on web. */}
          {showsStatusPill ? (
              <>
                <Tooltip content="Backend status — click for details">
                  <button
                    type="button"
                    className={
                      'backend-status-control is-clickable flex-1 [-webkit-app-region:no-drag]' +
                      (serverBusy ? ' is-busy' : '')
                    }
                    onClick={onShowServerHelp}
                    aria-label="Backend status — click for details"
                  >
                    <span className={'status-dot' + (serverBusy ? ' busy' : ' offline')} />
                    <span className="status-text">
                      <span className="status-text__faded">backend ·</span>{' '}
                      {serverBusy ? (
                        <>
                          <span className="status-text__live">{serverBusyKind}</span>{' '}
                          <Spinner />
                        </>
                      ) : (
                        <span className="status-text__faded">offline</span>
                      )}
                    </span>
                  </button>
                </Tooltip>
                <Tooltip content="Settings">
                  <button
                    className={'chrome-btn--small shrink-0 [-webkit-app-region:no-drag]' + (settingsActive ? ' is-on' : '')}
                    onClick={() => onNavigate('settings:backend')}
                    aria-label="Settings"
                  >
                    {Ico.settings(13)}
                  </button>
                </Tooltip>
              </>
            ) : showsUserMenu ? (
              <>
                <UserMenu
                  user={accountUser}
                  onOpenSettings={() => onNavigate('settings')}
                />
                {/* Keep Settings one click away when the account menu is present. */}
                <Tooltip content="Settings">
                  <button
                    className="chrome-btn--small shrink-0 ml-auto [-webkit-app-region:no-drag]"
                    onClick={() => onNavigate('settings')}
                    aria-label="Open Settings"
                  >
                    {Ico.settings(15)}
                  </button>
                </Tooltip>
              </>
            ) : (
              <button
                className={'anton-sidebar__footer-settings flex-1 min-w-0 [-webkit-app-region:no-drag]' + (settingsActive ? ' is-on' : '')}
                onClick={() => onNavigate('settings')}
                aria-label="Settings"
              >
                <span className="inline-flex shrink-0">{Ico.settings(13)}</span>
                <span>Settings</span>
              </button>
            )}
        </div>

      </div>

      <FirstArtifactTip
        // Hide the tip while its anchor is collapsed; retain arming until the next expansion.
        open={artifactTipOpen && !collapsed}
        anchorRef={artifactsNavRef}
        onGotIt={() => onArtifactTipDismiss?.()}
        onShowMe={() => {
          onArtifactTipDismiss?.();
          onNavigate('artifacts');
        }}
      />

      <RecentsModal
        projects={projects}
        open={recentsModalOpen}
        onClose={() => setRecentsModalOpen(false)}
        tasks={recentsAll.slice(0, 100)}
        onSelect={(id) => onSelectTask?.(id)}
        onDelete={(id) => onDeleteTask?.(id)}
      />
    </aside>
  );
}
