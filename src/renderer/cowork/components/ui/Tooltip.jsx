// Radix tooltip — replaces native title attributes with styled, accessible tooltips.
//
// Usage:
//   <Tooltip content="Search projects">
//     <Button icon size="sm"><SearchIcon /></Button>
//   </Tooltip>
//
//   <Tooltip content="Ctrl+K" side="bottom">
//     <button>...</button>
//   </Tooltip>
//
// Wrap the app with <TooltipProvider> once (in App.jsx or root).

import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from './cn.js';

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({
  content,
  side = 'top',
  sideOffset = 6,
  delayDuration = 400,
  children,
  className,
}) {
  if (!content) return children;

  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>
        {children}
      </RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className={cn(
            'px-2.5 py-1.5 text-xs font-medium rounded-md',
            'bg-ink text-surface shadow-[var(--sh-2)]',
            'select-none z-[100]',
            'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
            'data-[side=top]:slide-in-from-bottom-1',
            'data-[side=bottom]:slide-in-from-top-1',
            'data-[side=left]:slide-in-from-right-1',
            'data-[side=right]:slide-in-from-left-1',
            className,
          )}
          side={side}
          sideOffset={sideOffset}
        >
          {content}
          <RadixTooltip.Arrow className="fill-ink" width={8} height={4} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export default Tooltip;
