import { ExternalLink, RefreshCw } from 'lucide-react';
import { Badge, Button, Meter } from '../../components/ui';
import { host } from '../../../platform/host';
import { useAccountUser } from '../../hooks/useAccountUser';
import { useHubUsageContext } from '../../lib/hubUsageContext';
import { trackBillingOpened } from '../../lib/analytics';
import {
  USAGE_ACTIONS,
  usageActionUrl,
  formatTokensShort,
  formatUsd,
  formatResetDate,
} from '../../lib/usageWarnings';
import { SettingsSectionPanel } from './settingsLayout';

// Settings → Usage (ENG-1782). The lightweight view of what the console's
// billing page shows: free monthly Air tokens with their reset date, the paid
// balance with this period's credit spend, and auto top up when it matters. No
// per-model breakdown. Every action opens the MindsHub console, where funds and
// auto top up are actually managed.

const CARD = 'border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] px-[18px] py-4';

function openConsole(action, isBillingOwner) {
  trackBillingOpened('usage_settings');
  host.openExternal(usageActionUrl(action, { isBillingOwner }));
}

function ActionButton({ action, isBillingOwner, variant = 'default' }) {
  return (
    <Button variant={variant} size="sm" onClick={() => openConsole(action, isBillingOwner)}>
      {action.label}
      <ExternalLink size={12} strokeWidth={1.5} aria-hidden="true" />
    </Button>
  );
}

// -1 is auth's "uncapped" sentinel. 0 or a missing limit is not a plan we
// can describe, so show nothing rather than a wrong number.
const describableGrant = (free) => !!free && (free.limit === -1 || free.limit > 0);

function FreeTokensCard({ free, isBillingOwner }) {
  if (!describableGrant(free)) return null;
  const unlimited = free.limit === -1;
  const used = Math.max(0, free.used || 0);
  const remaining = Math.max(0, free.remaining || 0);
  const fraction = unlimited ? 0 : used / free.limit;
  const exhausted = !unlimited && remaining <= 0;
  const low = !unlimited && !exhausted && remaining / free.limit <= 0.2;
  const reset = formatResetDate(free.resetsAt);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-ink">Free monthly tokens</div>
          <Badge variant="muted" size="xs">MindsHub Air only</Badge>
        </div>
        {reset && <div className="text-[12px] text-ink-3">Resets {reset}</div>}
      </div>
      {unlimited ? (
        <div className="text-[13px] text-ink-2">Unlimited on this account.</div>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[13px] text-ink-2 tabular-nums">
              <span className="text-[20px] font-semibold text-ink">{formatTokensShort(used)}</span>
              {' '}/ {formatTokensShort(free.limit)} tokens used
            </div>
            <div className="text-[13px] text-ink-3 tabular-nums">{Math.floor(fraction * 100)}%</div>
          </div>
          <Meter value={fraction} tone={exhausted ? 'danger' : low ? 'warning' : 'accent'} label="Free monthly tokens used" />
          <div className="text-[12px] text-ink-3 mt-2">
            {exhausted
              ? `Used up. MindsHub Air is billing your balance${reset ? ` until ${reset}` : ' until they reset'}.`
              : `${formatTokensShort(remaining)} left. After that, MindsHub Air uses your balance${reset ? ` until ${reset}` : ''}.`}
          </div>
        </>
      )}
      <div className="flex gap-2 mt-3">
        <ActionButton action={USAGE_ACTIONS.viewUsage} isBillingOwner={isBillingOwner} />
      </div>
    </div>
  );
}

function autoTopUpLine(auto) {
  if (!auto?.enabled) return { text: 'Auto top up is off. Turn it on so tasks keep running when your balance gets low.', tone: 'text-ink-3' };
  const target = auto.rechargeToUsd != null ? formatUsd(auto.rechargeToUsd) : null;
  const floor = auto.thresholdUsd != null ? formatUsd(auto.thresholdUsd) : null;
  const rule = target && floor ? `Tops up to ${target} when your balance drops below ${floor}.` : 'On.';
  switch (auto.status) {
    case 'payment_failed':
      return { text: "Auto top up failed: we couldn't charge your card. Update your payment method to resume it.", tone: 'text-danger-text' };
    case 'cap_reached':
      return { text: `${rule} Paused for now: this month's cap is reached.`, tone: 'text-warning-text' };
    case 'pending_action':
      return { text: `${rule} Waiting on your bank to confirm the latest charge.`, tone: 'text-warning-text' };
    default:
      return { text: rule, tone: 'text-ink-3' };
  }
}

function periodLabel(spend) {
  const fmt = (iso) => formatResetDate(iso);
  const a = fmt(spend?.periodStart);
  const b = fmt(spend?.periodEnd);
  if (a && b) return `${a} to ${b}`;
  return a || b || 'this period';
}

function BalanceCard({ balance, auto, spend, isBillingOwner }) {
  if (!balance) return null;
  const empty = balance.alert === 'depleted' || balance.canConsume === false;
  const low = !empty && balance.alert === 'low';
  const amountTone = empty ? 'text-danger-text' : low ? 'text-warning-text' : 'text-ink';
  const autoLine = autoTopUpLine(auto);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-base font-semibold text-ink">Balance</div>
        {auto?.enabled && auto.status === 'ok' && <Badge variant="success" size="xs" dot>Auto top up on</Badge>}
        {auto?.enabled && auto.status === 'payment_failed' && <Badge variant="danger" size="xs" dot>Auto top up failed</Badge>}
        {auto?.enabled && (auto.status === 'cap_reached' || auto.status === 'pending_action') && <Badge variant="warning" size="xs" dot>Auto top up paused</Badge>}
      </div>
      <div className={`text-[26px] font-semibold tabular-nums leading-tight ${amountTone}`}>{formatUsd(balance.usd)}</div>
      <div className="text-[12px] text-ink-3 mt-1">
        {empty
          ? "Empty. Paid models won't run until you add funds."
          : low
            ? 'Running low. Add funds or turn on auto top up to keep tasks running.'
            : 'Used by paid models, and by MindsHub Air once the free tokens run out.'}
      </div>
      {spend && (
        <div className="flex items-baseline gap-2 mt-3 text-[13px] text-ink-2 tabular-nums">
          <span className="font-semibold text-ink">{formatUsd(spend.usd)}</span>
          <span>credit spent {periodLabel(spend)}</span>
        </div>
      )}
      <div className={`text-[12px] mt-3 ${autoLine.tone}`}>{autoLine.text}</div>
      {!isBillingOwner && (
        <div className="text-[12px] text-ink-3 mt-2">Only your organization's billing owner can add funds or change auto top up.</div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <ActionButton action={USAGE_ACTIONS.addFunds} isBillingOwner={isBillingOwner} variant="primary" />
        {auto?.status === 'payment_failed'
          ? <ActionButton action={USAGE_ACTIONS.updatePaymentMethod} isBillingOwner={isBillingOwner} />
          : <ActionButton action={auto?.enabled ? USAGE_ACTIONS.manageAutoTopUp : USAGE_ACTIONS.setUpAutoTopUp} isBillingOwner={isBillingOwner} />}
      </div>
    </div>
  );
}

export default function UsageSection({ isSsoConnected = false, onOpenAccount }) {
  const accountUser = useAccountUser(isSsoConnected);
  const ctx = useHubUsageContext();
  const usage = ctx?.usage;

  let body;
  if (!accountUser) {
    body = (
      <div className={`${CARD} flex flex-col items-start gap-3`}>
        <div className="text-base font-semibold text-ink">Sign in to see your usage</div>
        <div className="text-[13px] text-ink-3">Free monthly tokens and your balance show up here once you're signed in to MindsHub.</div>
        {onOpenAccount && <Button variant="primary" size="sm" onClick={onOpenAccount}>Go to Account</Button>}
      </div>
    );
  } else if (usage === null || usage === undefined) {
    // First read still in flight. Not an error, and not a place for numbers.
    body = (
      <div className={`${CARD} text-[13px] text-ink-3`} role="status">Loading usage…</div>
    );
  } else if (!usage.reachable) {
    body = (
      <div className={`${CARD} flex flex-col items-start gap-3`}>
        <div className="text-base font-semibold text-ink">Couldn't load usage</div>
        <div className="text-[13px] text-ink-3">MindsHub didn't answer. Try again, or check your usage in the console.</div>
        <div className="flex gap-2">
          {ctx?.refresh && (
            <Button variant="default" size="sm" onClick={() => ctx.refresh()}>
              <RefreshCw size={12} strokeWidth={1.5} aria-hidden="true" />
              Try again
            </Button>
          )}
          <ActionButton action={USAGE_ACTIONS.viewUsage} isBillingOwner={false} />
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <FreeTokensCard free={usage.freeTokens} isBillingOwner={usage.isBillingOwner} />
        <BalanceCard balance={usage.balance} auto={usage.autoTopUp} spend={usage.creditSpend} isBillingOwner={usage.isBillingOwner} />
        {!describableGrant(usage.freeTokens) && !usage.balance && (
          <div className={`${CARD} text-[13px] text-ink-3`}>No usage to show for this account yet.</div>
        )}
      </>
    );
  }

  return <SettingsSectionPanel>{body}</SettingsSectionPanel>;
}
