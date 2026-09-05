import { Collapsible as BaseCollapsible } from '@base-ui/react/collapsible';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Keep the primitive independent of the product icon set.
function Chevron() {
  return (
    <ChevronDown
      className="flex-none text-ink-4 transition-transform duration-200 group-data-[panel-open]:rotate-180"
      size={12}
      strokeWidth={1.5}
      aria-hidden="true"
    />
  );
}

export interface CollapsibleProps {
  title: ReactNode;
  children: ReactNode;
  // Controlled open state; pair with onOpenChange.
  open?: boolean;
  // Uncontrolled initial open state.
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  hideChevron?: boolean;
  // Layout-only classes; use the component API for visual treatment.
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
          // Base UI keeps disabled triggers focusable and emits data-disabled instead of a native
          // disabled attribute.
          'text-ink-2 hover:text-ink data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1">{title}</span>
        {!hideChevron && <Chevron />}
      </BaseCollapsible.Trigger>
      {/*
 * Portal nested popovers and tooltips: overflow-hidden clips the panel throughout its height
 * animation.
 */}
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
