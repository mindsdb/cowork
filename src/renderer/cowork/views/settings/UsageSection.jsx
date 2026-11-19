import { ExternalLink, RefreshCw } from 'lucide-react';
import { Icon } from '../../components/ui/Icon';
import { Badge, Button, Meter } from '../../components/ui';
import { host } from '../../../platform/host';
import { useAccountUser } from '../../hooks/useAccountUser';
import { useHubUsageContext } from '../../lib/hubUsageContext';
import { trackBillingOpened } from '../../lib/analytics';
import {
  USAGE_ACTIONS,
  usageActionUrl,
  formatPercentShort,
  formatUsd,
  formatResetDate,
  formatResetTime,
  FREE_TOKENS_LOW_FRACTION,
  isBalanceEmpty,
} from '../../lib/usageWarnings';
import { SettingsSectionPanel } from './settingsLayout';
import { useTranslation } from '../../../lib/i18n';

/* Settings → Usage (ENG-1782). The lightweight view of what the console's
   billing page shows: the free MindsHub Air allowance with when it refills, the
   paid balance with this period's credit spend, and auto top up when it
   matters. No per-model breakdown. Every action opens the MindsHub console,
   where funds and auto top up are actually managed. */

const CARD = 'border border-solid border-line rounded-card bg-surface-glass backdrop-blur-[var(--surface-glass-blur)] mb-[14px] px-[18px] py-4';

function openConsole(action, isBillingOwner) {
  trackBillingOpened('usage_settings');
  host.openExternal(usageActionUrl(action, { isBillingOwner }));
}

// Labels come from the catalog by the action's key; the English `label` on
// USAGE_ACTIONS stays the fallback for an action this section doesn't know.
function ActionButton({ action, isBillingOwner, variant = 'default' }) {
  const { t } = useTranslation('settingsSystem');
  return (
    <Button variant={variant} size="sm" onClick={() => openConsole(action, isBillingOwner)}>
      {t(`usage.actions.${action.key}`, { defaultValue: action.label })}
      <Icon of={ExternalLink} size={12} />
    </Button>
  );
}

// -1 is auth's "uncapped" sentinel. 0 or a missing limit is not a plan we
// can describe, so show nothing rather than a wrong number.
const describableGrant = (free) => !!free && (free.limit === -1 || free.limit > 0);

// Splits a translated sentence around one styled value, so the value can sit in
// its own element without the sentence being built from fragments.
const SLOT = '\u2060SLOT\u2060';

function FreeTokensCard({ free, isBillingOwner }) {
  const { t } = useTranslation('settingsSystem');
  if (!describableGrant(free)) return null;
  const unlimited = free.limit === -1;
  const remaining = Math.max(0, free.remaining || 0);
  const fractionLeft = unlimited ? 0 : remaining / free.limit;
  const fraction = unlimited ? 0 : 1 - fractionLeft;
  const exhausted = !unlimited && remaining <= 0;
  // Same line as the composer bar, read from the one constant, so the meter's
  // warning tint and the bar cannot drift apart.
  const low = !unlimited && !exhausted && fractionLeft <= FREE_TOKENS_LOW_FRACTION;
  // A clock time, like the other two surfaces. `periodLabel` below keeps a
  // date, because a billing period is one.
  const reset = formatResetTime(free.resetsAt);
  const [usedBefore, usedAfter] = t('usage.free.used', { percent: SLOT }).split(SLOT);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="text-base font-semibold text-ink">{t('usage.free.title')}</div>
          <Badge variant="muted" size="xs">{t('usage.free.badge')}</Badge>
        </div>
        {reset && <div className="text-[12px] text-ink-3">{t('usage.free.resetsAt', { time: reset })}</div>}
      </div>
      {unlimited ? (
        <div className="text-[13px] text-ink-2">{t('usage.free.unlimited')}</div>
      ) : (
        <>
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[13px] text-ink-2 tabular-nums">
              {usedBefore}
              <span className="text-[20px] font-semibold text-ink">{formatPercentShort(fraction)}</span>
              {usedAfter}
            </div>
            <div className="text-[13px] text-ink-3 tabular-nums">{t('usage.free.left', { percent: formatPercentShort(fractionLeft) })}</div>
          </div>
          <Meter value={fraction} tone={exhausted ? 'danger' : low ? 'warning' : 'accent'} label={t('usage.free.meterLabel')} />
          <div className="text-[12px] text-ink-3 mt-2">
            {exhausted
              ? (reset ? t('usage.free.usedUpUntil', { time: reset }) : t('usage.free.usedUp'))
              : (reset ? t('usage.free.afterUntil', { time: reset }) : t('usage.free.after'))}
          </div>
        </>
      )}
      <div className="flex gap-2 mt-3">
        <ActionButton action={USAGE_ACTIONS.viewUsage} isBillingOwner={isBillingOwner} />
      </div>
    </div>
  );
}

function autoTopUpLine(t, auto) {
  if (!auto?.enabled) return { text: t('usage.autoTopUp.off'), tone: 'text-ink-3' };
  const target = auto.rechargeToUsd != null ? formatUsd(auto.rechargeToUsd) : null;
  const floor = auto.thresholdUsd != null ? formatUsd(auto.thresholdUsd) : null;
  const rule = target && floor ? t('usage.autoTopUp.rule', { target, floor }) : t('usage.autoTopUp.on');
  switch (auto.status) {
    case 'payment_failed':
      return { text: t('usage.autoTopUp.paymentFailed'), tone: 'text-danger-text' };
    case 'cap_reached':
      return { text: t('usage.autoTopUp.capReached', { rule }), tone: 'text-warning-text' };
    case 'pending_action':
      return { text: t('usage.autoTopUp.pendingAction', { rule }), tone: 'text-warning-text' };
    default:
      return { text: rule, tone: 'text-ink-3' };
  }
}

// Mirrors the usage bar's balance_low copy, so "turn on" only shows when auto top up is off.
function lowBalanceLine(t, auto) {
  if (!auto?.enabled) return t('usage.low.off');
  if (auto.status === 'ok') return t('usage.low.ok');
  if (auto.status === 'pending_action') return t('usage.low.pending');
  return t('usage.low.other');
}

function spentLabel(t, spend) {
  const fmt = (iso) => formatResetDate(iso);
  const a = fmt(spend?.periodStart);
  const b = fmt(spend?.periodEnd);
  if (a && b) return t('usage.balance.spentRange', { start: a, end: b });
  if (a || b) return t('usage.balance.spentDate', { date: a || b });
  return t('usage.balance.spentThisPeriod');
}

function BalanceCard({ balance, auto, spend, isBillingOwner }) {
  const { t } = useTranslation('settingsSystem');
  if (!balance) return null;
  const empty = isBalanceEmpty(balance);
  const low = !empty && balance.alert === 'low';
  const amountTone = empty ? 'text-danger-text' : low ? 'text-warning-text' : 'text-ink';
  const autoLine = autoTopUpLine(t, auto);
  return (
    <div className={CARD}>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-base font-semibold text-ink">{t('usage.balance.title')}</div>
        {auto?.enabled && auto.status === 'ok' && <Badge variant="success" size="xs" dot>{t('usage.autoTopUp.badgeOn')}</Badge>}
        {auto?.enabled && auto.status === 'payment_failed' && <Badge variant="danger" size="xs" dot>{t('usage.autoTopUp.badgeFailed')}</Badge>}
        {auto?.enabled && (auto.status === 'cap_reached' || auto.status === 'pending_action') && <Badge variant="warning" size="xs" dot>{t('usage.autoTopUp.badgePaused')}</Badge>}
      </div>
      <div className={`text-[26px] font-semibold tabular-nums leading-tight ${amountTone}`}>{formatUsd(balance.usd)}</div>
      <div className="text-[12px] text-ink-3 mt-1">
        {empty
          ? t('usage.balance.empty')
          : low
            ? lowBalanceLine(t, auto)
            : t('usage.balance.usedBy')}
      </div>
      {spend && (
        <div className="flex items-baseline gap-2 mt-3 text-[13px] text-ink-2 tabular-nums">
          <span className="font-semibold text-ink">{formatUsd(spend.usd)}</span>
          <span>{spentLabel(t, spend)}</span>
        </div>
      )}
      <div className={`text-[12px] mt-3 ${autoLine.tone}`}>{autoLine.text}</div>
      {!isBillingOwner && (
        <div className="text-[12px] text-ink-3 mt-2">{t('usage.balance.notOwner')}</div>
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
  const { t } = useTranslation('settingsSystem');
  const accountUser = useAccountUser(isSsoConnected);
  const ctx = useHubUsageContext();
  const usage = ctx?.usage;

  let body;
  if (!accountUser) {
    body = (
      <div className={`${CARD} flex flex-col items-start gap-3`}>
        <div className="text-base font-semibold text-ink">{t('usage.signIn.title')}</div>
        <div className="text-[13px] text-ink-3">{t('usage.signIn.body')}</div>
        {onOpenAccount && <Button variant="primary" size="sm" onClick={onOpenAccount}>{t('usage.signIn.goToAccount')}</Button>}
      </div>
    );
  } else if (usage === null || usage === undefined) {
    // First read still in flight. Not an error, and not a place for numbers.
    body = (
      <div className={`${CARD} text-[13px] text-ink-3`} role="status">{t('usage.loading')}</div>
    );
  } else if (!usage.reachable) {
    body = (
      <div className={`${CARD} flex flex-col items-start gap-3`}>
        <div className="text-base font-semibold text-ink">{t('usage.error.title')}</div>
        <div className="text-[13px] text-ink-3">{t('usage.error.body')}</div>
        <div className="flex gap-2">
          {ctx?.refresh && (
            <Button variant="default" size="sm" onClick={() => ctx.refresh()}>
              <Icon of={RefreshCw} size={12} />
              {t('usage.error.tryAgain')}
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
          <div className={`${CARD} text-[13px] text-ink-3`}>{t('usage.empty')}</div>
        )}
      </>
    );
  }

  return <SettingsSectionPanel>{body}</SettingsSectionPanel>;
}
