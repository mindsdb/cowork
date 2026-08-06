// Tabs — accessible panel-switching tab bar.
//
// Built on Base UI's Tabs for correct role="tablist"/"tab"/"tabpanel"
// semantics, roving-focus keyboard nav (arrow keys, Home/End), and
// selection state. Consolidates the 4 divergent hand-rolled tab bars found
// in the ENG-1149 audit (raw ARIA, fully inline-styled, bespoke CSS, and one
// built directly on Base UI ToggleGroup).
//
//   <Tabs defaultValue="overview">
//     <TabList>
//       <Tab value="overview">Overview</Tab>
//       <Tab value="activity">Activity</Tab>
//     </TabList>
//     <TabPanel value="overview">…</TabPanel>
//     <TabPanel value="activity">…</TabPanel>
//   </Tabs>
//
// Underline-on-active styling is driven by the tab's own `aria-selected`
// state (a stable ARIA attribute) — no JS style mutation, no extra CSS.

import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/cn';

type WithClassName<T> = Omit<T, 'className'> & { className?: string };

export type TabsProps = WithClassName<ComponentPropsWithoutRef<typeof BaseTabs.Root>>;
export function Tabs({ className, ...rest }: TabsProps) {
  return <BaseTabs.Root className={cn('w-full', className)} {...rest} />;
}

export type TabListProps = WithClassName<ComponentPropsWithoutRef<typeof BaseTabs.List>>;
export function TabList({ className, ...rest }: TabListProps) {
  return <BaseTabs.List className={cn('flex items-center gap-1 border-b border-line', className)} {...rest} />;
}

export type TabProps = WithClassName<ComponentPropsWithoutRef<typeof BaseTabs.Tab>>;
export function Tab({ className, ...rest }: TabProps) {
  return (
    <BaseTabs.Tab
      className={cn(
        // Reset the native button chrome, keep a 2px bottom border that the
        // active state colors; -mb-px overlaps the list's own bottom border.
        'relative -mb-px cursor-pointer border-0 border-b-2 border-transparent bg-transparent px-3 py-1.5',
        'text-sm text-ink-3 transition-colors hover:text-ink',
        'aria-[selected=true]:border-accent aria-[selected=true]:text-ink',
        // Base UI keeps a disabled tab focusable, so it emits data-disabled
        // (not the native `disabled` attr); `disabled:` would never match.
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
      {...rest}
    />
  );
}

export type TabPanelProps = WithClassName<ComponentPropsWithoutRef<typeof BaseTabs.Panel>>;
export function TabPanel({ className, ...rest }: TabPanelProps) {
  return <BaseTabs.Panel className={cn('pt-3 outline-none', className)} {...rest} />;
}

export default Tabs;
