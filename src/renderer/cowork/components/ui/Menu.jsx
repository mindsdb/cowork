// Trigger mode: pass trigger; Base UI owns opening and positioning.
// Anchored mode: pass open, anchor (DOMRect or getBoundingClientRect), and onClose.
// Items: { icon?, label, onClick?, danger?, disabled?, hint?, title?, aria?,
// divider?|separator?, submenu?: Item[], heading?, id?|key? }.
// Use aria for accessible state; title is only a description that screen readers may omit.
// submenu creates a fly-out; heading creates a non-interactive, announced group label.

import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Menu as BaseMenu } from '@base-ui/react/menu';
import { ChevronRight } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { cn } from '../../lib/cn';

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
        // Choose one highlighted background utility per branch; equal-specificity Tailwind rules
        // cannot guarantee overrides.
        true:  'text-danger data-[highlighted]:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]',
        false: 'text-ink-2 data-[highlighted]:bg-surface-2',
      },
    },
    defaultVariants: { danger: false },
  },
);

// Keep the primitive independent of product icons.
const CHEVRON_RIGHT = <ChevronRight size={11} strokeWidth={1.5} aria-hidden="true" />;

// Increase z for nested fly-outs; invoke onActivate after leaf actions so controlled anchored menus
// close.
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
        {...it.aria}
        closeOnClick={!it.keepOpen}
        onClick={() => {
          it.onClick?.();
          if (!it.keepOpen) onActivate?.();
        }}
      >
        {it.icon && (
          <span className={cn('inline-flex shrink-0', it.danger ? 'text-danger' : 'text-ink-3')}>{it.icon}</span>
        )}
        <span className="flex-1 min-w-0 truncate">{it.label}</span>
        {it.hint && <span className="font-mono text-[12px] text-ink-3">{it.hint}</span>}
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
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
  width = 200,
  // Default stacks above content modals. Raise z for menus inside system-layer modals.
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

  // Without a Base UI trigger, anchored menus need explicit outside-press, Escape, and item
  // dismissal.
  const anchoredMode = controlled && !trigger;

  const rootProps = controlled
    ? {
        open,
        onOpenChange: (next, details) => {
          onOpenChange?.(next, details);
          // Ignore Base UI closes in anchored mode: its triggerless hover heuristics close on
          // merely leaving the popup.
          if (!next && !anchoredMode) onClose?.();
        },
      }
    : {};

  // Wrap DOMRects as virtual elements; existing elements and virtual elements pass through.
  const anchorEl = useMemo(() => {
    if (!anchor) return undefined;
    if (typeof anchor.getBoundingClientRect === 'function') return anchor;
    return { getBoundingClientRect: () => anchor };
  }, [anchor]);

  useEffect(() => {
    if (!anchoredMode || !open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [anchoredMode, open, onClose]);

  return (
    <>
      {/*
 * Electron drag regions swallow document mouse events. A no-drag overlay receives outside presses
 * and prevents the trigger from reopening the menu on the same click.
 */}
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
            // Override the trigger's inline background so its mouse-out handler cannot reset the
            // open state.
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
