import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { host } from '../../platform/host';
import { trackBillingOpened } from '../lib/analytics';
import { usageActionUrl } from '../lib/usageWarnings';
import { useUsageBarDismiss, useStandingFigureHidden } from '../lib/usageBarDismiss';

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
  // borrows the app's own surface instead of a status colour: it stays in view
  // until closed and must not read as something being wrong.
  resting: 'bg-surface-2 border-line text-ink-3',
  info: 'bg-info-bg border-info-border text-info-text',
  warning: 'bg-warning-bg border-warning-border text-warning-text',
  danger: 'bg-danger-bg border-danger-border text-danger-text',
};

// `dismissKey` narrows a dismissal to one step of a band the resource sits in
// as it drains; everything else is dismissed by kind.
const keyOf = (d) => d.dismissKey ?? d.kind;

// `usageKnown`: the poll has answered and nothing, for any pick, is worth
// warning about. Only then does an at-rest bar mean "healthy", which is when
// closed warnings are forgotten.
export default function UsageBar({ warning, isBillingOwner = false, usageKnown = false, trigger = 'usage_notice' }) {
  const [dismissed, dismiss] = useUsageBarDismiss({
    // Closed warnings are forgotten once the bar is back at rest: the standing
    // figure or nothing at all. Not while a warning is up, even one the person
    // has closed, or "healthy" would just mean "closed".
    resetWhenClear: usageKnown && (!warning || !!warning.resting),
  });
  // The standing figure closes too (ENG-2749), on its own flag: the reset
  // above must never bring it back, and neither may the bar emptying for some
  // other reason (a BYOK provider, an uncapped grant, a top-up).
  const [figureHidden, hideFigure] = useStandingFigureHidden();
  // What the bar can show, outermost first: the warning, then what it steps
  // down to when closed (a free warning steps down to the standing figure for
  // someone with no balance to fall through to; see usageWarnings.js). The
  // first one still open is what shows.
  const closed = (d) => (d.resting ? figureHidden : dismissed.includes(keyOf(d)));
  const shown = [warning, warning?.whenDismissed].filter(Boolean).find((d) => !closed(d)) || null;

  // Announcing happens in a permanently mounted region, not through a role on
  // the bar. The standing figure can sit on screen for a whole window, so a
  // warning replacing it would only be promoting an existing node into a live
  // region, and aria-live announces content CHANGES — the region has to be in
  // the DOM and empty first (same rule as AskUserCard). Polite, not assertive:
  // the allowance is worth saying at the next pause, never worth cutting into
  // a sentence. A resting figure announces nothing at all.
  const announce = shown && !shown.resting ? `${shown.title}. ${shown.body}` : '';
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => { setAnnouncement(announce); }, [announce]);
  const live = <div className="sr-only" role="status" aria-live="polite">{announcement}</div>;

  if (!shown) return live;
  const tone = TONE[shown.tone] || TONE.warning;
  // Separated from `usage_notice` so the standing figure can be graded as a
  // conversion surface on its own rather than inside the warning's number.
  const clickTrigger = shown.resting ? 'usage_at_rest' : trigger;
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
        {shown.actions.length > 0 && (
          <span className="inline-flex flex-wrap gap-x-3 ml-2">
            {shown.actions.map((a) => (
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
        <button
          type="button"
          onClick={() => (shown.resting ? hideFigure() : dismiss(keyOf(shown)))}
          // The label names what goes, since for a free user the figure's
          // button is a permanent fixture rather than a passing warning's.
          aria-label={shown.resting ? 'Hide allowance' : 'Dismiss'}
          title={shown.resting ? 'Hide' : 'Dismiss'}
          className="absolute top-1 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-md border-0 bg-transparent text-[color:inherit] opacity-70 cursor-pointer hover:opacity-100 hover:bg-[rgba(127,127,127,0.12)]"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
