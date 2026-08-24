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
import OnboardingChecklist from './onboarding/OnboardingChecklist';
import FirstArtifactTip from './onboarding/FirstArtifactTip';

// Platform-aware modifier symbol for keyboard hints. Mac uses ⌘ glyph,
// Windows/Linux use Ctrl+ literal.
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
      {/* Keep long labels ("Connected Apps and Data") on one line — at the
          narrow end of the sidebar's clamp they'd otherwise wrap to two rows.
          min-w-0 lets the flex item shrink below its content so the ellipsis
          can engage instead of forcing a wrap. */}
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
          {/* Schedule-group entries — append a muted "· N runs"
              suffix so the title still reads clean while the count
              is visually separated from the schedule name. Painted
              in --ink-4 (one tone below the title) and the bullet
              uses --ink-5 so the separator recedes further still. */}
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

        {/* Right-side fixed slot — 22px wide, holds timestamp OR kebab. The
            negative right margin (-mr-1.5 = 6px) pulls the slot into the row's
            10px right padding so the kebab (and the timestamp it cross-fades
            with) sit snug against the edge of the hover fill, not a full
            gutter-width inside it. */}
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
  shellAutoUpdate = null,
  onShellAutoUpdateAction,
  onDownloadShellUpdate,
  onDismissShellUpdate,
  agentLabel,
  settingsActive = false,
  // Signed-in state, pushed from App — the user-menu hook re-reads the
  // access token when this flips (ENG-761 pattern), so the footer swaps
  // between the plain Settings row and the account row without a reload.
  isSsoConnected = false,
  // Settings → Personalization → Show nav-panel counters. When
  // false, hide the per-nav badge counts AND the time-since slot
  // on each Recent row. Default true.
  showCounters = true,
  // Settings → Appearance → Sidebar title/logo. Replaces the "MindsHub"
  // wordmark; null/empty falls back to the default (text-only, no logo).
  navTitle = null,
  navLogo = null,
  // Onboarding — "Get to know Cowork" checklist. Each step seeds a new
  // chat via this handler (App's send-from-home). Omit to hide the card
  // (tests, web shells that don't wire it).
  onStartChat = null,
  // First-artifact tip — App arms it (0 → 1 artifacts transition) and
  // owns the persistent dismissal; the sidebar anchors it to the Live
  // Artifacts nav row and adds the "clicking the row dismisses" path.
  artifactTipOpen = false,
  onArtifactTipDismiss,
}) {
  // Signed-in account identity (null when signed out) — decides whether the
  // footer shows the account row + user menu or the plain Settings row.
  const accountUser = useAccountUser(isSsoConnected);

  // Footer states. The status pill wins over everything (Electron-only, the
  // server needs attention); otherwise a signed-in user gets the account row.
  // The quick toggles are keyed off "is the user menu actually rendered", not
  // "is the user signed in" — while the pill shows, the menu (which hosts the
  // theme switch) isn't on screen, so the toggles must stay.
  const showsStatusPill = !host.isWeb && (!serverOnline || serverBusy);
  const showsUserMenu = !showsStatusPill && !!accountUser;

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

  // Anchor for the first-artifact tip — the Live Artifacts nav row (the
  // count badge sits at its right edge, where the tip's arrow points).
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
      style={{
        // Dynamic-only: everything else about this transition lives in the
        // className above. These four properties are collapsed-state-driven
        // and can't be static Tailwind classes.
        // Combine a gentle leftward translate with a slight scale so
        // the sidebar reads as "settling into place" rather than just
        // sliding. Origin pinned to the left edge so the scale grows
        // from the dock side; the eye picks up the easing curve
        // along with the width interpolation for a single coherent
        // motion. Scale + filter values are subtle on purpose —
        // they're the difference between "this animated" and
        // "this animated nicely."
        width: collapsed ? 0 : 'clamp(240px, 24vw, 320px)',
        opacity: collapsed ? 0 : 1,
        transform: collapsed
          ? 'translateX(-12px) scale(0.985)'
          : 'translateX(0) scale(1)',
        filter: collapsed ? 'blur(6px)' : 'blur(0)',
        pointerEvents: collapsed ? 'none' : 'auto',
      }}
    >
      {/* Top chrome row: traffic-light pad + collapse/search + ANTON wordmark.
          padding-top reduced from 14 → 9 to bring the buttons + wordmark
          5px upward, so they line up with the macOS traffic lights at
          their new (x:18, y:22) position. */}
      <div
        className="anton-sidebar__chrome drag-region shrink-0"
        // cascade-forced: overrides .anton-sidebar__chrome's default
        // `padding: 14px 14px 8px` — also dynamic (host.isWeb picks the
        // left inset that clears the macOS traffic lights in Electron).
        style={{ padding: `9px 14px 8px ${host.isWeb ? 14 : 88}px` }}
      >
        {/* Right-aligned cluster: collapse + search icons, then a
            middle-dot separator, then the ANTON wordmark. The chrome's
            existing `justify-content: space-between` pushes the whole
            cluster against the right edge (the left half is empty space
            past the traffic-light pad). */}
        <div className="flex-1" />
        <div
          className="anton-sidebar__chrome-left ml-auto"
          // cascade-forced: overrides .anton-sidebar__chrome-left's default
          // `gap: 14px` with a tighter 4px for this cluster.
          style={{ gap: 4 }}
        >
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
                <Tooltip content={canToggle ? `${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}  (${shortcut('B')})` : ''}>
                  <button
                    className="icon-btn [-webkit-app-region:no-drag] origin-center"
                    onClick={canToggle ? onToggleCollapsed : undefined}
                    disabled={!canToggle}
                    aria-hidden={canToggle ? undefined : 'true'}
                    tabIndex={canToggle ? undefined : -1}
                    aria-label={canToggle ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : undefined}
                    style={{
                      // All dynamic (canToggle-gated), plus `transition` stays
                      // inline: .icon-btn sets its own `transition: background
                      // .12s, color .12s` — a Tailwind class would lose that
                      // cascade tie (same specificity, .icon-btn declared later
                      // in the stylesheet), silently dropping this custom
                      // opacity/transform/filter transition.
                      opacity: canToggle ? 1 : 0,
                      // Slight scale + tilt + blur on hide so the
                      // motion is recognisable from the corner of the
                      // eye but never noisy. Origin pinned to center
                      // so the slot's geometry stays symmetric.
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

      {/* Body — fades + slides in slightly behind the container so
          the motion staggers. On appearance the body lags ~80ms so
          the surrounding chrome lands first; on dismissal it leads
          the container so the contents exit before the box does. */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        // All dynamic: opacity/transform/pointerEvents/transition-delay are
        // collapsed-state-driven (the transition string embeds a delay that
        // flips 0ms/80ms), so none of this can be a static Tailwind class.
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
        {/* New task CTA — the tinted (accent-wash) variant, full width. */}
        <div className="anton-sidebar__cta-wrap">
          <Button
            variant="tinted"
            block
            size="lg"
            onClick={onNewTask}
            // cascade-forced: .btn sets `gap: 6px`; match the nav rows' 9px.
            style={{ gap: 9 }}
          >
            {Ico.plus(14)}
            <span className="flex-1 text-left font-medium">New task</span>
            <Kbd>{shortcut('N')}</Kbd>
          </Button>
        </div>

        {/* Primary nav */}
        <div className="nav-list px-2.5 flex flex-col gap-px">
          <NavItem icon={Ico.folder(15)}  label="Projects"        onClick={() => onNavigate('projects')}  active={activeRoute === 'projects'}  badge={showCounters ? (projectsCount  || null) : null} />
          <NavItem icon={Ico.clock(15)}   label="Scheduled Tasks" onClick={() => onNavigate('scheduled')} active={activeRoute === 'scheduled'} badge={showCounters ? (scheduledCount || null) : null} />
          <NavItem
            icon={Ico.sparkle(15)}
            label="Live Artifacts"
            elementRef={artifactsNavRef}
            onClick={() => {
              // Opening the artifacts view IS the tip's goal — count it
              // as a dismissal, same as "Got it" / "Show me".
              if (artifactTipOpen) onArtifactTipDismiss?.();
              onNavigate('artifacts');
            }}
            active={activeRoute === 'artifacts'}
            badge={showCounters ? (artifactsCount || null) : null}
          />
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
              under Settings on desktop. Settings is now reachable on web too,
              so the workaround is removed and both platforms find Channels
              in the same place. */}
        </div>

        {/* Agent — the agent's own brain: what it remembers (Memories)
            and what it can do (Skills library). Pulled out of the old
            bordered inset and presented as a labeled group, so it reads
            as a category alongside Pinned / Recent instead of a drawn
            box (fewer edges). Labels name what the user OWNS (plural
            collections) rather than the engine's abstract concepts. */}
        <div className="section-label">Agent</div>
        <div className="nav-list px-2.5 flex flex-col gap-px">
          <NavItem icon={Ico.brain(15)} label="Memories"       onClick={() => onNavigate('memory')} active={activeRoute === 'memory'} />
          <NavItem icon={Ico.cube(15)}  label="Skills library" onClick={() => onNavigate('skills')} active={activeRoute === 'skills'} />
        </div>

        {/* Pinned — only rendered when there are pinned tasks; an empty
            section just wastes rail space. */}
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
                // Dynamic: hover state (recentsHeadingHover), driven by the
                // parent row's onMouseEnter/onMouseLeave above.
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
              className="recents-show-more mt-1.5 mx-0 mb-1 py-[7px] px-2.5 bg-transparent border border-dashed border-line-2 rounded-[7px] text-ink-3 font-[family-name:var(--font-body)] text-[12px] cursor-pointer flex items-center justify-between gap-2 hover:bg-surface-2 hover:border-line hover:text-ink [transition:background_120ms_ease,color_120ms_ease,border-color_120ms_ease]"
            >
              <span>Show more</span>
              <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-ink-4">
                +{recentsAll.length - recents.length}
              </span>
            </button>
          )}
        </div>

        {/* Onboarding tracker — docked above the footer on every screen.
            Hides itself once dismissed (post-completion). */}
        {onStartChat && <OnboardingChecklist onStartChat={onStartChat} />}

        {/* A shell reinstall supersedes the OTA banner until dismissed. */}
        {updateAvailable && !shellUpdate && (
          <button
            type="button"
            className="mt-0 mx-2.5 mb-1.5 py-2 px-3 bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] border border-solid border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] rounded-lg flex items-center gap-2 cursor-pointer w-[calc(100%-20px)] text-left font-[inherit] [-webkit-app-region:no-drag] hover:bg-[color-mix(in_srgb,var(--sage-500)_22%,transparent)] [transition:background_120ms_ease]"
            onClick={onApplyUpdate}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--sage-500,#5D9287)] shrink-0" />
            <span className="flex-1 text-[11.5px] text-ink font-[family-name:var(--font-sans)]">
              Update ready{updateAvailable.version ? ` (${updateAvailable.version})` : ''}
            </span>
            <span className="text-2xs text-[var(--sage-500,#5D9287)] font-[family-name:var(--font-mono)] tracking-[0.03em] uppercase font-semibold">
              Restart
            </span>
          </button>
        )}

        {/* A failed apply keeps the banner (as a retry) instead of silently
            vanishing until the next poll — mirrors Settings → Software updates. */}
        {updateError && !shellUpdate && (
          <button
            type="button"
            className="mt-0 mx-2.5 mb-1.5 py-2 px-3 bg-[rgba(196,127,0,0.12)] border border-solid border-[rgba(196,127,0,0.30)] rounded-lg flex items-center gap-2 cursor-pointer w-[calc(100%-20px)] text-left font-[inherit] [-webkit-app-region:no-drag] hover:bg-[rgba(196,127,0,0.22)] [transition:background_120ms_ease]"
            onClick={onApplyUpdate}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning,#c47f00)] shrink-0" />
            <span className="flex-1 text-[11.5px] text-ink font-[family-name:var(--font-sans)]">
              Update failed{updateError.version ? ` (${updateError.version})` : ''}
            </span>
            <span className="text-2xs text-[var(--warning,#c47f00)] font-[family-name:var(--font-mono)] tracking-[0.03em] uppercase font-semibold">
              Try again
            </span>
          </button>
        )}

        {/* Shell auto-update (electron-updater): background download, install on
            relaunch. Rendered for the active phases; the action is phase-driven
            (download / restart / retry) and disabled while work is in flight. */}
        {shellAutoUpdate && ['available', 'downloading', 'ready-to-install', 'installing', 'failed'].includes(shellAutoUpdate.phase) && (
          <button
            type="button"
            onClick={onShellAutoUpdateAction}
            disabled={shellAutoUpdate.phase === 'downloading' || shellAutoUpdate.phase === 'installing'}
            className="mt-0 mx-2.5 mb-1.5 py-2 px-3 bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] border border-solid border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] rounded-lg flex items-center gap-2 w-[calc(100%-20px)] [-webkit-app-region:no-drag] font-[inherit] cursor-pointer disabled:cursor-default"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--sage-500,#5D9287)] shrink-0" />
            <span className="flex-1 text-[11.5px] text-left text-ink font-[family-name:var(--font-sans)]">
              {shellAutoUpdate.phase === 'downloading'
                ? `Downloading update${shellAutoUpdate.progress?.percent != null ? ` (${Math.round(shellAutoUpdate.progress.percent)}%)` : '…'}`
                : shellAutoUpdate.phase === 'ready-to-install'
                  ? 'App update ready'
                  : shellAutoUpdate.phase === 'installing'
                    ? 'Installing update…'
                    : shellAutoUpdate.phase === 'failed'
                      ? 'App update failed'
                      : 'New app version available'}
            </span>
            <span className="text-2xs text-[var(--sage-500,#5D9287)] font-[family-name:var(--font-mono)] tracking-[0.03em] uppercase font-semibold">
              {shellAutoUpdate.phase === 'ready-to-install'
                ? 'Restart'
                : shellAutoUpdate.phase === 'failed'
                  ? (shellAutoUpdate.recoverable ? 'Retry' : 'Download')
                  : shellAutoUpdate.phase === 'available'
                    ? 'Download'
                    : ''}
            </span>
          </button>
        )}

        {/* Shell (installer) update notice — the app itself is newer than what's
            installed; the shell can't hot-update, so this links to the download
            and is dismissible per-version (ENG-849). */}
        {shellUpdate && (!shellAutoUpdate || shellAutoUpdate.phase === 'disabled') && (
          <div className="mt-0 mx-2.5 mb-1.5 py-2 px-3 bg-[color-mix(in_srgb,var(--sage-500)_12%,transparent)] border border-solid border-[color-mix(in_srgb,var(--sage-500)_30%,transparent)] rounded-lg flex items-center gap-2 w-[calc(100%-20px)] [-webkit-app-region:no-drag]">
            <Tooltip content={`A new version of MindsHub Cowork is available${shellUpdate.version ? ` (${shellUpdate.version})` : ''} — download the installer, then quit the app and open it to update`}>
            <button
              type="button"
              onClick={onDownloadShellUpdate}
              className="flex-1 flex items-center gap-2 bg-transparent border-0 p-0 m-0 cursor-pointer text-left font-[inherit]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--sage-500,#5D9287)] shrink-0" />
              <span className="flex-1 text-[11.5px] text-ink font-[family-name:var(--font-sans)]">
                New version available{shellUpdate.version ? ` (${shellUpdate.version})` : ''}
              </span>
              <span className="text-2xs text-[var(--sage-500,#5D9287)] font-[family-name:var(--font-mono)] tracking-[0.03em] uppercase font-semibold">
                Download
              </span>
            </button>
            </Tooltip>
            <Tooltip content="Dismiss">
              <button
                type="button"
                onClick={onDismissShellUpdate}
                aria-label="Dismiss update notice"
                className="bg-transparent border-0 py-0 px-0.5 m-0 cursor-pointer text-ink-3 text-base leading-none shrink-0"
              >
                ×
              </button>
            </Tooltip>
          </div>
        )}

        {/* Footer — the settings / backend-status controls stay
            Electron-only: the FastAPI process IS the host on web, so
            start/stop/diagnostics don't apply. Settings itself is NOT
            Electron-only any more — the web shell used to hide it
            entirely, which also hid the only workaround for ENG-1042;
            see the gate below (ENG-932).

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
              // Signed in: the account row + user menu (ENG-1408), curated to
              // the account destinations (Settings, Billing & Usage, Members,
              // Help & Feedback, Logout).
              <>
                <UserMenu
                  user={accountUser}
                  onOpenSettings={() => onNavigate('settings')}
                />
                {/* Quick shortcut — kept visible even with the user menu
                    present, so Settings stays one click away rather than
                    buried behind opening the menu first. The status-pill
                    and signed-out states already show a Settings button
                    directly, so this only adds value here. Display
                    settings (theme/8-bit/coding mode) moved to the
                    floating corner button — see App.jsx. */}
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

        {/* Version is shown on the Settings page — no need to repeat here. */}
      </div>

      <FirstArtifactTip
        // Hold the tip while the sidebar is collapsed — the anchor is
        // invisible (opacity 0) and the popover would point at nothing.
        // The arm state survives, so it shows on the next expand.
        open={artifactTipOpen && !collapsed}
        anchorRef={artifactsNavRef}
        onGotIt={() => onArtifactTipDismiss?.()}
        onShowMe={() => {
          onArtifactTipDismiss?.();
          onNavigate('artifacts');
        }}
      />

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
