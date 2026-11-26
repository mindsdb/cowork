import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Icon } from './ui/Icon';
import { host } from '../../platform/host';
import { trackBillingOpened } from '../lib/analytics';
import { usageActionUrl } from '../lib/usageWarnings';
import { useConsoleLink } from '../hooks/useConsoleLink';
import { billingActions } from '../lib/billingLinks';
import { useUsageBarDismiss } from '../lib/usageBarDismiss';
import { useTranslation } from '../../lib/i18n';
import { useUsageActions } from '../hooks/useUpgradeOffer';

// The usage bar above the chat input (ENG-1782): a tab tucked behind the
// composer's top edge, so it reads as part of the input rather than a system
// message in the conversation. One line of copy, inline actions that open the
// MindsHub console, and a close button. For warnings the person can still act
// on before hitting a limit; what happens DURING a task goes in the chat
// (ChatView's UsageAlertCard).
//
// Colors use the pre-mixed -bg/-border/-text tokens (see Alert.tsx for why
// `bg-warning/10` cannot work against a var() color). The dark theme's status
// -bg tokens are translucent, and the conversation scrolls behind the bar, so
// each status tone paints its tint as an image over the solid page colour.
const TONE = {
  info: 'bg-bg bg-[image:linear-gradient(var(--info-bg),var(--info-bg))] border-info-border text-info-text',
  warning: 'bg-bg bg-[image:linear-gradient(var(--warning-bg),var(--warning-bg))] border-warning-border text-warning-text',
  danger: 'bg-bg bg-[image:linear-gradient(var(--danger-bg),var(--danger-bg))] border-danger-border text-danger-text',
};

// `dismissKey` narrows a dismissal to one step of a band the resource sits in
// as it drains; everything else is dismissed by kind.
const keyOf = (d) => d.dismissKey ?? d.kind;

// `usageKnown`: the poll has answered and nothing, for any pick, is worth
// warning about. Only then is an empty bar "healthy", which is when closed
// warnings are forgotten.
export default function UsageBar({ warning, isBillingOwner = false, usageKnown = false, trigger = 'usage_notice' }) {
  const { t } = useTranslation('shell');
  const consoleLink = useConsoleLink();
  const [dismissed, dismiss] = useUsageBarDismiss({
    // Closed warnings are forgotten once the bar is empty. Not while a warning
    // is up, even one the person has closed, or "healthy" would just mean
    // "closed".
    resetWhenClear: usageKnown && !warning,
  });
  // A plan upgrade on the bar (ENG-4186) shows only where one can be bought.
  const usageActions = useUsageActions();
  const shown = warning && !dismissed.includes(keyOf(warning)) ? warning : null;

  // Announcing happens in a permanently mounted region, not through a role on
  // the bar: aria-live announces content CHANGES, so the region has to be in
  // the DOM and empty first (same rule as AskUserCard). Polite, not assertive:
  // the allowance is worth saying at the next pause, never worth cutting into
  // a sentence.
  const announce = shown ? `${shown.title}. ${shown.body}` : '';
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => { setAnnouncement(announce); }, [announce]);
  const live = <div className="sr-only" role="status" aria-live="polite">{announcement}</div>;

  if (!shown) return live;
  const tone = TONE[shown.tone] || TONE.warning;
  const actions = usageActions.visible(billingActions(shown.actions));
  return (
    <>
      {live}
      <div
        data-usage-notice={shown.kind}
        // Tall enough to show the copy, then tucked under the composer: the
        // bottom padding is what the composer's rounded top covers.
        className={`usage-bar relative w-full rounded-t-[var(--r-xl)] border border-b-0 border-solid pl-4 pr-9 pt-2 pb-[22px] -mb-[14px] font-body text-[13px] leading-[1.45] ${tone}`}
      >
        <span className="font-semibold">{shown.title}.</span>{' '}
        <span>{shown.body}</span>
        {actions.length > 0 && (
          <span className="inline-flex flex-wrap gap-x-3 ml-2">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  if (usageActions.isUpgrade(a)) {
                    usageActions.openUpgrade(a, 'usage_bar');
                    return;
                  }
                  trackBillingOpened(trigger);
                  host.openExternal(consoleLink(usageActionUrl(a, { isBillingOwner })));
                }}
                className="border-0 bg-transparent p-0 m-0 font-body text-[13px] font-semibold underline underline-offset-2 text-[color:inherit] cursor-pointer hover:opacity-80"
              >{a.label}</button>
            ))}
          </span>
        )}
        <button
          type="button"
          onClick={() => dismiss(keyOf(shown))}
          aria-label={t('ui.toast.dismiss')}
          title={t('ui.toast.dismiss')}
          className="absolute top-1 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent text-[color:inherit] opacity-70 cursor-pointer hover:opacity-100 hover:bg-[rgba(127,127,127,0.12)]"
        >
          <Icon of={X} size={14} />
        </button>
      </div>
    </>
  );
}
