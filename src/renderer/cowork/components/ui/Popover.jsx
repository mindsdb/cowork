// Radix popover — floating content anchored to a trigger.
//
// Usage:
//   <Popover>
//     <PopoverTrigger asChild>
//       <Button icon size="sm"><FilterIcon /></Button>
//     </PopoverTrigger>
//     <PopoverContent>
//       <p>Filter options here</p>
//     </PopoverContent>
//   </Popover>

import * as RadixPopover from '@radix-ui/react-popover';
import { cn } from './cn.js';

export function Popover({ children, ...props }) {
  return <RadixPopover.Root {...props}>{children}</RadixPopover.Root>;
}

export const PopoverTrigger = RadixPopover.Trigger;
export const PopoverClose = RadixPopover.Close;
export const PopoverAnchor = RadixPopover.Anchor;

export function PopoverContent({
  className,
  sideOffset = 6,
  align = 'center',
  children,
  ...props
}) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        className={cn(
          'w-auto rounded-lg bg-surface border border-line shadow-[var(--sh-2)] p-4 z-[90]',
          'outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          'data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1',
          className,
        )}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

export default Popover;
