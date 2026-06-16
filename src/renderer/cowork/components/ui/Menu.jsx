// `<Menu>` — token-skinned dropdown menu built on Base UI.
//
// Why a library here: the hand-rolled menus (TaskMenu, the ArtifactViewer
// kebab popover, HoverMenu) each re-implemented the same hard parts —
// portal positioning, flip-on-collision, Escape, click-outside, focus
// return, plus a fragile hover-corridor submenu — and none of them had
// real keyboard support (arrow keys, typeahead, focus loop). That
// behavior is exactly what an unstyled primitive layer is for. Base UI
// gives us all of it; we own only the skin, wired to the same CSS
// variables (`--surface`, `--ink-2`, `--line`, `--danger`) the rest of
// the app uses — so it's visually identical to the menus it replaces,
// with no new styling philosophy.
//
// Two mounting modes:
//
//   1. Trigger mode — pass a `trigger` element; Base UI owns open state
//      and anchors the popup to the trigger.
//        <Menu trigger={<button>⋯</button>} items={…} />
//
//   2. Anchored mode — the call site owns the trigger AND the open state,
//      and hands us a rect to position against (the pattern the legacy
//      TaskMenu / HoverMenu used, so those wrappers port with no call-site
//      churn). Drive it with `open` + `anchor` (a DOMRect or any
//      `{ getBoundingClientRect }`) + `onClose`.
//        <Menu open={open} anchor={rect} onClose={close} items={…} />
//
// Item shape — matches the legacy hand-rolled menus so call sites port
// 1:1: { icon?, label, onClick?, danger?, disabled?, hint?, title?,
//        divider?|separator?, submenu?: Item[], id?|key? }.
// An item with a `submenu` array renders a nested fly-out (replaces
// TaskMenu's hand-rolled "Move to project" corridor).

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Menu as BaseMenu } from '@base-ui/react/menu';

// Scoped stylesheet, injected once — mirrors Modal.jsx's keyframe
// pattern. Inline styles can't express `[data-highlighted]` /
// `[data-disabled]`, and those attributes are how Base UI signals both
// pointer hover AND keyboard navigation, so the highlight has to live in
// a stylesheet to cover both. Everything resolves to the same design
// tokens the inline-styled surfaces use.
let _MENU_CSS_INJECTED = false;
function _ensureMenuCss() {
  if (_MENU_CSS_INJECTED) return;
  if (typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-cw-menu', '');
  style.textContent = `
.cw-menu {
  min-width: var(--cw-menu-w, 200px);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(15,16,17,0.28), 0 1px 0 rgba(15,16,17,0.04);
  padding: 4px 0;
  outline: none;
  font-family: var(--font-body);
  transform-origin: var(--transform-origin);
}
.cw-menu[data-open]   { animation: cw-menu-in 130ms ease-out; }
.cw-menu[data-closed] { animation: cw-menu-out 90ms ease-in; }
@keyframes cw-menu-in  { from { opacity: 0; transform: scale(0.97); } to   { opacity: 1; transform: scale(1); } }
@keyframes cw-menu-out { from { opacity: 1; transform: scale(1); }    to   { opacity: 0; transform: scale(0.97); } }
.cw-menu-item {
  display: flex; align-items: center; gap: 10px;
  width: calc(100% - 8px); margin: 0 4px;
  padding: 8px 10px; border-radius: 5px;
  font-size: 13px; color: var(--ink-2);
  cursor: pointer; user-select: none; outline: none;
  box-sizing: border-box;
}
.cw-menu-item[data-highlighted]        { background: var(--surface-2); }
.cw-menu-item[data-disabled]           { opacity: 0.55; cursor: not-allowed; }
.cw-menu-item.danger                   { color: var(--danger); }
.cw-menu-item.danger[data-highlighted] { background: color-mix(in srgb, var(--danger) 12%, transparent); }
.cw-menu-item-ico        { display: inline-flex; flex-shrink: 0; color: var(--ink-3); }
.cw-menu-item.danger .cw-menu-item-ico { color: var(--danger); }
.cw-menu-item-label      { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cw-menu-item-hint       { font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-4); }
.cw-menu-item-chev       { display: inline-flex; flex-shrink: 0; color: var(--ink-4); }
.cw-menu-sep             { height: 1px; background: var(--line); margin: 4px 0; }
/* Keep the trigger in its active state while the menu is open. The
   !important beats the trigger's own inline background, which an
   onMouseOut handler would otherwise reset the moment the pointer
   leaves to travel into the menu. */
.cw-menu-trigger[data-popup-open] { background: var(--surface-2) !important; color: var(--ink) !important; }
`;
  document.head.appendChild(style);
  _MENU_CSS_INJECTED = true;
}

// Chevron for submenu triggers. Inlined so the primitive stays free of
// any app-icon dependency.
const CHEVRON_RIGHT = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Maps the item array to Base UI nodes. Recursive so `submenu` items
// nest cleanly. `z` rises by one per level so deeper fly-outs always
// stack above their parent popup. `onActivate` fires after a leaf
// item's own onClick — anchored mode passes its `onClose` here so a
// pick reliably dismisses even though Base UI isn't driving the close.
function renderItems(items, z, onActivate) {
  return items.filter(Boolean).map((it, i) => {
    const key = it.id || it.key || it.label || i;

    if (it.divider || it.separator) {
      return <BaseMenu.Separator key={`sep-${key}-${i}`} className="cw-menu-sep" />;
    }

    if (Array.isArray(it.submenu)) {
      return (
        <BaseMenu.SubmenuRoot key={key}>
          <BaseMenu.SubmenuTrigger
            className={`cw-menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
          >
            {it.icon && <span className="cw-menu-item-ico">{it.icon}</span>}
            <span className="cw-menu-item-label">{it.label}</span>
            <span className="cw-menu-item-chev">{CHEVRON_RIGHT}</span>
          </BaseMenu.SubmenuTrigger>
          <BaseMenu.Portal>
            <BaseMenu.Positioner side="right" align="start" sideOffset={4} style={{ zIndex: z + 1 }}>
              <BaseMenu.Popup className="cw-menu">
                {renderItems(it.submenu, z + 1, onActivate)}
              </BaseMenu.Popup>
            </BaseMenu.Positioner>
          </BaseMenu.Portal>
        </BaseMenu.SubmenuRoot>
      );
    }

    return (
      <BaseMenu.Item
        key={key}
        className={`cw-menu-item${it.danger ? ' danger' : ''}`}
        disabled={it.disabled}
        title={it.title}
        onClick={() => { it.onClick?.(); onActivate?.(); }}
      >
        {it.icon && <span className="cw-menu-item-ico">{it.icon}</span>}
        <span className="cw-menu-item-label">{it.label}</span>
        {it.hint && <span className="cw-menu-item-hint">{it.hint}</span>}
      </BaseMenu.Item>
    );
  });
}

export function Menu({
  // Trigger mode: a React element Base UI composes onto (merges
  // onClick/aria/ref). Omit for anchored mode.
  trigger,
  // Anchored mode: a DOMRect or any `{ getBoundingClientRect }` /
  // element to position against. Used with `open` + `onClose`.
  anchor,
  items = [],
  // Positioning — Base UI handles collision flipping/shifting itself.
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
  // Min width of the popup (px). Items can still push it wider.
  width = 200,
  // z-index of the positioner. Default sits above default-layer modals
  // (Modal.jsx `default` layer is 80) so a kebab inside a modal stacks
  // over the modal chrome. Bump for menus inside system-layer modals.
  zIndex = 95,
  ariaLabel,
  // Controlled open state. Pass for anchored mode (the call site owns
  // the trigger); omit for the common uncontrolled trigger case.
  open,
  onOpenChange,
  // Convenience for anchored callers: fired whenever Base UI requests a
  // close (Escape, outside-click, item activation).
  onClose,
}) {
  useEffect(() => { _ensureMenuCss(); }, []);

  const controlled = open !== undefined;

  // Anchored mode = controlled open against a trigger we don't own (the
  // legacy TaskMenu / HoverMenu pattern). Base UI's Menu only wires
  // dismiss when it owns a <Menu.Trigger>; with none it opens/positions
  // fine but never closes itself, so we supply dismiss here — and ONLY
  // here (overlay + Escape + item activation). Trigger mode is left to
  // Base UI (the ArtifactViewer kebab).
  const anchoredMode = controlled && !trigger;

  const rootProps = controlled
    ? {
        open,
        onOpenChange: (next, details) => {
          onOpenChange?.(next, details);
          // Critical: do NOT close an anchored menu on Base UI's own
          // signal. With no trigger, Base UI's focus/hover-out heuristics
          // misfire and emit onOpenChange(false) when the pointer merely
          // leaves the popup — which would slam the menu shut on hover.
          // Our explicit handlers are the only closers in anchored mode.
          if (!next && !anchoredMode) onClose?.();
        },
      }
    : {};

  // Normalise the anchor into a virtual element Base UI/Floating UI
  // accepts. A raw DOMRect has no `getBoundingClientRect`, so wrap it;
  // an element or existing virtual element passes through untouched.
  const anchorEl = useMemo(() => {
    if (!anchor) return undefined;
    if (typeof anchor.getBoundingClientRect === 'function') return anchor;
    return { getBoundingClientRect: () => anchor };
  }, [anchor]);

  // Escape closes. Keyboard events fire regardless of drag regions, so a
  // listener is fine here (unlike mouse events — see the overlay below).
  useEffect(() => {
    if (!anchoredMode || !open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [anchoredMode, open, onClose]);

  return (
    <>
      {/* Outside-press dismiss for anchored mode. We can't use a document
          mousedown listener: the whole window is `-webkit-app-region:
          drag` (App.jsx), and Electron swallows mouse events over drag
          regions — so clicking the empty canvas would never reach a
          listener. A transparent `no-drag` layer painted just under the
          popup DOES receive those presses, so it dismisses on a click
          anywhere outside the popup — including drag regions and the
          trigger itself. Because the press lands on this layer (not the
          trigger), the trigger's own onClick never fires, so re-clicking
          it can't flicker the menu back open. */}
      {anchoredMode && open && createPortal(
        <div
          onMouseDown={() => onClose?.()}
          style={{
            position: 'fixed', inset: 0,
            zIndex: zIndex - 1,
            background: 'transparent',
            WebkitAppRegion: 'no-drag',
          }}
        />,
        document.body,
      )}
      <BaseMenu.Root {...rootProps}>
        {trigger && <BaseMenu.Trigger className="cw-menu-trigger" render={trigger} />}
        <BaseMenu.Portal>
          <BaseMenu.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            anchor={anchorEl}
            style={{ zIndex }}
          >
            <BaseMenu.Popup
              className="cw-menu"
              aria-label={ariaLabel}
              style={{ '--cw-menu-w': `${width}px` }}
            >
              {renderItems(items, zIndex, anchoredMode ? onClose : undefined)}
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>
    </>
  );
}

export default Menu;
