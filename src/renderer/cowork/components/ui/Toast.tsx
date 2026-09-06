// Mount ToastProvider once near the root; descendants call useToastManager().add/update/close.
// Use timeout: 0 for notifications that must remain until dismissed.

// useToastManager is a runtime member of the Toast namespace, not a top-level export.
import type { ReactNode } from 'react';
import { Toast as BaseToast } from '@base-ui/react/toast';
import { Check, TriangleAlert, CircleAlert, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export const useToastManager = BaseToast.useToastManager;

const CHECK = <Check size={14} strokeWidth={1.5} aria-hidden="true" />;
const WARNING_TRIANGLE = <TriangleAlert size={14} strokeWidth={1.5} aria-hidden="true" />;
const ALERT_CIRCLE = <CircleAlert size={14} strokeWidth={1.5} aria-hidden="true" />;
const CLOSE_X = <X size={12} strokeWidth={1.5} aria-hidden="true" />;

const TYPE_ICON: Record<string, ReactNode> = { success: CHECK, warning: WARNING_TRIANGLE, danger: ALERT_CIRCLE };

// Keep the default limit unlimited: Base UI makes excess toasts inert, which would disable
// dismissal of persistent OAuth errors when transient notifications fill the viewport.
export function ToastProvider({
  children,
  limit = Number.POSITIVE_INFINITY,
}: {
  children?: ReactNode;
  limit?: number;
}) {
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

function ToastBubble({ toast }: { toast: any }) {
  const icon = toast.type ? TYPE_ICON[toast.type] : undefined;
  return (
    <BaseToast.Root
      toast={toast}
      className={cn(
        'relative flex items-center gap-[10px] rounded-[10px] border px-4 py-[10px]',
        'font-body text-[13px] shadow-sh-popup bg-surface border-line text-ink',
        '[transition:opacity_180ms_ease-out,transform_180ms_ease-out]',
        'data-[starting-style]:opacity-0 data-[starting-style]:translate-y-2',
        'data-[ending-style]:opacity-0 data-[ending-style]:duration-100',
        // Use pre-mixed color tokens: Tailwind opacity modifiers do not resolve these CSS variable
        // colors.
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
