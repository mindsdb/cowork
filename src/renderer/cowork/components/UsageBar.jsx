import { X } from 'lucide-react';
import { host } from '../../platform/host';
import { trackBillingOpened } from '../lib/analytics';
import { usageActionUrl } from '../lib/usageWarnings';
import { useUsageBarDismiss } from '../lib/usageBarDismiss';

// The usage bar above the chat input (ENG-1782): a tab tucked behind the
// composer's top edge, so it reads as part of the input rather than a system
// message in the conversation. One line of copy, inline actions that open the
// MindsHub console, and a close button. For warnings the person can still act
// on before hitting a limit; what happens DURING a task goes in the chat
// (ChatView's UsageAlertCard).
//
// Colors use the pre-mixed -bg/-border/-text tokens (see Alert.tsx for why
// `bg-warning/10` cannot work against a var() color).
const TONE = {
  info: 'bg-info-bg border-info-border text-info-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  danger: 'bg-danger-bg border-danger-border text-danger-text',
};

export default function UsageBar({ warning, isBillingOwner = false, trigger = 'usage_notice' }) {
  const [dismissed, dismiss] = useUsageBarDismiss(warning?.kind ?? null);
  if (!warning || dismissed) return null;
  const tone = TONE[warning.tone] || TONE.warning;
  return (
    <div
      role={warning.tone === 'info' ? 'status' : 'alert'}
      data-usage-notice={warning.kind}
      // Tall enough to show the copy, then tucked under the composer: the
      // bottom padding is what the composer's rounded top covers.
      className={`usage-bar relative w-full rounded-t-[var(--r-xl)] border border-b-0 border-solid pl-4 pr-9 pt-2 pb-[22px] -mb-[14px] font-body text-[13px] leading-[1.45] ${tone}`}
    >
      <span className="font-semibold">{warning.title}.</span>{' '}
      <span>{warning.body}</span>
      {warning.actions.length > 0 && (
        <span className="inline-flex flex-wrap gap-x-3 ml-2">
          {warning.actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => {
                trackBillingOpened(trigger);
                host.openExternal(usageActionUrl(a, { isBillingOwner }));
              }}
              className="border-0 bg-transparent p-0 m-0 font-body text-[13px] font-semibold underline underline-offset-2 text-[color:inherit] cursor-pointer hover:opacity-80"
            >{a.label}</button>
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
        className="absolute top-1 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent text-[color:inherit] opacity-70 cursor-pointer hover:opacity-100 hover:bg-[rgba(127,127,127,0.12)]"
      >
        <X size={14} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </div>
  );
}
