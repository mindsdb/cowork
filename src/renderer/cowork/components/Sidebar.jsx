import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner } from './ui';
import { TaskMenu } from './TaskMenu';
import { isMac, isWeb } from '../lib/host';
import RecentsModal from './RecentsModal';

// Platform-aware modifier symbol for keyboard hints. Mac uses ⌘ glyph,
// Windows/Linux use Ctrl+ literal. host.isMac() works in both Electron
// (delegates to preload's getPlatform) and web (navigator.userAgentData).
const IS_MAC = isMac();
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const shortcut = (key) => `${MOD_LABEL}${key}`;

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (secs < 60)     return 'just now';
  if (secs < 3600)   return `${Math.floor(secs / 60)} min ago`;
  if (secs < 86400)  return `${Math.floor(secs / 3600)} h ago`;
  if (secs < 172800) return 'Yesterday';
  if (secs < 604800) return `${Math.floor(secs / 86400)} d ago`;
  return `${Math.floor(secs / 604800)} w ago`;
}

function NavItem({ icon, label, active, onClick, badge, comingSoon, compact }) {
  return (
    <button
      className={`nav-item${active ? ' active' : ''}${compact ? ' compact' : ''}`}
      onClick={comingSoon ? undefined : onClick}
      aria-label={label}
      data-coming-soon={comingSoon ? '' : undefined}
      style={comingSoon ? { opacity: 0.55, cursor: 'default' } : undefined}
    >
      <span className="nav-row__icon" style={{ display: 'inline-flex' }}>{icon}</span>
      <span className="nav-row__label" style={{ flex: 1 }}>{label}</span>
      {badge != null && (
        <span className="nav-row__badge pill muted" style={{ fontSize: 10 }}>{badge}</span>
      )}
      {comingSoon && (
        <span className="pill muted" style={{ fontSize: 10 }}>Soon</span>
      )}
    </button>
  );
}

function RecentItem({ task, onClick, projects, onPin, onUnpin, onRename, onDelete, onMoveToProject }) {
  const [hover, setHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);

  const openMenu = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!triggerRef.current) return;
    setAnchorRect(triggerRef.current.getBoundingClientRect());
    setMenuOpen(true);
  };

  // Fixed-width right slot — both timestamp and kebab are always
  // rendered (cross-fade on hover). Reserving the same width means
  // the row height/width stays constant whether the kebab is visible
  // or not — no jumping when moving between rows.
  const showKebab = hover || menuOpen;
  return (
    <div
      style={{ position: 'relative', display: 'flex' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button className="recent-item" onClick={onClick} aria-label={task.title} style={{ flex: 1, minWidth: 0 }}>
        <span className="recent-row__title" style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, paddingRight: 8,
        }}>{task.title || 'Untitled'}</span>

        {/* Right-side fixed slot — 22px wide, holds timestamp OR kebab */}
        <span style={{
          position: 'relative',
          width: 50, height: 18,
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center', justifyContent: 'flex-end',
        }}>
          <span style={{
            position: 'absolute', inset: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end',
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: 'var(--ink-4)', letterSpacing: '0.02em',
            opacity: showKebab ? 0 : 1,
            transition: 'opacity 120ms ease',
          }}>
            {timeAgo(task.updatedAt || task.subtitle)}
          </span>
          <span
            ref={triggerRef}
            role="button"
            aria-label="Task menu"
            onClick={openMenu}
            style={{
              position: 'absolute', right: 0, top: '50%',
              transform: 'translateY(-50%)',
              display: 'inline-flex',
              width: 22, height: 22,
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--ink-3)', borderRadius: 5,
              cursor: 'pointer',
              opacity: showKebab ? 1 : 0,
              pointerEvents: showKebab ? 'auto' : 'none',
              transition: 'opacity 120ms ease, background 120ms ease, color 120ms ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
          >
            {Ico.moreVert(13)}
          </span>
        </span>
      </button>

      <TaskMenu
        task={task}
        projects={projects}
        open={menuOpen}
        anchorRect={anchorRect}
        onClose={() => setMenuOpen(false)}
        onPin={() => onPin?.(task)}
        onUnpin={() => onUnpin?.(task.id)}
        onRename={() => {
          const next = window.prompt('Rename task', task.title || '');
          if (next != null) onRename?.(task.id, next);
        }}
        onDelete={() => onDelete?.(task.id)}
        onMoveToProject={(p) => onMoveToProject?.(task.id, p.name)}
      />
    </div>
  );
}

export default function Sidebar({
  tasks,
  pins = [],
  scheduledCount = 0,
  activeRoute,
  activeTaskId,
  serverOnline,
  serverBusy = false,
  serverBusyKind = 'starting', // 'starting' | 'stopping'
  onNavigate,
  onSelectTask,
  onNewTask,
  onOpenSearch,
  collapsed = false,
  onToggleCollapsed,
  onPinTask,
  onUnpinTask,
  onRenameTask,
  onDeleteTask,
  onMoveTaskToProject,
  projects = [],
  onToggleServer,
  onShowServerHelp,
}) {
  // Decorate every task with its pinned state. Tasks come from the
  // conversations endpoint which doesn't know about pins (they live
  // in a separate /pins store), so without this the menu shows
  // "Pin" on items that are already pinned.
  const pinnedIds = new Set(
    (pins || []).filter((p) => p.type === 'task').map((p) => p.id)
  );
  const tasksWithPin = tasks.map((t) =>
    pinnedIds.has(t.id) ? { ...t, pinned: true } : t
  );

  // Recents excludes pinned items so a task isn't surfaced twice.
  // The full pool — sliced down to whatever fits the viewport + a
  // "Show more" affordance below.
  const recentsAll = tasksWithPin.filter((t) => !pinnedIds.has(t.id));

  // Sized dynamically: measure the available height of the recents
  // scroll area on mount + on window resize, then divide by an
  // average row height to pick how many to render inline. Min 5 so
  // the section never collapses to a single row, max all-of-them.
  const RECENT_ROW_HEIGHT  = 30;   // single recent-item incl. 1px gap
  const RECENT_FOOTER_PAD  = 36;   // reserved for the Show-more row
  const recentsRef = useRef(null);
  const [recentsHeight, setRecentsHeight] = useState(0);
  useLayoutEffect(() => {
    const el = recentsRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setRecentsHeight(entry.contentRect.height);
      }
    });
    ro.observe(el);
    setRecentsHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const inlineRecentCount = (() => {
    if (recentsHeight <= 0) return 5;
    const usable = Math.max(0, recentsHeight - RECENT_FOOTER_PAD);
    return Math.max(5, Math.floor(usable / RECENT_ROW_HEIGHT));
  })();
  const recents = recentsAll.slice(0, inlineRecentCount);
  // "Show more" hidden for now — kept the modal + state plumbing
  // so we can flip this back on later without rewiring anything.
  const hasMoreRecents = false;

  const [recentsModalOpen, setRecentsModalOpen] = useState(false);
  const pinnedTasks = (pins || [])
    .filter((pin) => pin.type === 'task')
    .map((pin) => {
      const found = tasksWithPin.find((task) => task.id === pin.id);
      return found
        ? { ...found, pinned: true }
        : { id: pin.id, title: pin.title || pin.id, status: 'idle', pinned: true };
    })
    .slice(0, 8);

  return (
    <aside
      className={`app-sidebar${collapsed ? ' collapsed' : ''}`}
      style={{
        flexShrink: 0, height: '100%',
        background: 'var(--sidebar-bg, var(--surface))',
        border: '1px solid var(--line)',
        borderRadius: 14,
        boxShadow: 'var(--sh-2)',
        width: collapsed ? 0 : 'clamp(240px, 24vw, 320px)',
        opacity: collapsed ? 0 : 1,
        transform: collapsed ? 'translateX(-16px)' : 'translateX(0)',
        transition:
          'width 360ms cubic-bezier(0.32, 0.72, 0, 1), ' +
          'opacity 280ms cubic-bezier(0.32, 0.72, 0, 1), ' +
          'transform 360ms cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'width, opacity, transform',
        pointerEvents: collapsed ? 'none' : 'auto',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Top chrome row: traffic-light pad + collapse/search + ANTON wordmark.
          padding-top reduced from 14 → 9 to bring the buttons + wordmark
          5px upward, so they line up with the macOS traffic lights at
          their new (x:18, y:22) position. */}
      <div
        className="anton-sidebar__chrome drag-region"
        style={{
          padding: '9px 14px 8px 88px',
          flexShrink: 0,
        }}
      >
        <div className="anton-sidebar__chrome-left">
          <div className="anton-sidebar__chrome-buttons">
            <button
              className="icon-btn"
              onClick={onToggleCollapsed}
              title={`${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}  (${shortcut('B')})`}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {collapsed ? Ico.sidebarExpandRight(15) : Ico.sidebarCollapseLeft(15)}
            </button>
            <button
              className="icon-btn"
              onClick={onOpenSearch}
              title={`Search  (${shortcut('K')})`}
              aria-label="Search"
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {Ico.search(15)}
            </button>
          </div>
        </div>
        <div className="anton-sidebar__wordmark">Anton</div>
      </div>

      {/* Body — fades + clips when collapsed */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'opacity 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* New task CTA — outlined neon button */}
        <div className="anton-sidebar__cta-wrap">
          <button
            className="btn-new-task"
            onClick={onNewTask}
            title={`New task  (${shortcut('N')})`}
          >
            <span style={{ display: 'inline-flex' }}>{Ico.plus(14)}</span>
            <span className="btn-new-task__label">New task</span>
            <span className="kbd">{shortcut('N')}</span>
          </button>
        </div>

        {/* Primary nav */}
        <div className="nav-list" style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <NavItem icon={Ico.folder(15)}  label="Projects"      onClick={() => onNavigate('projects')}  active={activeRoute === 'projects'} />
          <NavItem icon={Ico.clock(15)}   label="Scheduled tasks" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={scheduledCount || null} />
          <NavItem icon={Ico.sparkle(15)} label="Live artifacts" onClick={() => onNavigate('artifacts')} active={activeRoute === 'artifacts'} />
          <NavItem icon={Ico.chats(15)}   label="Dispatch"      onClick={() => onNavigate('dispatch')}  active={activeRoute === 'dispatch'} />
          {/* Connect Apps and Data — replaces "Customize". Reuses the
              `customize` route key so existing in-flight links still
              work. The page now lists connected apps + datasources in
              a Projects-style grid. */}
          <NavItem icon={Ico.link(15)}    label="Connect Apps and Data" onClick={() => onNavigate('customize')} active={activeRoute === 'customize'} />
        </div>

        {/* Anton group — visually grouped panel for the brain-style nav */}
        <div className="section-label">Anton</div>
        <div className="anton-group">
          <NavItem icon={Ico.cube(15)}     label="Skills library" onClick={() => onNavigate('skills')}   active={activeRoute === 'skills'}   compact />
          <NavItem icon={Ico.brain(15)}    label="Memory"         onClick={() => onNavigate('memory')}   active={activeRoute === 'memory'}   compact />
          {/* "Connect data" removed from the sidebar — the canonical
              connector surface is the Connect Apps and Data page
              (route='customize'). The legacy 'connect' route used to
              render UtilitiesView/ConnectView and has been retired. */}
          <NavItem icon={Ico.settings(15)} label="Settings"       onClick={() => onNavigate('settings')} active={activeRoute === 'settings'} compact />
        </div>

        {/* Pinned */}
        <div className="section-label">Pinned</div>
        {pinnedTasks.length ? (
          <div style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
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
              />
            ))}
          </div>
        ) : (
          <div className="pinned-empty">
            <span style={{ display: 'inline-flex' }}>{Ico.pin(12)}</span>
            <span>Visit or pin tasks to keep them here.</span>
          </div>
        )}

        {/* Recents */}
        <div className="section-label">Recents</div>
        <div ref={recentsRef} className="scroll-clean" style={{
          padding: '0 10px', flex: 1, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {recents.map((t) => (
            <RecentItem
              key={t.id}
              task={t}
              projects={projects}
              onClick={() => onSelectTask(t.id)}
              onPin={onPinTask}
              onUnpin={onUnpinTask}
              onRename={onRenameTask}
              onDelete={onDeleteTask}
              onMoveToProject={onMoveTaskToProject}
            />
          ))}
          {hasMoreRecents && (
            <button
              type="button"
              onClick={() => setRecentsModalOpen(true)}
              className="recents-show-more"
              style={{
                margin: '6px 0 4px',
                padding: '7px 10px',
                background: 'transparent',
                border: '1px dashed var(--line-2)',
                borderRadius: 7,
                color: 'var(--ink-3)',
                fontFamily: 'var(--font-body)', fontSize: 12,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 8,
                transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = 'var(--surface-2)';
                e.currentTarget.style.color = 'var(--ink)';
                e.currentTarget.style.borderColor = 'var(--line)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--ink-3)';
                e.currentTarget.style.borderColor = 'var(--line-2)';
              }}
            >
              <span>Show more</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)' }}>
                +{recentsAll.length - recents.length}
              </span>
            </button>
          )}
        </div>

        {/* Footer status */}
        <div className="anton-sidebar__footer">
          {/* The whole "backend · <status>" pill is the help affordance
              now — click anywhere on it to open the server-state modal.
              Replaces the previous standalone "?" icon, which only
              appeared when offline and read as visual clutter. */}
          <button
            type="button"
            className={
              'status-pill is-clickable' +
              (serverBusy ? ' is-busy' : serverOnline ? ' is-on' : '')
            }
            onClick={onShowServerHelp}
            title="Backend status — click for details"
            aria-label="Backend status — click for details"
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            <span
              className={
                'status-dot' +
                (serverBusy ? ' busy' : serverOnline ? '' : ' offline')
              }
            />
            <span className="status-text">
              <span className="status-text__faded">backend ·</span>{' '}
              {serverBusy ? (
                <>
                  <span className="status-text__live">{serverBusyKind}</span>{' '}
                  <Spinner />
                </>
              ) : (
                <span className={serverOnline ? 'status-text__live' : 'status-text__faded'}>
                  {serverOnline ? 'connected' : 'offline'}
                </span>
              )}
            </span>
          </button>
          {/* Server-toggle hidden in web mode — the FastAPI is container/Lightsail
              managed there, not user-controllable from the renderer. The status
              pill above still surfaces connected/offline as a read-only signal. */}
          {!isWeb && (
            <div className="anton-sidebar__footer-actions">
              <button
                className={
                  'chrome-btn--small server-toggle' +
                  (serverOnline ? ' is-on' : '') +
                  (serverBusy ? ' is-busy' : '')
                }
                onClick={onToggleServer}
                disabled={serverBusy}
                title={
                  serverBusy
                    ? `Backend ${serverBusyKind}…`
                    : serverOnline ? 'Stop Anton backend' : 'Start Anton backend'
                }
                aria-label={serverOnline ? 'Stop backend' : 'Start backend'}
                aria-busy={serverBusy ? 'true' : undefined}
                style={{ WebkitAppRegion: 'no-drag' }}
              >
                {serverBusy
                  ? <Spinner intervalMs={70} />
                  : (serverOnline ? Ico.powerOff(13) : Ico.power(13))}
              </button>
            </div>
          )}
        </div>
      </div>

      <RecentsModal
        open={recentsModalOpen}
        onClose={() => setRecentsModalOpen(false)}
        // Cap at 100 — beyond that the list is more usefully reached
        // via global search (Cmd+K) than by scrolling.
        tasks={recentsAll.slice(0, 100)}
        onSelect={(id) => onSelectTask?.(id)}
        onDelete={(id) => onDeleteTask?.(id)}
      />
    </aside>
  );
}
