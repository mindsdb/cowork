// `<Command>` — the list half of a command palette (Cmd+K search), meant to
// sit inside a `<Modal>`. Same stack as t3code's ui/command.tsx: Base UI's
// Autocomplete rendered `inline` and always `open`, so Base UI owns the
// combobox/listbox ARIA, ArrowUp/Down highlight (wrapping), hover highlight
// and Enter-to-activate, while the Modal (Base UI Dialog) owns the focus trap,
// focus restore, Esc and outside-press dismissal.
//
//   <Modal open={open} onClose={close} placement="top" ariaLabel="Search">
//     <Command items={groups} mode="none" value={q} onValueChange={setQ}>
//       <CommandInput aria-label="Search" leading={icon} trailing={closeBtn} />
//       <CommandList>{(group) => (
//         <CommandGroup key={group.key} items={group.items} label={group.label}>
//           {(item) => <CommandItem key={item.id} value={item} onClick={…}>…</CommandItem>}
//         </CommandGroup>
//       )}</CommandList>
//       <CommandFooter>…</CommandFooter>
//     </Command>
//   </Modal>
//
// `mode="none"` keeps the caller's (e.g. server-ranked) items unfiltered;
// leave the default `list` mode for client-side filtering. Row styling
// matches `Combobox` (surface-2 highlight, 11.5px ink-4 group labels).

import type { ComponentProps, ReactNode } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { cn } from '../../lib/cn';

export function Command(props: ComponentProps<typeof Autocomplete.Root>) {
  return <Autocomplete.Root inline open autoHighlight="always" keepHighlight {...props} />;
}

interface CommandInputProps extends ComponentProps<typeof Autocomplete.Input> {
  leading?: ReactNode;
  trailing?: ReactNode;
}

// The input row. Borderless input; the row's bottom hairline turns accent
// while focused (WCAG 2.4.7 cue, as the old search head had). No `autoFocus`:
// the Modal's dialog focuses it as the first tabbable element, and an
// autoFocus would land before Base UI records the opener, breaking focus
// restore on close.
export function CommandInput({ leading, trailing, className, ...rest }: CommandInputProps) {
  return (
    <div className="flex items-center gap-[10px] px-[16px] py-[12px] text-ink-3 border-solid border-line border-b border-t-0 border-x-0 focus-within:shadow-[inset_0_-1px_0_0_var(--accent)]">
      {leading}
      <Autocomplete.Input
        className={cn('flex-1 min-w-0 border-0 bg-transparent p-0 outline-none font-body text-[15px] text-ink placeholder:text-ink-4', className)}
        {...rest}
      />
      {trailing}
    </div>
  );
}

export function CommandList({ className, ...rest }: ComponentProps<typeof Autocomplete.List>) {
  return (
    <Autocomplete.List
      className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-py-[8px] p-[6px] outline-none empty:hidden', className)}
      {...rest}
    />
  );
}

interface CommandGroupProps extends Omit<ComponentProps<typeof Autocomplete.Group>, 'children'> {
  label?: ReactNode;
  children: ComponentProps<typeof Autocomplete.Collection>['children'];
}

export function CommandGroup({ label, children, ...rest }: CommandGroupProps) {
  return (
    <Autocomplete.Group {...rest}>
      {label && (
        <Autocomplete.GroupLabel className="pt-[8px] px-[10px] pb-[4px] text-[11.5px] text-ink-4 select-none">
          {label}
        </Autocomplete.GroupLabel>
      )}
      <Autocomplete.Collection>{children}</Autocomplete.Collection>
    </Autocomplete.Group>
  );
}

export function CommandItem({ className, ...rest }: ComponentProps<typeof Autocomplete.Item>) {
  return (
    <Autocomplete.Item
      className={cn(
        'flex items-center gap-[10px] px-[10px] py-[8px] rounded-[8px] cursor-pointer select-none outline-none text-ink-2',
        'data-[highlighted]:bg-surface-2 data-[highlighted]:text-ink',
        className,
      )}
      {...rest}
    />
  );
}

// Plain status line (searching / no results) inside the palette body.
export function CommandStatus({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('px-[16px] py-[16px] text-[13px] text-ink-4', className)} {...rest} />;
}

// Keyboard-hint footer. Not part of the listbox, so never highlightable.
export function CommandFooter({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-[14px] px-[16px] py-[9px] text-[11.5px] text-ink-4 bg-surface-2 select-none', className)}
      {...rest}
    />
  );
}

export default Command;
