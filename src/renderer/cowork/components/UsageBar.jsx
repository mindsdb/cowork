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
  // `resting` is the standing allowance figure rather than a warning, so it
  // borrows the app's own surface instead of a status colour: it is in view for
  // as long as the tokens last and must not read as something being wrong.
  resting: 'bg-surface-2 border-line text-ink-3',
  info: 'bg-info-bg border-info-border text-info-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  danger: 'bg-danger-bg border-danger-border text-danger-text',
};

// `usageKnown`: the poll has answered and usage is reachable. Only then does a
// null warning mean "healthy", which is when closed bars are forgotten.
export default function UsageBar({ warning, isBillingOwner = false, usageKnown = false, trigger = 'usage_notice' }) {
  // `dismissKey` narrows a dismissal to one step of a band the resource sits in
  // as it drains; warnings without one are dismissed by kind, as before. A
  // resting figure has no key at all: closing the only place the allowance is
  // visible is what this bar exists to stop, so it carries no close button.
  const dismissable = !!warning && !warning.resting;
  const [dismissed, dismiss] = useUsageBarDismiss(
    dismissable ? warning.dismissKey ?? warning.kind : null,
    { resetWhenClear: usageKnown },
  );
  if (!warning || dismissed) return null;
  const tone = TONE[warning.tone] || TONE.warning;
  // Separated from `usage_notice` so the standing figure can be graded as a
  // conversion surface on its own rather than inside the warning's number.
  const clickTrigger = warning.resting ? 'usage_at_rest' : trigger;
  return (
    <div
      // A resting figure gets no live region on purpose: it is present for the
      // whole month and re-reads every poll, so announcing it would interrupt
      // a screen reader with a number that has not changed meaning.
      role={warning.resting ? undefined : (warning.tone === 'info' ? 'status' : 'alert')}
      data-usage-notice={warning.kind}
      // Tall enough to show the copy, then tucked under the composer: the
      // bottom padding is what the composer's rounded top covers.
      className={`usage-bar relative w-full rounded-t-[var(--r-xl)] border border-b-0 border-solid pl-4 ${dismissable ? 'pr-9' : 'pr-4'} pt-2 pb-[22px] -mb-[14px] font-body text-[13px] leading-[1.45] ${tone}`}
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
                trackBillingOpened(clickTrigger);
                host.openExternal(usageActionUrl(a, { isBillingOwner }));
              }}
              className="border-0 bg-transparent p-0 m-0 font-body text-[13px] font-semibold underline underline-offset-2 text-[color:inherit] cursor-pointer hover:opacity-80"
            >{a.label}</button>
          ))}
        </span>
      )}
      {dismissable && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          title="Dismiss"
          className="absolute top-1 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent text-[color:inherit] opacity-70 cursor-pointer hover:opacity-100 hover:bg-[rgba(127,127,127,0.12)]"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
