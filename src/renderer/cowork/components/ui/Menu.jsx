// Radix-based dropdown menu — replacement for hand-rolled TaskMenu / HoverMenu.
//
// Usage:
//   <Menu>
//     <MenuTrigger asChild>
//       <Button icon size="sm" aria-label="Options"><MoreIcon /></Button>
//     </MenuTrigger>
//     <MenuContent>
//       <MenuItem onSelect={edit}>Edit</MenuItem>
//       <MenuItem onSelect={duplicate}>Duplicate</MenuItem>
//       <MenuSeparator />
//       <MenuItem variant="danger" onSelect={remove}>Delete</MenuItem>
//     </MenuContent>
//   </Menu>
//
// Submenus:
//   <MenuSub>
//     <MenuSubTrigger>Move to...</MenuSubTrigger>
//     <MenuSubContent>
//       <MenuItem onSelect={() => move('a')}>Project A</MenuItem>
//     </MenuSubContent>
//   </MenuSub>

import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import { cn } from './cn.js';

export function Menu({ children, ...props }) {
  return <RadixMenu.Root {...props}>{children}</RadixMenu.Root>;
}

export const MenuTrigger = RadixMenu.Trigger;

export function MenuContent({ className, sideOffset = 4, align = 'end', children, ...props }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        className={cn(
          'min-w-[180px] rounded-md bg-surface border border-line shadow-[var(--sh-2)] p-1 z-[90]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
          className,
        )}
        sideOffset={sideOffset}
        align={align}
        {...props}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  );
}

export function MenuItem({ variant, className, children, ...props }) {
  return (
    <RadixMenu.Item
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm rounded cursor-pointer outline-none',
        'data-[highlighted]:bg-surface-2 transition-colors',
        variant === 'danger' ? 'text-danger' : 'text-ink-2',
        'data-[disabled]:text-ink-5 data-[disabled]:pointer-events-none',
        className,
      )}
      {...props}
    >
      {children}
    </RadixMenu.Item>
  );
}

export function MenuSeparator({ className }) {
  return <RadixMenu.Separator className={cn('h-px bg-line my-1', className)} />;
}

export function MenuLabel({ className, children }) {
  return (
    <RadixMenu.Label className={cn('px-3 py-1.5 text-2xs font-semibold text-ink-4 uppercase tracking-wider', className)}>
      {children}
    </RadixMenu.Label>
  );
}

// Submenus
export function MenuSub({ children, ...props }) {
  return <RadixMenu.Sub {...props}>{children}</RadixMenu.Sub>;
}

export function MenuSubTrigger({ className, children, ...props }) {
  return (
    <RadixMenu.SubTrigger
      className={cn(
        'flex items-center justify-between gap-2 px-3 py-1.5 text-sm text-ink-2 rounded cursor-pointer outline-none',
        'data-[highlighted]:bg-surface-2 data-[state=open]:bg-surface-2 transition-colors',
        className,
      )}
      {...props}
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ink-4">
        <path d="M4.5 3l3 3-3 3" />
      </svg>
    </RadixMenu.SubTrigger>
  );
}

export function MenuSubContent({ className, children, ...props }) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.SubContent
        className={cn(
          'min-w-[160px] rounded-md bg-surface border border-line shadow-[var(--sh-2)] p-1 z-[91]',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[side=right]:slide-in-from-left-1 data-[side=left]:slide-in-from-right-1',
          className,
        )}
        sideOffset={4}
        {...props}
      >
        {children}
      </RadixMenu.SubContent>
    </RadixMenu.Portal>
  );
}

export default Menu;
