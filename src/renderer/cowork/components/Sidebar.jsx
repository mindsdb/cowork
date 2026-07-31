import { useEffect, useRef, useState } from 'react';
import Ico from './Icons';
import { Spinner, Kbd, Badge, Input, Button } from './ui';
import { TaskMenu } from './TaskMenu';
import RecentsModal from './RecentsModal';
import { useRevealOnHover } from '../hooks/useRevealOnHover';
import { host } from '../../platform/host';
import { relativeAge } from '../lib/formatTime';

// Platform-aware modifier symbol for keyboard hints. Mac uses ⌘ glyph,
// Windows/Linux use Ctrl+ literal.
const IS_MAC = host.isMac() || /Mac|iPhone|iPod|iPad/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const shortcut = (key) => `${MOD_LABEL}${key}`;

function NavItem({ icon, label, active, onClick, badge, comingSoon }) {
  return (
    <button
      className={`nav-item${active ? ' active' : ''}`}
      onClick={comingSoon ? undefined : onClick}
      aria-label={label}
      data-coming-soon={comingSoon ? '' : undefined}
      style={comingSoon ? { opacity: 0.55, cursor: 'default' } : undefined}
    >
      <span className="nav-row__icon" style={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center' }}>{icon}</span>
      <span className="nav-row__label" style={{ flex: 1 }}>{label}</span>
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
  // One-shot latch: Enter commits once (the trailing unmount-blur is a
  // no-op), and Escape arms it so the same blur can't commit the cancel.
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
    // Toggle: a second click on the kebab closes the menu (the menu's
    // own outside-press dismiss ignores clicks on the trigger, so the
    // close has to come from here).
    if (menuOpen) { setMenuOpen(false); return; }
    if (!triggerRef.current) return;
    setAnchorRect(triggerRef.current.getBoundingClientRect());
    setMenuOpen(true);
  };

  // Fixed-width right slot — both timestamp and kebab are always
  // rendered (cross-fade on hover). Reserving the same width means
  // the row height/width stays constant whether the kebab is visible
  // or not — no jumping when moving between rows.
  return (
    <div
      style={{ position: 'relative', display: 'flex' }}
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
          style={{ flex: 1, minWidth: 0 }}
        />
      ) : (
      <button className={`recent-item${selected ? ' is-selected' : ''}`} onClick={onClick} aria-label={task.title} style={{ flex: 1, minWidth: 0 }}>
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
            fontFamily: 'var(--font-sans)', fontSize: 11,
            color: 'var(--ink-4)',
            opacity: (showKebab || (!showTimestamp && !isActive)) ? 0 : 1,
            transition: 'opacity 120ms ease',
            gap: 6,
          }}>
            {isActive ? (
              <span
                className="pulse-dot"
                title={`${agentLabel || 'Anton'} is working on this task`}
                aria-label="Active"
                style={{
                  display: 'inline-block',
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--accent, #5d9287)',
                  boxShadow: '0 0 0 2px rgba(93,146,135,0.18)',
                }}
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
  // Set when an apply attempt failed (phase 'error'); surfaces a retry so the
  // sidebar doesn't go silent on failure the way it used to (ENG-849 QA find).
  updateError = null, // { version?: string } or null
  onApplyUpdate,
  // Download-only shell update notice.
  shellUpdate = null,
  onDownloadShellUpdate,
  onDismissShellUpdate,
  agentLabel,
  // Light/dark theme + 8-bit skin toggles — the sidebar footer hosts
  // both switches (relocated from the old floating bottom-right
  // buttons; see App.jsx). Defaults keep the buttons harmless if a
  // caller (e.g. a test) doesn't wire them up.
  theme = 'dark',
  onToggleTheme,
  skin = 'normal',
  onToggleSkin,
  // Whether the 8-bit button should render "on". While skin === 'custom',
  // the caller repurposes onToggleSkin to flip the mono font instead of
  // skin itself, so "on" needs to track that font choice, not `skin`.
  // Defaults to the plain skin-based reading for callers that don't pass it.
  is8bitActive,
  // Settings → Appearance → Theme/8-bit toggle buttons. Hide either
  // footer button independently; both default to shown.
  showThemeToggle = true,
  show8bitToggle = true,
  settingsActive = false,
  // Settings → Personalization → Show nav-panel counters. When
  // false, hide the per-nav badge counts AND the time-since slot
  // on each Recent row. Default true.
  showCounters = true,
  // Settings → Appearance → Sidebar title/logo. Replaces the "MindsHub"
  // wordmark; null/empty falls back to the default (text-only, no logo).
  navTitle = null,
  navLogo = null,
}) {
  // Decorate every task with its pinned state. Tasks come from the
  // conversations endpoint which doesn't know about pins (they live
  // in a separate /pins store), so without this the menu shows
  // "Pin" on items that are already pinned.
  const pinnedIds = new Set(
    (pins || []).filter((p) => p.item_type === 'conversation').map((p) => p.item_id)
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

  // Strict hover state for the Recents heading row only. CSS
  // `:hover` was bleeding (or appearing to bleed) onto the recents
  // list below; pinning this to onMouseEnter/onMouseLeave on the
  // heading div makes the hit area exactly the heading's bounding
  // box and nothing else.
  const [recentsHeadingHover, setRecentsHeadingHover] = useState(false);
  // Render into the overflow container and let it scroll instead of
  // slicing the list to whatever fits the viewport (which left older
  // tasks unreachable). Capped at 100 to match RecentsModal; the
  // "View all →" link covers anything beyond that.
  // ponytail: bump the cap or virtualize if row counts get huge.
  const recents = recentsAll.slice(0, 100);
  // "Show more" hidden for now — kept the modal + state plumbing
  // so we can flip this back on later without rewiring anything.
  const hasMoreRecents = false;

  const [recentsModalOpen, setRecentsModalOpen] = useState(false);


  const pinnedTasks = (pins || [])
    .filter((pin) => pin.item_type === 'conversation')
    .map((pin) => {
      const found = tasksWithPin.find((task) => task.id === pin.item_id);
      return found
        ? { ...found, pinned: true }
        : { id: pin.item_id, title: pin.title || pin.item_id, status: 'idle', pinned: true };
    })
    .slice(0, 8);

  // "On" state for the 8-bit button: while skin === 'custom', onToggleSkin
  // is repurposed to flip the mono font (see App.jsx) rather than skin
  // itself, so the caller passes is8bitActive to track that. Falls back to
  // the plain skin-based reading for callers that don't pass it (tests).
  const resolved8bitActive = is8bitActive ?? (skin !== 'normal');

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
        {/* New task CTA — the tinted (accent-wash) variant, full width. */}
        <div className="anton-sidebar__cta-wrap">
          <Button
            variant="tinted"
            block
            size="lg"
            onClick={onNewTask}
            title={`New task  (${shortcut('N')})`}
            style={{ gap: 10 }}
          >
            {Ico.plus(14)}
            <span style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>New task</span>
            <Kbd>{shortcut('N')}</Kbd>
          </Button>
        </div>

        {/* Primary nav */}
        <div className="nav-list" style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <NavItem icon={Ico.folder(15)}  label="Projects"        onClick={() => onNavigate('projects')}  active={activeRoute === 'projects'}  badge={showCounters ? (projectsCount  || null) : null} />
          <NavItem icon={Ico.clock(15)}   label="Scheduled Tasks" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={showCounters ? (scheduledCount || null) : null} />
          <NavItem icon={Ico.sparkle(15)} label="Live Artifacts"  onClick={() => onNavigate('artifacts')} active={activeRoute === 'artifacts'} badge={showCounters ? (artifactsCount || null) : null} />
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
          {/* Channels used to have a standalone entry here, web-only, purely
              because the web shell hid Settings entirely — Channels lives
              under Settings on desktop. Settings is now reachable on web
              (ENG-932), so the workaround is removed and both platforms find
              Channels in the same place. The `channels` route in App.jsx is
              left intact so existing deep links still resolve. */}
        </div>

        {/* Agent — the agent's own brain: what it remembers (Memories)
            and what it can do (Skills library). Pulled out of the old
            bordered inset and presented as a labeled group, so it reads
            as a category alongside Pinned / Recent instead of a drawn
            box (fewer edges). Labels name what the user OWNS (plural
            collections) rather than the engine's abstract concepts. */}
        <div className="section-label">Agent</div>
        <div className="nav-list" style={{ padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <NavItem icon={Ico.brain(15)} label="Memories"       onClick={() => onNavigate('memory')} active={activeRoute === 'memory'} />
          <NavItem icon={Ico.cube(15)}  label="Skills library" onClick={() => onNavigate('skills')} active={activeRoute === 'skills'} />
        </div>

        {/* Pinned — only rendered when there are pinned tasks; an empty
            section just wastes rail space. */}
        {pinnedTasks.length > 0 && (
          <>
            <div className="section-label">Pinned</div>
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
                  selected={activeTaskId === task.id}
                  agentLabel={agentLabel}
                />
              ))}
            </div>
          </>
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
        <div className="scroll-clean" style={{
          padding: '0 10px', flex: 1, minHeight: 0, overflowY: 'auto',
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
                selected={!isGroup && activeTaskId === t.id}
                agentLabel={agentLabel}
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

        {/* A shell reinstall supersedes the OTA banner until dismissed. */}
        {updateAvailable && !shellUpdate && (
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
              Update ready{updateAvailable.version ? ` (${updateAvailable.version})` : ''}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--sage-500, #5D9287)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Restart
            </span>
          </button>
        )}

        {/* A failed apply keeps the banner (as a retry) instead of silently
            vanishing until the next poll — mirrors Settings → Software updates. */}
        {updateError && !shellUpdate && (
          <button
            type="button"
            style={{
              margin: '0 10px 6px',
              padding: '8px 12px',
              background: 'rgba(196,127,0,0.12)',
              border: '1px solid rgba(196,127,0,0.30)',
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
            onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(196,127,0,0.22)'; }}
            onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(196,127,0,0.12)'; }}
          >
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--warning, #c47f00)',
              flexShrink: 0,
            }} />
            <span style={{
              flex: 1, fontSize: 11.5, color: 'var(--text-strong)',
              fontFamily: 'var(--font-sans)',
            }}>
              Update failed{updateError.version ? ` (${updateError.version})` : ''}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--warning, #c47f00)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Try again
            </span>
          </button>
        )}

        {/* Shell updates are download-only and dismissible per version. */}
        {shellUpdate && (
          <div
            style={{
              margin: '0 10px 6px',
              padding: '8px 12px',
              background: 'rgba(93,146,135,0.12)',
              border: '1px solid rgba(93,146,135,0.30)',
              borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 8,
              width: 'calc(100% - 20px)',
              WebkitAppRegion: 'no-drag',
            }}
          >
            <button
              type="button"
              onClick={onDownloadShellUpdate}
              title={`A new version of MindsHub Cowork is available${shellUpdate.version ? ` (${shellUpdate.version})` : ''} — download the installer, then quit the app and open it to update`}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', gap: 8,
                background: 'none', border: 'none', padding: 0, margin: 0,
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--sage-500, #5D9287)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11.5, color: 'var(--text-strong)', fontFamily: 'var(--font-sans)' }}>
                New version available{shellUpdate.version ? ` (${shellUpdate.version})` : ''}
              </span>
              <span style={{
                fontSize: 10, color: 'var(--sage-500, #5D9287)', fontFamily: 'var(--font-mono)',
                letterSpacing: '0.03em', textTransform: 'uppercase', fontWeight: 600,
              }}>
                Download
              </span>
            </button>
            <button
              type="button"
              onClick={onDismissShellUpdate}
              aria-label="Dismiss update notice"
              title="Dismiss"
              style={{
                background: 'none', border: 'none', padding: '0 2px', margin: 0,
                cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1, flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Footer — always rendered so the theme toggle (relocated here
            from the old floating bottom-right button) is reachable on
            both Electron and the hosted web shell. The settings /
            backend-status controls stay Electron-only: the FastAPI
            process IS the host on web, so start/stop/diagnostics don't
            apply. Settings itself is NOT Electron-only any more — the web
            shell used to hide it entirely, which also hid the only
            workaround for ENG-1042; see the gate below (ENG-932).

            Normal state: a settings nav row — no server noise when everything
            is working fine.
            Disconnected / busy: the status pill replaces the settings row so
            the problem is immediately visible. */}
        <div className="anton-sidebar__footer">
          {/* The status-pill variant is Electron-only — on web the FastAPI
              process IS the host, so there is no local server lifecycle to
              report on. But Settings itself must be reachable on web
              (ENG-932): it holds the reasoning-effort control, which is the
              only user-side workaround for a turn that burns its whole
              output budget and returns nothing (ENG-1042). So web always
              gets the plain Settings row; only the pill is gated. */}
          {(!host.isWeb && (!serverOnline || serverBusy)) ? (
              <>
                <button
                  type="button"
                  className={
                    'backend-status-control is-clickable' +
                    (serverBusy ? ' is-busy' : '')
                  }
                  onClick={onShowServerHelp}
                  title="Backend status — click for details"
                  aria-label="Backend status — click for details"
                  style={{ WebkitAppRegion: 'no-drag', flex: 1 }}
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
                <button
                  className={'chrome-btn--small' + (settingsActive ? ' is-on' : '')}
                  onClick={() => onNavigate('settings:backend')}
                  title="Settings"
                  aria-label="Settings"
                  style={{ WebkitAppRegion: 'no-drag', flexShrink: 0 }}
                >
                  {Ico.settings(13)}
                </button>
              </>
            ) : (
              <button
                className={'anton-sidebar__footer-settings' + (settingsActive ? ' is-on' : '')}
                onClick={() => onNavigate('settings:agent')}
                title="Settings"
                aria-label="Settings"
                style={{ WebkitAppRegion: 'no-drag', flex: 1, minWidth: 0 }}
              >
                <span style={{ display: 'inline-flex', flexShrink: 0 }}>{Ico.settings(13)}</span>
                <span>Settings</span>
              </button>
            )}
          {(show8bitToggle || showThemeToggle) && (
            // Marks these as quick display toggles, not settings — separate
            // from the Settings/backend-status controls to the left.
            <span
              aria-hidden="true"
              className="anton-sidebar__footer-divider"
              style={{ WebkitAppRegion: 'no-drag', marginLeft: 'auto' }}
            />
          )}
          {show8bitToggle && (
            <button
              className={'chrome-btn--small' + (resolved8bitActive ? ' is-on' : '')}
              onClick={onToggleSkin}
              title={skin === 'custom' ? '8-bit font' : '8-bit style'}
              aria-label={skin === 'custom' ? 'Toggle 8-bit font' : 'Toggle 8-bit style'}
              style={{ WebkitAppRegion: 'no-drag', flexShrink: 0 }}
            >
              {Ico.gamepad(15)}
            </button>
          )}
          {showThemeToggle && (
            <button
              className="chrome-btn--small"
              onClick={onToggleTheme}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              style={{ WebkitAppRegion: 'no-drag', flexShrink: 0 }}
            >
              {theme === 'dark' ? Ico.sun(15) : Ico.moon(15)}
            </button>
          )}
        </div>

        {/* Version is shown on the Settings page — no need to repeat here. */}
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
