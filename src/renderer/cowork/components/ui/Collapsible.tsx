// Collapsible (Disclosure) — a labeled header that toggles a collapsible panel.
//
// Built on Base UI's Collapsible for correct <button>/`aria-expanded`
// semantics, panel mount/unmount, and enter/exit height animation.
// Consolidates the ~6 bespoke chevron + `aria-expanded` + show/hide toggles
// across the app (ThinkingBlock, SettingsView Section, MobileShell,
// WorkingFolderLive, OnboardingChecklist, Composer) — ENG-1151.
//
//   <Collapsible title="Advanced">…</Collapsible>
//   <Collapsible title={<Eyebrow>Details</Eyebrow>} defaultOpen>…</Collapsible>
//   <Collapsible open={open} onOpenChange={setOpen} title="Controlled">…</Collapsible>
//
// The chevron and height animation are driven by Base UI's own state
// attributes (`data-panel-open` on the trigger, `data-starting/ending-style`
// on the panel) via Tailwind variants — no JS style mutation, no extra CSS.

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Inlined (like Menu/Select) so the primitive stays free of the product icon set.
function Chevron() {
  return (
    <svg
      className="flex-none text-ink-4 transition-transform duration-200 group-data-[panel-open]:rotate-180"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface CollapsibleProps {
  // Header content (left side of the trigger row).
  title: ReactNode;
  // Panel content, revealed when open.
  children: ReactNode;
  // Controlled open state; pair with onOpenChange.
  open?: boolean;
  // Uncontrolled initial open state.
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  // Hide the default chevron (e.g. when the header supplies its own affordance).
  hideChevron?: boolean;
  // Layout-only escape hatches (appended via cn) — never a style treatment.
  className?: string; // Root
  triggerClassName?: string; // header button
  panelClassName?: string; // inner content wrapper (padding/spacing)
}

export function Collapsible({
  title,
  children,
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  hideChevron = false,
  className,
  triggerClassName,
  panelClassName,
}: CollapsibleProps) {
  return (
    <BaseCollapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={disabled}
      className={cn('w-full', className)}
    >
      <BaseCollapsible.Trigger
        className={cn(
          'group flex w-full cursor-pointer items-center justify-between gap-2',
          'rounded-md border-0 bg-transparent py-1.5 text-left',
          // Base UI marks disabled with data-disabled (it keeps the trigger
          // focusable), NOT the native `disabled` attr — so `disabled:` would
          // never match. Drive the disabled affordance off data-disabled.
          'text-ink-2 hover:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {!hideChevron && <Chevron />}
      </BaseCollapsible.Trigger>
      {/* Base UI publishes the measured height as `--collapsible-panel-height`
          and flags enter/exit with data-starting/ending-style, so height
          animates both ways; it also defers unmount until the animation ends.
          Note: `overflow-hidden` is a permanent clip box — an adopter nesting a
          non-portaled popover/tooltip inside the panel should portal it out. */}
      <BaseCollapsible.Panel
        className={cn(
          'h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out',
          'data-[starting-style]:h-0 data-[ending-style]:h-0',
        )}
      >
        <div className={cn('pt-1', panelClassName)}>{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}

export default Collapsible;
