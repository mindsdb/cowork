// Radix tabs — accessible tab interface with keyboard navigation.
//
// Usage:
//   <Tabs defaultValue="general">
//     <TabsList>
//       <TabsTrigger value="general">General</TabsTrigger>
//       <TabsTrigger value="advanced">Advanced</TabsTrigger>
//     </TabsList>
//     <TabsContent value="general">General settings...</TabsContent>
//     <TabsContent value="advanced">Advanced settings...</TabsContent>
//   </Tabs>

import * as RadixTabs from '@radix-ui/react-tabs';
import { cn } from './cn.js';

export function Tabs({ className, children, ...props }) {
  return (
    <RadixTabs.Root className={cn('flex flex-col', className)} {...props}>
      {children}
    </RadixTabs.Root>
  );
}

export function TabsList({ className, children, ...props }) {
  return (
    <RadixTabs.List
      className={cn(
        'flex items-center gap-1 border-b border-line px-1',
        className,
      )}
      {...props}
    >
      {children}
    </RadixTabs.List>
  );
}

export function TabsTrigger({ className, children, ...props }) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'px-3 py-2 text-sm font-medium text-ink-3 rounded-t-md -mb-px',
        'border-b-2 border-transparent',
        'hover:text-ink-2 transition-colors',
        'data-[state=active]:text-accent data-[state=active]:border-accent',
        'focus-visible:shadow-[var(--ring)] outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </RadixTabs.Trigger>
  );
}

export function TabsContent({ className, children, ...props }) {
  return (
    <RadixTabs.Content
      className={cn('mt-4 outline-none', className)}
      {...props}
    >
      {children}
    </RadixTabs.Content>
  );
}

export default Tabs;
