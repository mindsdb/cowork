// Radix-based dialog — drop-in replacement for Modal.jsx.
//
// Provides the same visual treatment (backdrop, centered panel, focus trap,
// scroll lock, Esc to close) but built on Radix Dialog for accessibility.
//
// Usage:
//   <Dialog open={open} onOpenChange={setOpen}>
//     <DialogHeader title="Confirm action" />
//     <DialogBody>Are you sure?</DialogBody>
//     <DialogFooter>
//       <DialogClose asChild><Button variant="subtle">Cancel</Button></DialogClose>
//       <Button variant="primary" onClick={save}>Save</Button>
//     </DialogFooter>
//   </Dialog>
//
// Sizes: "sm" (420px), "md" (540px, default), "lg" (720px)

import * as RadixDialog from '@radix-ui/react-dialog';
import { cn } from './cn.js';

const SIZE = {
  sm: 'max-w-[420px]',
  md: 'max-w-[540px]',
  lg: 'max-w-[720px]',
};

export function Dialog({
  open,
  onOpenChange,
  size = 'md',
  layer = 'default',
  children,
}) {
  const z = layer === 'system' ? 'z-[1200]' : 'z-[80]';

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            z,
          )}
        />
        <RadixDialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100%-32px)]',
            SIZE[size] || SIZE.md,
            'max-h-[85vh] overflow-y-auto',
            'bg-surface rounded-lg shadow-[var(--sh-3)]',
            'focus:outline-none',
            z,
          )}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function DialogHeader({ title, subtitle, onClose, className }) {
  return (
    <div className={cn('flex items-start justify-between p-5 pb-0', className)}>
      <div>
        <RadixDialog.Title className="text-lg font-semibold text-ink">
          {title}
        </RadixDialog.Title>
        {subtitle && (
          <RadixDialog.Description className="text-sm text-ink-3 mt-1">
            {subtitle}
          </RadixDialog.Description>
        )}
      </div>
      {onClose && (
        <RadixDialog.Close
          className="text-ink-4 hover:text-ink-2 transition-colors p-1 -m-1 rounded-md focus-visible:shadow-[var(--ring)] outline-none"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </RadixDialog.Close>
      )}
    </div>
  );
}

export function DialogBody({ className, children }) {
  return (
    <div className={cn('p-5 text-base text-ink-2', className)}>
      {children}
    </div>
  );
}

export function DialogFooter({ align = 'end', className, children }) {
  const alignment = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
  };
  return (
    <div className={cn('flex items-center gap-3 px-5 pb-5', alignment[align] || alignment.end, className)}>
      {children}
    </div>
  );
}

// Re-export Radix's Close for use in footers
export const DialogClose = RadixDialog.Close;

// Re-export Trigger for cases where you want a trigger button
export const DialogTrigger = RadixDialog.Trigger;

export default Dialog;
