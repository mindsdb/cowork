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
// Two header styles, chosen by `variant`, so call sites don't restyle the
// trigger themselves:
//   section (default) — a form or panel section a person opens deliberately:
//                       12.5px ink-2 title, 36px min height.
//   compact           — a small toggle inside a card, row or list: 11px ink-3
//                       title, 26px min height.
// `meta` puts a count or short status beside the chevron in the variant's
// muted style (tabular, mono in compact).
//
//   <Collapsible title="Included guidance" meta="2 of 3">…</Collapsible>
//   <Collapsible variant="compact" title="Checks" meta={checks.length}>…</Collapsible>
//
// The chevron and height animation are driven by Base UI's own state
// attributes (`data-panel-open` on the trigger, `data-starting/ending-style`
// on the panel) via Tailwind variants — no JS style mutation, no extra CSS.

import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

const triggerVariants = cva(
  [
    'group flex w-full cursor-pointer items-center justify-between gap-2',
    'rounded-md border-0 bg-transparent text-left',
    // Base UI marks disabled with data-disabled (it keeps the trigger
    // focusable), NOT the native `disabled` attr — so `disabled:` would
    // never match. Drive the disabled affordance off data-disabled.
    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
  ],
  {
    variants: {
      variant: {
        section: 'min-h-[36px] py-2 text-sm text-ink-2 hover:text-ink',
        compact: 'min-h-[26px] py-1 text-xs text-ink-3 hover:text-ink-2',
      },
    },
    defaultVariants: { variant: 'section' },
  }
);

const metaVariants = cva('flex-none tabular-nums text-ink-4', {
  variants: {
    variant: {
      section: 'text-xs',
      compact: 'font-mono text-2xs',
    },
  },
  defaultVariants: { variant: 'section' },
});

// Lucide directly (like Menu/Select) so the primitive stays free of the product icon set.
function Chevron() {
  return (
    <ChevronDown
      className="flex-none text-ink-4 transition-transform duration-layout group-data-[panel-open]:rotate-180"
      size={12}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
}

export interface CollapsibleProps extends VariantProps<typeof triggerVariants> {
  // Header content (left side of the trigger row).
  title: ReactNode;
  // Count or short status shown beside the chevron.
  meta?: ReactNode;
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
  meta,
  variant,
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
        className={cn(triggerVariants({ variant }), triggerClassName)}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {meta != null && meta !== '' && <span className={metaVariants({ variant })}>{meta}</span>}
        {!hideChevron && <Chevron />}
      </BaseCollapsible.Trigger>
      {/* Base UI publishes the measured height as `--collapsible-panel-height`
          and flags enter/exit with data-starting/ending-style, so height
          animates both ways; it also defers unmount until the animation ends.
          Note: `overflow-hidden` is a permanent clip box — an adopter nesting a
          non-portaled popover/tooltip inside the panel should portal it out. */}
      <BaseCollapsible.Panel
        className={cn(
          'h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-layout ease-out',
          'data-[starting-style]:h-0 data-[ending-style]:h-0',
        )}
      >
        <div className={cn('pt-1', panelClassName)}>{children}</div>
      </BaseCollapsible.Panel>
    </BaseCollapsible.Root>
  );
}

export default Collapsible;
