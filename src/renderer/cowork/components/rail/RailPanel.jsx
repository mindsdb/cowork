import Ico from '../Icons';
import { Tooltip } from '../ui';
import { cn } from '../../lib/cn';

// The docked right rail in chat and project detail: one card, as tall as its
// content (capped to the column), inset from the window edge.
export const RAIL_DOCKED_CLASS = cn(
  'bg-surface min-w-0 self-start max-h-[calc(100%-10px)] border border-solid border-line rounded-[12px]',
  'mr-2.5 mb-2.5 pt-4 px-5 pb-5 flex flex-col gap-6 overflow-x-hidden overflow-y-auto',
  '[-webkit-app-region:no-drag]',
);

// The titlebar toggle that opens and closes that rail, in the same spot
// whether it is open or not. `className` carries the view's hook for the
// phone-width rule that hides it.
export function RailToggle({ open, onToggle, className }) {
  const label = open ? 'Collapse panel' : 'Expand panel';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        aria-pressed={open}
        className={cn(
          'w-7 h-7 rounded-md inline-grid place-items-center shrink-0 cursor-pointer border-0',
          'text-ink-3 hover:text-ink hover:bg-surface-2 [-webkit-app-region:no-drag]',
          open ? 'bg-surface-2 text-ink' : 'bg-transparent',
          className,
        )}
      >
        {open ? Ico.panelCollapseRight(16) : Ico.panelExpandLeft(16)}
      </button>
    </Tooltip>
  );
}
