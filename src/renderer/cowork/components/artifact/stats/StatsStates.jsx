// The Stats panel's loading and failure states, shared by the panel and by a
// viewer row that unfolds in place (ENG-4455).

import { Button } from '../../ui';
import i18n, { useTranslation } from '../../../../lib/i18n';

// Refusals with a known cause. Only a transient outage is worth a Retry.
const CODED_ERRORS = {
  stats_owned_by_other_account: { key: 'otherAccount', retry: false },
  stats_unavailable: { key: 'unavailable', retry: false },
  publish_credential_missing: { key: 'reconnect', retry: false },
  publish_credential_rejected: { key: 'reconnect', retry: false },
  stats_temporarily_unavailable: { key: 'temporarilyUnavailable', retry: true },
};

export function describeStatsError(error) {
  if (!error) return null;
  const coded = error.code ? CODED_ERRORS[error.code] : null;
  if (coded) return { message: i18n.t(`artifacts:stats.errors.${coded.key}`), retry: coded.retry };
  const message = error.message || i18n.t('artifacts:stats.errors.loadFailed');
  // Billing and organization refusals do not change on a retry.
  if (error.status === 402) return { message, retry: false };
  if (error.status === 403 && error.code && error.code !== 'permission_denied') {
    return { message, retry: false };
  }
  return { message, retry: true };
}

const BLOCK = 'rounded-[8px] bg-surface-2 animate-pulse motion-reduce:animate-none';

export function StatsSkeleton({ label, compact = false }) {
  const { t } = useTranslation('artifacts');
  if (compact) {
    return (
      <div role="status" aria-label={label || t('stats.loading')} className="flex flex-col gap-2">
        <div className={`h-[16px] w-2/3 ${BLOCK}`} />
        <div className={`h-[96px] ${BLOCK}`} />
      </div>
    );
  }
  return (
    <div role="status" aria-label={label || t('stats.loading')} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-[54px] ${BLOCK}`} />)}
      </div>
      <div className={`h-[120px] ${BLOCK}`} />
      <div className={`h-[22px] ${BLOCK}`} />
    </div>
  );
}

// `failure` is a described error (`{ message, retry }`).
export function StatsFailure({ failure, onRetry }) {
  const { t } = useTranslation('artifacts');
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-col items-start gap-2 rounded-[8px] bg-surface-2 px-3 py-3
        text-[12px] leading-[16px] text-ink-2"
    >
      <span>{failure.message}</span>
      {failure.retry && <Button size="sm" onClick={onRetry}>{t('stats.retry')}</Button>}
    </div>
  );
}
