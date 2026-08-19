// `<Menu>` — token-skinned dropdown menu built on Base UI.
//
// Why a library here: the hand-rolled menus (TaskMenu, the ArtifactViewer
// kebab popover, HoverMenu) each re-implemented the same hard parts —
// portal positioning, flip-on-collision, Escape, click-outside, focus
// return, plus a fragile hover-corridor submenu — and none of them had
// real keyboard support (arrow keys, typeahead, focus loop). That
// behavior is exactly what an unstyled primitive layer is for. Base UI
// gives us all of it; we own only the skin, wired to the same design
// tokens (`bg-surface`, `text-ink-2`, `border-line`, `text-danger`) the
// rest of the app uses — so it's visually identical to the menus it
// replaces, with no new styling philosophy.
//
// Styled with `cva` + `cn()` + Tailwind's `data-[]:` arbitrary variants —
// the pattern `Switch.tsx`/`Checkbox.tsx`/`Select.jsx` use to skin Base
// UI's data-attribute-driven states (highlighted, disabled, open/closed).
// Not a runtime-injected stylesheet: every class here is real source
// text Tailwind's own pipeline sees and processes.
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
//        divider?|separator?, submenu?: Item[], heading?, id?|key? }.
// An item with a `submenu` array renders a nested fly-out (replaces
// TaskMenu's hand-rolled "Move to project" corridor).
// An item with a `heading` node renders as a non-interactive group label
// (Base UI Group + GroupLabel — announced by screen readers, skipped by
// arrow-key navigation). Used for identity headers like the user menu's
// email/org block.

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ChevronRight } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// Popup shell — background/radius/shadow + the open/close fade+scale.
// Borderless and token-shadowed per ENG-790; this keeps that visual
// treatment while replacing the runtime-injected CSS mechanism.
const MENU_POPUP_CLASSES = cn(
  'min-w-[var(--cw-menu-w,_200px)] bg-surface rounded-[10px] shadow-sh-popup',
  'py-[4px] outline-none font-body [transform-origin:var(--transform-origin)]',
  'data-[open]:animate-scale-in data-[closed]:animate-scale-out',
);

const itemVariants = cva(
  [
    'flex items-center gap-[10px]',
    'w-[calc(100%-8px)] mx-[4px] px-[10px] py-[8px] rounded-[5px]',
    'text-[13px] cursor-pointer select-none outline-none box-border',
    'data-[disabled]:opacity-55 data-[disabled]:cursor-not-allowed',
  ],
  {
    variants: {
      danger: {
        // Two full utilities per branch (not a base + override) so only
        // one `data-[highlighted]:bg-*` utility is ever present on a
        // given item — Tailwind utilities are equal-specificity, so a
        // "base rule + more-specific override" (the old CSS's
        // `.danger[data-highlighted]` beating `[data-highlighted]`)
        // doesn't reliably translate; picking one utility per branch
        // sidesteps needing that specificity order at all.
        true:  'text-danger data-[highlighted]:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]',
        false: 'text-ink-2 data-[highlighted]:bg-surface-2',
      },
    },
    defaultVariants: { danger: false },
  },
);

// Chevron for submenu triggers. Lucide directly so the primitive stays
// free of any app-icon dependency.
const CHEVRON_RIGHT = <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />;

// Maps the item array to Base UI nodes. Recursive so `submenu` items
// nest cleanly. `z` rises by one per level so deeper fly-outs always
// stack above their parent popup. `onActivate` fires after a leaf
// item's own onClick — anchored mode passes its `onClose` here so a
// pick reliably dismisses even though Base UI isn't driving the close.
function renderItems(items, z, onActivate) {
  return items.filter(Boolean).map((it, i) => {
    const key = it.id || it.key || it.label || i;

    if (it.divider || it.separator) {
      return <BaseMenu.Separator key={`sep-${key}-${i}`} className="h-px bg-line my-[4px]" />;
    }

    if (it.heading) {
      return (
        <BaseMenu.Group key={`heading-${key}-${i}`}>
          <BaseMenu.GroupLabel className="px-[14px] pt-[6px] pb-[4px] select-none cursor-default">
            {it.heading}
          </BaseMenu.GroupLabel>
        </BaseMenu.Group>
      );
    }

    if (Array.isArray(it.submenu)) {
      return (
        <BaseMenu.SubmenuRoot key={key}>
          <BaseMenu.SubmenuTrigger
            className={itemVariants({ danger: it.danger })}
            disabled={it.disabled}
          >
            {it.icon && (
              <span className={cn('inline-flex shrink-0', it.danger ? 'text-danger' : 'text-ink-3')}>{it.icon}</span>
            )}
            <span className="flex-1 min-w-0 truncate">{it.label}</span>
            <span className="inline-flex shrink-0 text-ink-4">{CHEVRON_RIGHT}</span>
          </BaseMenu.SubmenuTrigger>
          <BaseMenu.Portal>
            <BaseMenu.Positioner side="right" align="start" sideOffset={4} style={{ zIndex: z + 1 }}>
              <BaseMenu.Popup className={MENU_POPUP_CLASSES}>
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
        className={itemVariants({ danger: it.danger })}
        disabled={it.disabled}
        title={it.title}
        onClick={() => { it.onClick?.(); onActivate?.(); }}
      >
        {it.icon && (
          <span className={cn('inline-flex shrink-0', it.danger ? 'text-danger' : 'text-ink-3')}>{it.icon}</span>
        )}
        <span className="flex-1 min-w-0 truncate">{it.label}</span>
        {it.hint && <span className="font-mono text-[10.5px] text-ink-4">{it.hint}</span>}
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
        {trigger && (
          <BaseMenu.Trigger
            // !important beats the trigger's own inline background,
            // which an onMouseOut handler would otherwise reset the
            // moment the pointer leaves to travel into the menu.
            className="data-[popup-open]:!bg-surface-2 data-[popup-open]:!text-ink"
            render={trigger}
          />
        )}
        <BaseMenu.Portal>
          <BaseMenu.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            anchor={anchorEl}
            style={{ zIndex }}
          >
            <BaseMenu.Popup
              className={MENU_POPUP_CLASSES}
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
