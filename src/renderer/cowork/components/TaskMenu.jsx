// Task action menu — used in two places:
//   1. Sidebar RecentItem / pinned items, on hover
//   2. Chat header (with extra Schedule + Turn into skill items)
//
// Renders as a positioned popover anchored to the trigger button. The
// trigger is provided by the parent (a 3-dot kebab); we just take the
// task and a set of callbacks. Clicking outside / Esc closes.
//
// Project list is fetched lazily once when "Move to project" hovers
// open, then cached for the lifetime of the menu.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Ico from './Icons';

function MenuButton({ icon, label, onClick, danger = false, hint, hasSubmenu = false, onMouseEnter, onMouseLeave }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        all: 'unset', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px',
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--ink-2)',
        borderRadius: 6,
        width: 'calc(100% - 20px)',
        margin: '0 4px',
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = danger ? 'color-mix(in srgb, var(--danger) 12%, transparent)' : 'var(--surface-2)'; }}
      onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon && (
        <span style={{ display: 'inline-flex', flexShrink: 0, color: danger ? 'var(--danger)' : 'var(--ink-3)' }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {hint && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-4)' }}>{hint}</span>}
      {hasSubmenu && <span style={{ display: 'inline-flex', color: 'var(--ink-4)' }}>{Ico.chevRight(11)}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />;
}

export function TaskMenu({
  task,
  projects = [],
  open,
  anchorRect,                 // {top, left, bottom, right} from trigger.getBoundingClientRect()
  align = 'right',            // 'right' anchors the menu's right edge to the trigger's right edge
  onClose,
  onPin,
  onUnpin,
  onRename,
  onDelete,
  onMoveToProject,
  // Header-only extras:
  onSchedule,
  onTurnIntoSkill,
  showHeaderActions = false,
  // Per current spec: move/rename are temporarily hidden from every
  // surface. Default to hidden so callers don't have to opt out;
  // re-enable per call site when those flows ship.
  hideMoveToProject = true,
  hideRename = true,
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const popoverRef = useRef(null);
  const submenuRef = useRef(null);
  const moveItemRef = useRef(null);
  const [submenuPos, setSubmenuPos] = useState(null);

  // Auto-close grace timer. Only fires after the user has entered
  // the menu and then moved the cursor back out — never on the
  // initial open. Click-outside / Esc handle the "never engaged"
  // case without cutting off users who are still travelling toward
  // the menu (the gap below the kebab made the old initial timer
  // close menus mid-travel).
  const closeTimer = useRef(null);
  const cancelCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = (ms = 450) => {
    cancelCloseTimer();
    closeTimer.current = setTimeout(() => onClose?.(), ms);
  };

  // Submenu open timer — opens on hover with a tiny delay, but more
  // importantly stays open while the cursor is en route between menu
  // and submenu (the 4px gap was firing onMouseLeave before the click
  // could land on a submenu item).
  const submenuTimer = useRef(null);
  const cancelSubmenuTimer = () => {
    if (submenuTimer.current) {
      clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  };

  // Esc + click-outside + initial auto-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onClick = (e) => {
      const inMain = popoverRef.current?.contains(e.target);
      const inSub  = submenuRef.current?.contains(e.target);
      if (!inMain && !inSub) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    // Use mousedown so the close fires before any other click handler
    // on the page (e.g. the row click that would re-open the menu).
    window.addEventListener('mousedown', onClick);

    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
      cancelCloseTimer();
      cancelSubmenuTimer();
    };
  }, [open, onClose]);

  // Reset submenu state on close.
  useEffect(() => {
    if (!open) {
      setMoveOpen(false);
      setSubmenuPos(null);
      cancelCloseTimer();
      cancelSubmenuTimer();
    }
  }, [open]);

  // Position state — must be declared BEFORE any early return so
  // hooks order stays stable across renders (React error #310).
  const [top, setTop] = useState(() => (anchorRect?.bottom ?? 0) + 4);
  const [measured, setMeasured] = useState(false);

  // Reset measurement whenever the anchor or visible item set changes.
  useLayoutEffect(() => {
    setMeasured(false);
  }, [anchorRect, hideMoveToProject, hideRename, onPin, onUnpin, showHeaderActions, open]);

  // Track which side we landed on so the invisible hover bridge
  // can be placed against the trigger (above when below, below
  // when flipped above).
  const [flipped, setFlipped] = useState(false);

  // After render, read the actual height and flip above the trigger
  // if it doesn't fit below. Sit flush against the trigger (no visible
  // gap) so the cursor can't fall through dead space on the way to
  // the menu — the hover bridge below covers any sub-pixel rounding.
  useLayoutEffect(() => {
    if (!open || !popoverRef.current || !anchorRect) return;
    const h = popoverRef.current.offsetHeight;
    const VH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const spaceBelow = VH - 8 - anchorRect.bottom;
    const flip = h > spaceBelow;
    const next = flip
      ? Math.max(8, anchorRect.top - h)
      : anchorRect.bottom;
    setTop(next);
    setFlipped(flip);
    setMeasured(true);
  }, [open, anchorRect, moveOpen]);

  if (!open) return null;

  // Horizontal position — pure derived value, safe after the early return.
  const MENU_WIDTH = 220;
  const VW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const wantedLeft = align === 'right'
    ? (anchorRect?.right ?? 0) - MENU_WIDTH
    : (anchorRect?.left ?? 0);
  const left = Math.min(Math.max(8, wantedLeft), VW - MENU_WIDTH - 8);

  const handleMoveHover = () => {
    cancelSubmenuTimer();
    if (!moveItemRef.current) return;
    const r = moveItemRef.current.getBoundingClientRect();
    setSubmenuPos({ top: r.top, left: r.right + 4 });
    setMoveOpen(true);
  };

  // Defer closing the submenu so the cursor has time to cross the
  // 4px gap from the menu edge into the submenu without the submenu
  // disappearing.
  const scheduleSubmenuClose = () => {
    cancelSubmenuTimer();
    submenuTimer.current = setTimeout(() => setMoveOpen(false), 220);
  };

  return (
    <div
      ref={popoverRef}
      onMouseEnter={cancelCloseTimer}
      onMouseLeave={scheduleClose}
      style={{
        position: 'fixed', top, left, zIndex: 60,
        width: 220,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        boxShadow: '0 12px 32px rgba(15,16,17,0.18), 0 1px 0 rgba(15,16,17,0.04)',
        padding: '4px 0',
        WebkitAppRegion: 'no-drag',
        // Stay hidden until the layout effect measures the actual
        // height and decides whether to flip — prevents a flash at
        // the wrong position on initial render.
        visibility: measured ? 'visible' : 'hidden',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Invisible hover bridge — sits 8px outside the popover on
          whichever side the trigger is on, so cursor travel from
          kebab → menu (or menu → kebab) never crosses dead space.
          The popover's onMouseEnter/Leave fire on this element too,
          which keeps the close timer cancelled while traversing. */}
      <span
        aria-hidden
        style={{
          position: 'absolute', left: 0, right: 0, height: 8,
          top: flipped ? '100%' : -8,
          background: 'transparent', pointerEvents: 'auto',
        }}
      />
      {showHeaderActions && (
        <>
          <MenuButton
            icon={Ico.schedule(14)}
            label="Schedule"
            hint="WIP"
            onClick={() => { onSchedule?.(); onClose?.(); }}
          />
          <MenuButton
            icon={Ico.brain(14)}
            label="Turn into skill"
            onClick={() => { onTurnIntoSkill?.(); onClose?.(); }}
          />
          <MenuDivider />
        </>
      )}

      {!hideMoveToProject && (
        <>
          <div
            ref={moveItemRef}
            onMouseEnter={handleMoveHover}
            onMouseLeave={scheduleSubmenuClose}
            style={{ position: 'relative' }}
          >
            <MenuButton
              icon={Ico.moveTo(14)}
              label="Move to project"
              hasSubmenu
              onClick={handleMoveHover}
            />
          </div>
          {moveOpen && submenuPos && (
            <div
              ref={submenuRef}
              onMouseEnter={() => { cancelSubmenuTimer(); cancelCloseTimer(); }}
              onMouseLeave={() => { scheduleSubmenuClose(); scheduleClose(); }}
              style={{
                position: 'fixed',
                top: submenuPos.top, left: submenuPos.left,
                zIndex: 61,
                width: 200,
                maxHeight: 280, overflowY: 'auto',
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 10,
                boxShadow: '0 12px 32px rgba(15,16,17,0.18)',
                padding: '4px 0',
              }}
            >
              {(() => {
                const candidates = projects.filter((p) =>
                  p.name !== task?.projectName && p.path !== task?.projectPath
                );
                if (candidates.length === 0) {
                  return (
                    <div style={{ padding: '10px 14px', fontSize: 12.5, color: 'var(--ink-4)', fontFamily: 'var(--font-body)' }}>
                      {projects.length === 0
                        ? 'No projects available — Anton is still loading them.'
                        : 'Create another project first to move this task.'}
                    </div>
                  );
                }
                return candidates.map((p) => (
                  <MenuButton
                    key={p.name}
                    label={p.name}
                    onClick={() => {
                      onMoveToProject?.(p);
                      onClose?.();
                    }}
                  />
                ));
              })()}
            </div>
          )}

          <MenuDivider />
        </>
      )}

      {(onPin || onUnpin) && (
        <MenuButton
          icon={Ico.pin(14)}
          label={task?.pinned ? 'Unpin' : 'Pin'}
          onClick={() => { (task?.pinned ? onUnpin : onPin)?.(); onClose?.(); }}
        />
      )}
      {!hideRename && (
        <MenuButton
          icon={Ico.edit(14)}
          label="Rename"
          onClick={() => { onRename?.(); onClose?.(); }}
        />
      )}

      {(!hideMoveToProject || !hideRename || onPin || onUnpin) && <MenuDivider />}

      <MenuButton
        icon={Ico.trash(14)}
        label="Delete"
        danger
        onClick={() => { onDelete?.(); onClose?.(); }}
      />
    </div>
  );
}
