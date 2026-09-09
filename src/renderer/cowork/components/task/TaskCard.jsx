// Task bubble button — used in project view's task list and any
// future "list of conversations" surface. Inter throughout (no
// monospace), Inter reserved for the small "turns" badge if we ever
// want to display it as an eyebrow.
//
// Hover surfaces a kebab in the right meta column (keeping row width
// constant via a fixed-width slot) that opens a TaskMenu — currently
// just "Delete" exposed; pin/move/rename will come back when we
// re-enable them.

import { useRef, useState } from 'react';
import Ico from '../Icons';
import { Badge, Card } from '../ui';
import { TaskMenu } from '../TaskMenu';
import { useRevealOnHover } from '../../hooks/useRevealOnHover';
import { relativeAge } from '../../lib/formatTime';

function turnsCount(task) {
  if (Number.isFinite(task.turns)) return task.turns;
  // Length-checked, not just shape-checked: since ENG-2246 a task can carry an
  // empty `messages` before its transcript is warmed, and an existing
  // conversation never really has zero user turns — so [] means "unknown", and
  // the card should hide the count rather than assert "0 turns".
  if (Array.isArray(task.messages) && task.messages.length > 0) {
    return task.messages.filter((m) => m.role === 'user').length;
  }
  return null;
}

export function TaskCard({
  task,
  onClick,
  // Optional menu wiring — the card renders a hover kebab when any
  // of these are provided. Move/rename are intentionally not exposed
  // on this surface for now per current spec.
  projects = [],
  onPin,
  onUnpin,
  onDelete,
  onMoveToProject,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  const { revealed: showKebab, hoverProps } = useRevealOnHover(menuOpen);

  const subtitle = task.subtitle || task.preview || '';
  const updated = relativeAge(task.updatedAt || task.updated_at || task.created_at);
  const turns = turnsCount(task);
  // App.jsx flips task.status to 'active' while a turn is streaming
  // and back to 'idle' on completion. Use it as the live indicator —
  // a subtle pulsing accent dot beside the title reads as "this one
  // is doing something" without taking up a whole status pill.
  const isActive = task.status === 'active';

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

  return (
    <div
      className="relative"
      {...hoverProps}
    >
      <Card
        as="div"
        interactive
        padding="cozy"
        onActivate={onClick}
        className="w-full grid grid-cols-[minmax(0,1fr)_auto] gap-[14px] items-start"
      >
        <div className="min-w-0 flex flex-col gap-1">
          <span className="flex items-center gap-2 min-w-0">
            {isActive && (
              // Subtle accent dot — same `pulse-dot` keyframe used
              // elsewhere in the app. Soft accent glow so it reads
              // as "live activity" at a glance without competing
              // with the title text.
              <span
                aria-hidden
                className="pulse-dot w-[7px] h-[7px] rounded-full bg-accent shadow-[0_0_8px_color-mix(in_srgb,var(--accent)_55%,transparent)] shrink-0"
                title="Running"
              />
            )}
            <span className="font-body font-semibold text-base text-ink overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
              {task.title || 'Untitled'}
            </span>
            {task._scheduleGroup && (
              <Badge
                title={`Schedule with ${task._scheduleGroup.runs} run${task._scheduleGroup.runs === 1 ? '' : 's'}`}
                variant="accent"
                size="sm"
                className="shrink-0 uppercase tracking-[0.04em]"
              >Schedule · {task._scheduleGroup.runs}</Badge>
            )}
          </span>
          {subtitle && (
            <span className="font-body text-sm text-ink-3 leading-[1.4] line-clamp-2">
              {subtitle}
            </span>
          )}
        </div>

        {/* Right meta column. Fixed-width slot so the row width never
            shifts when the kebab fades in over the timestamp/turns. */}
        <div className="relative min-w-[80px] h-8 flex items-start justify-end shrink-0">
          <div
            className="flex flex-col items-end gap-1 [transition:opacity_120ms_ease]"
            style={{
              opacity: showKebab ? 0 : 1,
              pointerEvents: showKebab ? 'none' : 'auto',
            }}
          >
            <span className="font-body text-[11.5px] text-ink-4">
              {updated || '—'}
            </span>
            {turns != null && (
              <span className="font-body text-[11.5px] text-ink-4">
                {turns} {turns === 1 ? 'turn' : 'turns'}
              </span>
            )}
          </div>
          {(onDelete || onPin || onUnpin) && (
            <span
              ref={triggerRef}
              role="button"
              aria-label="Task menu"
              onClick={openMenu}
              className="absolute top-0 right-0 w-[26px] h-[26px] rounded-[6px] inline-flex items-center justify-center text-ink-3 hover:text-ink bg-transparent hover:bg-surface-2 cursor-pointer [transition:opacity_120ms_ease,background_120ms_ease,color_120ms_ease]"
              style={{
                opacity: showKebab ? 1 : 0,
                pointerEvents: showKebab ? 'auto' : 'none',
              }}
            >
              {Ico.moreVert(14)}
            </span>
          )}
        </div>
      </Card>

      <TaskMenu
        task={task}
        projects={projects}
        open={menuOpen}
        anchorRect={anchorRect}
        onClose={() => setMenuOpen(false)}
        onPin={onPin ? () => onPin(task) : undefined}
        onUnpin={onUnpin ? () => onUnpin(task.id) : undefined}
        onDelete={onDelete ? () => onDelete(task.id) : undefined}
        // "Move to project…" opens the picker modal (parent handles it).
        // Rename stays hidden on the card surface for now.
        onMoveToProject={onMoveToProject ? () => onMoveToProject(task) : undefined}
        hideMoveToProject={!onMoveToProject}
        hideRename
      />
    </div>
  );
}
