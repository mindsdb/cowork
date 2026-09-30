import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';

// The titlebar owns two slots that views fill without lifting their state:
//
//   • header     the active view's breadcrumbs / title and its view actions
//   • attention  app-wide attention (Code's "needs you" bell), shown in
//                every view and in either workspace
//
// A view renders <AppHeader>…</AppHeader> where its header used to be; the
// content portals into the titlebar, so it keeps the view's state, refs and
// handlers. Where no titlebar is mounted (MobileShell, isolated tests) the
// header renders inline with the padding the views used to carry.
//
// Both workspaces stay mounted while one is hidden, so the header slot is
// gated by AppHeaderScope: only the visible workspace may write into it.

interface Slots {
  header: HTMLElement | null;
  attention: HTMLElement | null;
  setHeader: (el: HTMLElement | null) => void;
  setAttention: (el: HTMLElement | null) => void;
}

const SlotContext = createContext<Slots>({ header: null, attention: null, setHeader: () => {}, setAttention: () => {} });
const ScopeContext = createContext(true);

export function AppHeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [attention, setAttention] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ header, attention, setHeader, setAttention }), [header, attention]);
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>;
}

export function useAppHeaderSlots() {
  return useContext(SlotContext);
}

export function AppHeaderScope({ active, children }: { active: boolean; children: ReactNode }) {
  return <ScopeContext.Provider value={!!active}>{children}</ScopeContext.Provider>;
}

export function AppHeader({ children, className }: { children: ReactNode; className?: string }) {
  const { header } = useContext(SlotContext);
  const active = useContext(ScopeContext);
  if (!header) {
    return (
      <header
        className={cn(
          'flex items-center justify-between gap-3 shrink-0 min-w-0 overflow-hidden',
          'py-3.5 px-7 max-sm:px-3.5',
          className,
        )}
      >
        {children}
      </header>
    );
  }
  if (!active) return null;
  return createPortal(
    <div className={cn('app-titlebar__view', className)}>{children}</div>,
    header,
  );
}

// Portals into the app-wide attention slot. `fallback` renders in place when
// there is no titlebar (MobileShell, tests), so the control is never lost.
export function AppAttention({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const { attention } = useContext(SlotContext);
  if (!attention) return <>{fallback}</>;
  return createPortal(children, attention);
}
