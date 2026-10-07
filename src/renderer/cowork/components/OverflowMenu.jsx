import Ico from './Icons';
import { cn } from '../lib/cn';
import { Button, Menu } from './ui';

export function OverflowMenu({
  items = [],
  icon = Ico.moreVert(14),
  label = 'More actions',
  title = label,
  width = 200,
  align = 'end',
  side = 'bottom',
  sideOffset = 6,
  open,
  onOpenChange,
  disabled = false,
  size = 'xxs',
  triggerClassName,
  triggerStyle,
  stopPropagation = true,
  onTriggerClick,
  onTriggerKeyDown,
  ...menuProps
}) {
  // A ghost icon Button, sized by `size` (callers' `triggerClassName` keeps
  // layout such as position and reveal-on-hover). `title` becomes a Tooltip
  // that Menu composes onto its own trigger.
  const trigger = (
    <Button
      icon
      size={size}
      variant="subtle"
      aria-label={label}
      disabled={disabled}
      // Stay focusable while disabled (aria-disabled): a caller that disables
      // the trigger while its action runs would otherwise drop the focus the
      // menu hands back on close.
      focusableWhenDisabled
      // A caller that stretches the trigger over a slot (`absolute inset-0`,
      // as ContextCard's row kebab does) keeps the icon where it asked for
      // it: auto margins place the fixed-size button inside the inset box.
      className={cn('[&.inset-0]:my-auto [&.inset-0.justify-end]:ml-auto', triggerClassName)}
      style={triggerStyle}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onTriggerClick?.(e);
      }}
      onKeyDown={(e) => {
        if (stopPropagation) e.stopPropagation();
        onTriggerKeyDown?.(e);
      }}
      // Base UI's disabled branch returns before the handlers above run, and
      // an aria-disabled button still dispatches clicks and keys, so they'd
      // reach a clickable row and activate it. Stop them on the way down.
      onClickCapture={disabled && stopPropagation ? (e) => e.stopPropagation() : undefined}
      onKeyDownCapture={disabled && stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {icon}
    </Button>
  );

  return (
    <Menu
      {...menuProps}
      trigger={trigger}
      items={items}
      ariaLabel={menuProps.ariaLabel || label}
      tooltip={title}
      width={width}
      align={align}
      side={side}
      sideOffset={sideOffset}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

export default OverflowMenu;
