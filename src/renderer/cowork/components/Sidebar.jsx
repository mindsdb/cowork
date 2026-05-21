import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner } from './ui';
import { TaskMenu } from './TaskMenu';
import RecentsModal from './RecentsModal';
import { host } from '../../platform/host';

// Platform-aware modifier symbol for keyboard hints. Mac uses ⌘ glyph,
// Windows/Linux use Ctrl+ literal. host.isMac() works in both Electron
// (delegates to preload's getPlatform) and web (navigator.userAgentData);
// the navigator-UA fallback covers older browsers.
const IS_MAC = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
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

function RecentItem({ task, onClick, projects, onPin, onUnpin, onRename, onDelete, onMoveToProject, showTimestamp = true, isActive = false }) {
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
        }}>
          {task.title || 'Untitled'}
          {/* Schedule-group entries — append a muted "· N runs"
              suffix so the title still reads clean while the count
              is visually separated from the schedule name. Painted
              in --ink-4 (one tone below the title) and the bullet
              uses --ink-5 so the separator recedes further still. */}
          {task._scheduleGroup && (() => {
            const n = task._scheduleGroup.runs;
            return (
              <span style={{
                color: 'var(--ink-4)',
                fontWeight: 400,
                marginLeft: 6,
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: 'var(--ink-5)', marginRight: 4 }}>·</span>
                {n} {n === 1 ? 'run' : 'runs'}
              </span>
            );
          })()}
        </span>

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
            opacity: (showKebab || (!showTimestamp && !isActive)) ? 0 : 1,
            transition: 'opacity 120ms ease',
            gap: 6,
          }}>
            {isActive ? (
              <span
                className="pulse-dot"
                title="Anton is working on this task"
                aria-label="Active"
                style={{
                  display: 'inline-block',
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--accent, #5d9287)',
                  boxShadow: '0 0 0 2px rgba(93,146,135,0.18)',
                }}
              />
            ) : (
              showTimestamp ? timeAgo(task.updatedAt || task.subtitle) : ''
            )}
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
  projectsCount = 0,
  artifactsCount = 0,
  connectorsCount = 0,
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
  // Schedules + the flat sessionId → scheduleId index. When a
  // recent task carries a scheduledId, we collapse all sibling
  // runs of the same schedule into a single synthesized entry
  // ("Daily digest · 3 runs") so the recents list isn't drowned
  // out by repeat scheduled-run conversations.
  schedules = [],
  scheduleRunsIndex = {},
  onOpenSchedule,
  onToggleServer,
  onShowServerHelp,
  updateAvailable = null, // { version: string } or null
  onApplyUpdate,
  // Settings → Personalization → Show nav-panel counters. When
  // false, hide the per-nav badge counts AND the time-since slot
  // on each Recent row. Default true.
  showCounters = true,
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

  // A task is "currently active" if any of its messages carries a
  // live `_streaming` placeholder — the same signal the chat view
  // uses to know a turn is in flight. Derived directly from messages
  // so the dot lights up the moment the stream starts and clears the
  // moment onDone/onError strips the placeholder. No new wire from
  // App.jsx needed; `tasks` already carries the messages array.
  const activeTaskIds = new Set(
    tasks
      .filter((t) => (t.messages || []).some((m) => m && m.role === '_streaming'))
      .map((t) => t.id)
  );

  // Recents excludes pinned items so a task isn't surfaced twice.
  // The full pool — sliced down to whatever fits the viewport + a
  // "Show more" affordance below.
  const recentsRaw = tasksWithPin.filter((t) => !pinnedIds.has(t.id));

  // Collapse all conversations belonging to one schedule into a
  // single synthetic entry. Without this a daily/hourly schedule
  // floods the rail with repeat rows and the actual chat tasks
  // get pushed out of view. Each group entry inherits the most
  // recent run's timestamp so the grouping respects "newest first."
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
    const groups = new Map(); // scheduleId → synthesised group entry
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
          // Orphan schedules (no project) resolve to "general" —
          // matches the server's _run_schedule fallback.
          projectName: sched?.project || t.projectName || 'general',
          // Marker fields the click handler / row renderer key off:
          _scheduleGroup: { scheduleId: sid, runs: 1, baseTitle },
        };
        groups.set(sid, g);
        out.push(g);
      } else {
        g._scheduleGroup.runs += 1;
        // Track the freshest timestamp across the group's runs so
        // sorting / "n minutes ago" reflects the most recent run.
        if (_ts(t.updatedAt || t.subtitle) > _ts(g.updatedAt || g.subtitle)) {
          g.subtitle = t.subtitle;
          g.updatedAt = t.updatedAt;
        }
      }
    }
    // Title stays as the schedule's base name; the run count is
    // surfaced separately so RecentItem can paint it in a muted
    // accent that distinguishes the schedule meta from the title.
    for (const g of out) {
      if (!g._scheduleGroup) continue;
      g.title = g._scheduleGroup.baseTitle;
    }
    // Sort by `updatedAt` descending so reviving a task (replying in
    // an open task — App.jsx's handleSendInTask bumps updatedAt at
    // send-time) or creating a new one immediately floats it to the
    // top of recents. Without this, the panel mirrors whatever order
    // `tasks` happens to be in: the server sorts on each fetch, but
    // in-session edits use `prev.map(...)` which keeps the array
    // order frozen until the next fetchSessions. Falling back to
    // `subtitle` (a parseable timestamp on schedule-run rows) keeps
    // legacy rows without an explicit updatedAt in roughly the right
    // place rather than dumping them at the bottom.
    out.sort((a, b) => _ts(b.updatedAt || b.subtitle) - _ts(a.updatedAt || a.subtitle));
    return out;
  })();

  // Sized dynamically: measure the available height of the recents
  // scroll area on mount + on window resize, then divide by an
  // average row height to pick how many to render inline. Min 5 so
  // the section never collapses to a single row, max all-of-them.
  const RECENT_ROW_HEIGHT  = 30;   // single recent-item incl. 1px gap
  const RECENT_FOOTER_PAD  = 36;   // reserved for the Show-more row
  const recentsRef = useRef(null);
  const [recentsHeight, setRecentsHeight] = useState(0);
  // Strict hover state for the Recents heading row only. CSS
  // `:hover` was bleeding (or appearing to bleed) onto the recents
  // list below; pinning this to onMouseEnter/onMouseLeave on the
  // heading div makes the hit area exactly the heading's bounding
  // box and nothing else.
  const [recentsHeadingHover, setRecentsHeadingHover] = useState(false);
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
        // Combine a gentle leftward translate with a slight scale so
        // the sidebar reads as "settling into place" rather than just
        // sliding. Origin pinned to the left edge so the scale grows
        // from the dock side; the eye picks up the easing curve
        // along with the width interpolation for a single coherent
        // motion. Scale + filter values are subtle on purpose —
        // they're the difference between "this animated" and
        // "this animated nicely."
        transform: collapsed
          ? 'translateX(-12px) scale(0.985)'
          : 'translateX(0) scale(1)',
        transformOrigin: 'left center',
        filter: collapsed ? 'blur(6px)' : 'blur(0)',
        transition:
          'width 380ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'opacity 260ms cubic-bezier(0.32, 0.72, 0, 1), ' +
          'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), ' +
          'filter 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        willChange: 'width, opacity, transform, filter',
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
          // 88px left clears the macOS traffic lights in Electron.
          // On web there are no traffic lights so 14px suffices.
          padding: `9px 14px 8px ${host.isWeb ? 14 : 88}px`,
          flexShrink: 0,
        }}
      >
        {/* Right-aligned cluster: collapse + search icons, then a
            middle-dot separator, then the ANTON wordmark. The chrome's
            existing `justify-content: space-between` pushes the whole
            cluster against the right edge (the left half is empty space
            past the traffic-light pad). */}
        <div style={{ flex: 1 }} />
        <div className="anton-sidebar__chrome-left" style={{ marginLeft: 'auto', gap: 4 }}>
          <div className="anton-sidebar__chrome-buttons">
            {/* Collapse button — always mounted so the search icon
                next to it never shifts when the host route changes
                whether the toggle is allowed or not.
                  • allowed   (chat task)  → fully visible, clickable
                  • disallowed (other routes) → fades + scales out +
                    soft blur, but the layout slot stays put so the
                    search icon doesn't displace.
                The transition is gentle and a touch over-eased so
                the hide reads as deliberate without being theatrical. */}
            {(() => {
              const canToggle = typeof onToggleCollapsed === 'function';
              return (
                <button
                  className="icon-btn"
                  onClick={canToggle ? onToggleCollapsed : undefined}
                  disabled={!canToggle}
                  aria-hidden={canToggle ? undefined : 'true'}
                  tabIndex={canToggle ? undefined : -1}
                  title={
                    canToggle
                      ? `${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}  (${shortcut('B')})`
                      : undefined
                  }
                  aria-label={canToggle ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : undefined}
                  style={{
                    WebkitAppRegion: 'no-drag',
                    opacity: canToggle ? 1 : 0,
                    // Slight scale + tilt + blur on hide so the
                    // motion is recognisable from the corner of the
                    // eye but never noisy. Origin pinned to center
                    // so the slot's geometry stays symmetric.
                    transform: canToggle
                      ? 'scale(1) rotate(0deg)'
                      : 'scale(0.72) rotate(-8deg)',
                    transformOrigin: 'center',
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
              );
            })()}
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
          <span
            aria-hidden="true"
            style={{
              color: 'var(--text-muted)',
              opacity: 0.5,
              fontSize: 13,
              userSelect: 'none',
            }}
          >·</span>
          <div className="anton-sidebar__wordmark">Anton</div>
        </div>
      </div>

      {/* Body — fades + slides in slightly behind the container so
          the motion staggers. On appearance the body lags ~80ms so
          the surrounding chrome lands first; on dismissal it leads
          the container so the contents exit before the box does. */}
      <div
        style={{
          flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column',
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
          <NavItem icon={Ico.folder(15)}  label="Projects"        onClick={() => onNavigate('projects')}  active={activeRoute === 'projects'}  badge={showCounters ? (projectsCount  || null) : null} />
          <NavItem icon={Ico.clock(15)}   label="Scheduled Tasks" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={showCounters ? (scheduledCount || null) : null} />
          <NavItem icon={Ico.sparkle(15)} label="Live Artifacts"  onClick={() => onNavigate('artifacts')} active={activeRoute === 'artifacts'} badge={showCounters ? (artifactsCount || null) : null} />
          <NavItem icon={Ico.chats(15)}   label="Dispatch"        onClick={() => onNavigate('dispatch')}  active={activeRoute === 'dispatch'} />
          {/* Connect Apps and Data — replaces "Customize". Reuses the
              `customize` route key so existing in-flight links still
              work. The page now lists connected apps + datasources in
              a Projects-style grid.
              Label flips to "Connected Apps" once at least one app /
              data source is connected; the badge then reads as a
              live "you have N connections" indicator. */}
          <NavItem
            icon={Ico.link(15)}
            label={connectorsCount > 0 ? 'Connected Apps and Data' : 'Connect Apps and Data'}
            onClick={() => onNavigate('customize')}
            active={activeRoute === 'customize'}
            badge={showCounters ? (connectorsCount || null) : null}
          />
        </div>

        {/* Anton group — visually grouped panel for the brain-style nav.
            Order: Memories → Skills library → Settings. Labels read
            as the things the user OWNS (plural collections) rather
            than the abstract concepts the engine names them after. */}
        <div className="section-label">Anton</div>
        <div className="anton-group">
          <NavItem icon={Ico.brain(15)}    label="Memories"       onClick={() => onNavigate('memory')}   active={activeRoute === 'memory'}   compact />
          <NavItem icon={Ico.cube(15)}     label="Skills library" onClick={() => onNavigate('skills')}   active={activeRoute === 'skills'}   compact />
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
                showTimestamp={showCounters}
                isActive={activeTaskIds.has(task.id)}
              />
            ))}
          </div>
        ) : (
          <div className="pinned-empty">
            <span style={{ display: 'inline-flex' }}>{Ico.pin(12)}</span>
            <span>Visit or pin tasks to keep them here.</span>
          </div>
        )}

        {/* Recents — heading row with a "View all →" link pinned
            to the right end. Hidden at rest; appears on hover of
            the *entire* row, including the empty space between
            "Recents" and the link. CSS-driven hover (on the
            `recents-heading` class) — using the parent's :hover
            pseudo-class avoids the inline-mouseenter / pointer-
            events gap that left the dead space between elements
            non-receptive. The span flex-grows to fill the row so
            the heading itself owns the empty space too. */}
        <div
          className="section-label recents-heading"
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            cursor: 'default',
            width: '100%',
          }}
          onMouseEnter={() => setRecentsHeadingHover(true)}
          onMouseLeave={() => setRecentsHeadingHover(false)}
        >
          <span style={{ flex: 1 }}>RECENT TASKS</span>
          <button
            type="button"
            className="recents-viewall"
            onClick={() => onNavigate?.('tasks')}
            style={{
              background: 'transparent', border: 0, padding: 0,
              cursor: recentsHeadingHover ? 'pointer' : 'default',
              fontFamily: 'var(--font-body)', fontSize: 11,
              letterSpacing: '0.02em',
              textTransform: 'none',
              opacity: recentsHeadingHover ? 1 : 0,
              transform: recentsHeadingHover ? 'translateX(0)' : 'translateX(2px)',
              pointerEvents: recentsHeadingHover ? 'auto' : 'none',
            }}
            title="View all tasks"
          >
            View all →
          </button>
        </div>
        <div ref={recentsRef} className="scroll-clean" style={{
          padding: '0 10px', flex: 1, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 1,
        }}>
          {recents.map((t) => {
            // Synthetic schedule-group entries route to the schedule
            // detail view (where the per-run history lives). Lone
            // tasks open the chat as before. Pin / move / delete /
            // rename are suppressed on group entries — those actions
            // belong to the underlying schedule, not the synthesised
            // row, and their per-run plumbing wouldn't apply cleanly.
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
              />
            );
          })}
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

        {/* Update available banner */}
        {updateAvailable && (
          <button
            type="button"
            style={{
              margin: '0 10px 6px',
              padding: '8px 12px',
              background: 'rgba(93,146,135,0.12)',
              border: '1px solid rgba(93,146,135,0.30)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 8,
              cursor: 'pointer',
              transition: 'background 120ms ease',
              width: 'calc(100% - 20px)',
              textAlign: 'left',
              fontFamily: 'inherit',
              WebkitAppRegion: 'no-drag',
            }}
            onClick={onApplyUpdate}
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(93,146,135,0.22)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(93,146,135,0.12)'; }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--sage-500, #5D9287)',
              flexShrink: 0,
            }} />
            <span style={{
              flex: 1, fontSize: 11.5, color: 'var(--text-strong)',
              fontFamily: 'var(--font-sans)',
            }}>
              Update available{updateAvailable.version ? ` (${updateAvailable.version})` : ''}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--sage-500, #5D9287)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Install
            </span>
          </button>
        )}

        {/* Footer status — Electron-only. In the hosted web shell the
            FastAPI process IS the host, so start/stop/diagnostics have
            no meaning and we drop the entire pill + power button. */}
        {!host.isWeb && (
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
          {!host.isWeb && (
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
        )}
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
