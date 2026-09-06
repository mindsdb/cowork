import clsx from 'clsx';
import Ico from './Icons';
import { Menu } from './ui';

export function OverflowMenu({
  items = [],
  icon = Ico.moreVert(13),
  label = 'More actions',
  title = label,
  width = 200,
  align = 'end',
  side = 'bottom',
  sideOffset = 6,
  open,
  onOpenChange,
  disabled = false,
  triggerClassName,
  triggerStyle,
  stopPropagation = true,
  onTriggerClick,
  onTriggerKeyDown,
  ...menuProps
}) {
  const trigger = (
    <button
      type="button"
      aria-label={label}
      // Keep native title until the trigger forwards its ref: wrapping it in Tooltip creates
      // competing Base UI triggers. ENG-1152.
      title={title}
      disabled={disabled}
      className={clsx(
        // Leave justify-* to callers so stretched triggers can align their icon without conflicting
        // Tailwind classes.
        'inline-flex items-center rounded border-0 bg-transparent p-0',
        'text-ink-4 hover:text-ink focus-visible:text-ink',
        'cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        triggerClassName,
      )}
      style={triggerStyle}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onTriggerClick?.(e);
      }}
      onKeyDown={(e) => {
        if (stopPropagation) e.stopPropagation();
        onTriggerKeyDown?.(e);
      }}
    >
      {icon}
    </button>
  );

  return (
    <Menu
      {...menuProps}
      trigger={trigger}
      items={items}
      ariaLabel={menuProps.ariaLabel || label}
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
