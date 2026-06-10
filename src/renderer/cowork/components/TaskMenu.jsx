// Task action menu — used in two places:
//   1. Sidebar RecentItem / pinned items (kebab click)
//   2. Chat header (with extra Schedule + Turn into skill items)
//
// Renders a positioned popover anchored to the trigger via a portal to
// document.body. The portal is required because ancestors (e.g. the
// sidebar) may have `transform` or `will-change: transform`, which
// creates a new containing block for `position: fixed` and shifts the
// menu away from its intended position.
//
// Closes on click-outside or Escape — no hover-based auto-close.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Ico from './Icons';

function MenuButton({ icon, label, onClick, danger = false, hint, hasSubmenu = false, onMouseEnter, onMouseLeave }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        all: 'unset', boxSizing: 'border-box', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px',
        fontFamily: "'Inter', sans-serif",
        fontSize: 13,
        color: danger ? 'var(--danger)' : 'var(--ink-2)',
        borderRadius: 6,
        width: 'calc(100% - 8px)',
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

const MENU_WIDTH = 220;
const VISIBLE_GAP = 4;     // visible space between kebab and menu chrome
const VIEWPORT_PAD = 8;    // min distance from viewport edge

export function TaskMenu({
  task,
  projects = [],
  open,
  anchorRect,                 // {top, left, bottom, right} from trigger.getBoundingClientRect()
  align = 'right',
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
  hideMoveToProject = true,
  hideRename = true,
  agentLabel,
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  const wrapperRef = useRef(null);
  const popoverRef = useRef(null);
  const submenuRef = useRef(null);
  const moveItemRef = useRef(null);
  const [submenuPos, setSubmenuPos] = useState(null);

  // Safety net — cancel any lingering timer on unmount / close.
  const closeTimer = useRef(null);
  const cancelCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const submenuTimer = useRef(null);
  const cancelSubmenuTimer = () => {
    if (submenuTimer.current) {
      clearTimeout(submenuTimer.current);
      submenuTimer.current = null;
    }
  };

  // Esc + click-outside close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onMouseDown = (e) => {
      // Check against the visible popover, not the transparent corridor
      // wrapper — the wrapper covers a large invisible area and would
      // swallow clicks that visually appear "outside" the menu.
      const inMain = popoverRef.current?.contains(e.target);
      const inSub  = submenuRef.current?.contains(e.target);
      if (!inMain && !inSub) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
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

  // Position state. The wrapper covers `trigger top → menu bottom`
  // (or vice-versa when flipped) so the corridor is one continuous
  // hover region. We measure the inner popover height to decide
  // whether to flip above the trigger.
  const [layout, setLayout] = useState(() => ({
    flipped: false,
    menuTop: 0,        // y of the visible menu chrome top
    wrapperTop: 0,     // y of the transparent wrapper top
    wrapperHeight: 0,  // height of the transparent wrapper
    measured: false,
  }));

  // Stable primitive deps — derived bools that change *content* of the
  // menu (which changes its height). Keeping callbacks like `onPin` out
  // of the dep array prevents unnecessary re-measurement flicker each
  // time the parent re-renders with fresh inline arrow handlers.
  const hasPinItem = !!(onPin || onUnpin);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current || !anchorRect) {
      setLayout((l) => ({ ...l, measured: false }));
      return;
    }
    const h = popoverRef.current.offsetHeight;
    const VH = typeof window !== 'undefined' ? window.innerHeight : 800;
    const triggerH = anchorRect.height;
    const spaceBelow = VH - VIEWPORT_PAD - anchorRect.bottom;
    const flip = h + VISIBLE_GAP > spaceBelow;

    const menuTop = flip
      ? Math.max(VIEWPORT_PAD, anchorRect.top - VISIBLE_GAP - h)
      : anchorRect.bottom + VISIBLE_GAP;
    const wrapperTop = flip ? menuTop : anchorRect.top;
    const wrapperBottom = flip ? anchorRect.bottom : menuTop + h;
    const wrapperHeight = wrapperBottom - wrapperTop;

    setLayout({ flipped: flip, menuTop, wrapperTop, wrapperHeight, measured: true });
  }, [open, anchorRect, moveOpen, hasPinItem, hideMoveToProject, hideRename, showHeaderActions]);

  if (!open) return null;

  // Portal to document.body so `position: fixed` is always relative to
  // the viewport — ancestors with `transform` or `will-change: transform`
  // (e.g. the sidebar) would otherwise create a new containing block and
  // shift the menu away from the intended anchor position.
  const VW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const wantedLeft = align === 'right'
    ? (anchorRect?.right ?? 0) - MENU_WIDTH
    : (anchorRect?.left ?? 0);
  const left = Math.min(Math.max(VIEWPORT_PAD, wantedLeft), VW - MENU_WIDTH - VIEWPORT_PAD);

  const handleMoveHover = () => {
    cancelSubmenuTimer();
    if (!moveItemRef.current) return;
    const r = moveItemRef.current.getBoundingClientRect();
    setSubmenuPos({ top: r.top, left: r.right + 4 });
    setMoveOpen(true);
  };

  const scheduleSubmenuClose = () => {
    cancelSubmenuTimer();
    submenuTimer.current = setTimeout(() => setMoveOpen(false), 220);
  };

  // Inner menu offset within the wrapper. The wrapper's top sits at
  // `wrapperTop` and its bottom at `wrapperTop + wrapperHeight`. The
  // visible menu chrome sits at `menuTop`, which differs from
  // wrapperTop by `kebabHeight + VISIBLE_GAP` (normal) or by 0 (flipped).
  const menuOffsetWithinWrapper = layout.flipped ? 0 : (layout.menuTop - layout.wrapperTop);

  return createPortal(
    <div
      ref={wrapperRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        // Wrapper provides a measurement / portal container. Pointer
        // events pass through the transparent area so clicks outside
        // the visible menu reach the document and trigger close.
        position: 'fixed',
        top: layout.wrapperTop,
        left,
        width: MENU_WIDTH,
        height: Math.max(layout.wrapperHeight, 0) || undefined,
        zIndex: 60,
        WebkitAppRegion: 'no-drag',
        visibility: layout.measured ? 'visible' : 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        ref={popoverRef}
        style={{
          // Visible menu chrome — offset within the transparent wrapper.
          position: 'absolute',
          top: menuOffsetWithinWrapper,
          left: 0,
          right: 0,
          pointerEvents: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          boxShadow: '0 12px 32px rgba(15,16,17,0.18), 0 1px 0 rgba(15,16,17,0.04)',
          padding: '4px 0',
        }}
      >
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
                onMouseEnter={() => { cancelSubmenuTimer(); }}
                onMouseLeave={() => { scheduleSubmenuClose(); }}
                style={{
                  position: 'fixed',
                  top: submenuPos.top, left: submenuPos.left,
                  zIndex: 61,
                  pointerEvents: 'auto',
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
                          ? `No projects available — ${agentLabel} is still loading them.`
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

        {hasPinItem && (
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

        {(!hideMoveToProject || !hideRename || hasPinItem) && <MenuDivider />}

        <MenuButton
          icon={Ico.trash(14)}
          label="Delete"
          danger
          onClick={() => { onDelete?.(); onClose?.(); }}
        />
      </div>
    </div>,
    document.body,
  );
}
