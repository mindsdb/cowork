// `<ToastProvider>` + `<Toast>` — the app's one transient-notification
// system, built on Base UI's Toast (@base-ui/react/toast).
//
// Why a library here: the app had three independent toast-shaped things —
// this component (single-message only, always auto-dismissing), and a
// hand-rolled multi-item stack in App.jsx for OAuth refresh errors (which
// needed simultaneous, independently-dismissible, non-auto-dismissing
// notifications — capabilities this component didn't have). Base UI's
// Toast is built around exactly that: a Provider + `useToastManager()`
// hook that manages a real queue (add/close/update/promise, per-toast
// `timeout` including `0` for "stays until dismissed", upsert-by-id).
// We only own the skin.
//
// Mount ONCE near the app root:
//   <ToastProvider>
//     <App />
//   </ToastProvider>
// Then, from any descendant:
//   const toastManager = useToastManager();
//   toastManager.add({ title: 'Saved.', type: 'success' });
//   toastManager.add({ id: 'oauth-x', title: '…', type: 'danger', timeout: 0 });
//   toastManager.update('oauth-x', { title: 'Reconnected.', type: 'success', timeout: 5000 });
//
// type: 'success' | 'danger' | 'warning' | undefined (neutral).

// NOTE: @base-ui/react/toast only exports the `Toast` namespace at
// runtime (`export * as Toast from ...`) — `useToastManager` is a member
// of that namespace, not a separate top-level export, even though its
// .d.ts is listed alongside the others (`export type *` is type-only).
import { Toast as BaseToast } from '@base-ui/react/toast';
import { cn } from '../../lib/cn';

export const useToastManager = BaseToast.useToastManager;

const CHECK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const WARNING_TRIANGLE = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3.5 22 20H2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 9.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="17.2" r="1" fill="currentColor" />
  </svg>
);

const ALERT_CIRCLE = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M12 7.5v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="16.5" r="1" fill="currentColor" />
  </svg>
);

const CLOSE_X = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const TYPE_ICON = { success: CHECK, warning: WARNING_TRIANGLE, danger: ALERT_CIRCLE };

// Mount once, near the app root. Renders the portal + viewport that every
// `useToastManager().add(...)` call from any descendant surfaces into.
// Position: bottom-right — consolidates what were three different
// positions across the old call sites (top-center, top-right, bottom-right)
// into one, since a single global viewport can only have one placement.
// Base UI defaults to a limit of three and marks older toasts inert once the
// limit is exceeded. That is unsafe for this app because persistent OAuth
// errors share the viewport with transient notifications: a fourth toast
// could otherwise leave an OAuth error visible but without a working dismiss
// button. The pre-Base-UI stacks were unlimited, so preserve that behavior at
// the app provider while still allowing a caller to opt into a finite limit.
export function ToastProvider({ children, limit = Number.POSITIVE_INFINITY }) {
  return (
    <BaseToast.Provider limit={limit}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed bottom-5 right-5 z-[2000] flex flex-col-reverse gap-2 max-w-[420px] outline-none [WebkitAppRegion:no-drag]">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = useToastManager();
  return toasts.map((toast) => <ToastBubble key={toast.id} toast={toast} />);
}

function ToastBubble({ toast }) {
  const icon = TYPE_ICON[toast.type];
  return (
    <BaseToast.Root
      toast={toast}
      className={cn(
        'relative flex items-center gap-[10px] rounded-[10px] border px-4 py-[10px]',
        'font-body text-[13px] shadow-sh-popup bg-surface border-line text-ink',
        '[transition:opacity_180ms_ease-out,transform_180ms_ease-out]',
        'data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2',
        'data-[ending-style]:opacity-0 data-[ending-style]:duration-100',
        // Tailwind's opacity modifier (bg-x/10) only works when the color
        // is a literal value it can see at build time — danger/warning are
        // `var(--x)` references, so it silently produces no rule at all.
        // The config's dedicated -bg/-border tokens exist for exactly this
        // (already pre-mixed, no opacity modifier needed, and theme-aware
        // — unlike `success`, which is a literal hex specifically so its
        // opacity modifier *would* resolve, but at the cost of staying the
        // same color in both themes).
        'data-[type=success]:border-success-border data-[type=success]:bg-success-bg data-[type=success]:text-ink-2',
        'data-[type=warning]:border-warning-border data-[type=warning]:bg-warning-bg data-[type=warning]:text-warning',
        'data-[type=danger]:border-danger-border data-[type=danger]:bg-danger-bg data-[type=danger]:text-danger',
      )}
    >
      {icon && <span className="shrink-0 inline-flex">{icon}</span>}
      <BaseToast.Title className="flex-1 min-w-0 m-0 text-[13px] font-medium leading-snug">
        {toast.title}
      </BaseToast.Title>
      {toast.description && (
        <BaseToast.Description className="text-ink-3 text-[12px]">{toast.description}</BaseToast.Description>
      )}
      <BaseToast.Close
        aria-label="Dismiss"
        className="shrink-0 inline-flex items-center justify-center bg-transparent border-0 p-0 cursor-pointer opacity-70 hover:opacity-100"
      >
        {CLOSE_X}
      </BaseToast.Close>
    </BaseToast.Root>
  );
}

export default ToastProvider;
