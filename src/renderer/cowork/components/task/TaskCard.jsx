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

const FONT_BODY = "'Inter', system-ui, sans-serif";

function turnsCount(task) {
  if (Number.isFinite(task.turns)) return task.turns;
  if (Array.isArray(task.messages)) {
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
      style={{ position: 'relative' }}
      {...hoverProps}
    >
      <Card
        as="div"
        interactive
        padding="cozy"
        onActivate={onClick}
        style={{
          width: '100%',
          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 14, alignItems: 'flex-start',
        }}
      >
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 8,
            minWidth: 0,
          }}>
            {isActive && (
              // Subtle accent dot — same `pulse-dot` keyframe used
              // elsewhere in the app. Soft accent glow so it reads
              // as "live activity" at a glance without competing
              // with the title text.
              <span
                aria-hidden
                className="pulse-dot"
                title="Running"
                style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: 'var(--accent)',
                  boxShadow: '0 0 8px color-mix(in srgb, var(--accent) 55%, transparent)',
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{
              fontFamily: FONT_BODY, fontWeight: 600,
              fontSize: 14, color: 'var(--ink)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              minWidth: 0,
            }}>
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
            <span style={{
              fontFamily: FONT_BODY,
              fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>
              {subtitle}
            </span>
          )}
        </div>

        {/* Right meta column. Fixed-width slot so the row width never
            shifts when the kebab fades in over the timestamp/turns. */}
        <div style={{
          position: 'relative',
          minWidth: 80, height: 32,
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'flex-end',
          flexShrink: 0,
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
            gap: 4,
            opacity: showKebab ? 0 : 1,
            transition: 'opacity 120ms ease',
            pointerEvents: showKebab ? 'none' : 'auto',
          }}>
            <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
              {updated || '—'}
            </span>
            {turns != null && (
              <span style={{ fontFamily: FONT_BODY, fontSize: 11.5, color: 'var(--ink-4)' }}>
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
              style={{
                position: 'absolute', top: 0, right: 0,
                width: 26, height: 26, borderRadius: 6,
                display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                color: 'var(--ink-3)', cursor: 'pointer',
                opacity: showKebab ? 1 : 0,
                pointerEvents: showKebab ? 'auto' : 'none',
                transition: 'opacity 120ms ease, background 120ms ease, color 120ms ease',
              }}
              onMouseOver={(e) => { e.currentTarget.style.background = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--ink)'; }}
              onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-3)'; }}
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
