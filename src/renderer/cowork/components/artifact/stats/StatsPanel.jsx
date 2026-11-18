// Stats panel: owner-only view counts for a published artifact. It docks
// beside the stage like the comments inbox (same width, entrance and
// compact-screen takeover) and renders from props only.

import { Button, Tooltip } from '../../ui';
import { Switch } from '../../ui/Switch';
import { relativeAge } from '../../../lib/formatTime';
import { XIcon } from '../comments/icons';
import { StatsChart } from './StatsChart';
import i18n, { useTranslation } from '../../../../lib/i18n';

// Stable fallback: StatsChart rebuilds the chart whenever `daily` changes identity.
const NO_DAYS = [];

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

function exactTime(iso) {
  const ts = Date.parse(iso || '');
  return Number.isFinite(ts) ? new Date(ts).toLocaleString() : '';
}

function Metric({ label, value, hint = '' }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px] rounded-[8px] bg-surface-2 px-[10px] py-2">
      <span className="text-[11px] leading-[14px] text-ink-3">{label}</span>
      {/* Focusable when it has a hint, so the exact time is reachable from
          the keyboard too. */}
      <Tooltip content={hint}>
        <span
          tabIndex={hint ? 0 : undefined}
          className="truncate text-[18px] font-semibold leading-[24px] text-ink"
        >
          {value}
        </span>
      </Tooltip>
    </div>
  );
}

function StatsSkeleton() {
  const { t } = useTranslation('artifacts');
  const block = 'rounded-[8px] bg-surface-2 animate-pulse motion-reduce:animate-none';
  return (
    <div role="status" aria-label={t('stats.loading')} className="flex flex-col gap-2">
      <div className={`h-[22px] ${block}`} />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-[54px] ${block}`} />)}
      </div>
      <div className={`h-[120px] ${block}`} />
    </div>
  );
}

function StatsFailure({ failure, onRetry }) {
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

function ViewersTable({ viewers }) {
  const { t } = useTranslation('artifacts');
  return (
    <div className="shrink-0 overflow-x-auto">
      <table className="w-full border-collapse text-[12px] leading-[16px]">
        <thead>
          <tr className="text-left text-ink-3">
            <th scope="col" className="py-1 pr-2 font-medium">{t('stats.viewers.email')}</th>
            <th scope="col" className="whitespace-nowrap py-1 font-medium">{t('stats.viewers.lastSeen')}</th>
          </tr>
        </thead>
        <tbody>
          {viewers.map((viewer, i) => (
            <tr
              key={`${viewer.email}-${i}`}
              className="text-ink-2"
              style={{ borderTop: '1px solid var(--line)' }}
            >
              <td className="max-w-[160px] truncate py-1 pr-2" title={viewer.email}>{viewer.email}</td>
              <td className="whitespace-nowrap py-1">
                <Tooltip content={exactTime(viewer.last_seen)}>
                  <span tabIndex={viewer.last_seen ? 0 : undefined}>
                    {relativeAge(viewer.last_seen) || '—'}
                  </span>
                </Tooltip>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsContent({ data, trackingBusy, accessMode, accessLoaded, onToggleTracking }) {
  const { t } = useTranslation('artifacts');
  const viewers = Array.isArray(data.viewers) ? data.viewers : [];
  const daily = Array.isArray(data.daily) ? data.daily : NO_DAYS;
  const tracking = data.tracking === true;
  const restricted = accessMode === 'restricted';
  const hasViews = (data.total_views || 0) > 0 || (data.views_in_period || 0) > 0;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-medium leading-[18px] text-ink">{t('stats.trackViews')}</span>
          <Switch
            size="sm"
            aria-label={t('stats.trackViews')}
            checked={tracking}
            disabled={trackingBusy}
            onCheckedChange={(next) => onToggleTracking?.(next)}
          />
        </div>
        {!tracking && (
          <span className="text-[12px] leading-[16px] text-ink-3">
            {t('stats.trackingOff')}
          </span>
        )}
      </div>
      {hasViews ? (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <Metric label={t('stats.metrics.viewsInPeriod')} value={data.views_in_period ?? 0} />
            {(viewers.length > 0 || restricted) && (
              <Metric label={t('stats.metrics.uniqueViewers')} value={data.unique_viewers ?? viewers.length} />
            )}
            <Metric label={t('stats.metrics.totalViews')} value={data.total_views ?? 0} />
            <Metric
              label={t('stats.metrics.lastViewed')}
              value={relativeAge(data.last_viewed) || '—'}
              hint={exactTime(data.last_viewed)}
            />
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            <StatsChart daily={daily} />
            <span className="text-[11px] leading-[14px] text-ink-4">{t('stats.daysInUtc')}</span>
          </div>
          {viewers.length > 0 ? (
            <ViewersTable viewers={viewers} />
          ) : (!restricted && accessLoaded && (
            <span className="text-[12px] leading-[16px] text-ink-3">
              {t('stats.viewers.restrictedOnly')}
            </span>
          ))}
        </>
      ) : (
        <div className="py-6 text-center text-[12px] leading-[16px] text-ink-4">{t('stats.noViews')}</div>
      )}
    </>
  );
}

export function StatsPanel({
  data = null,
  loading = false,
  error = null,
  trackingBusy = false,
  accessMode = 'public',
  accessLoaded = false,
  onToggleTracking,
  onRetry,
  onClose,
}) {
  const { t } = useTranslation('artifacts');
  const failure = describeStatsError(error);
  return (
    <div
      className="artifact-stats-panel flex flex-col gap-[10px] overflow-y-auto bg-surface px-3 py-2
        font-[family-name:var(--font-body)] motion-reduce:!animate-none"
      style={{ animation: 'cw-comments-panel-in var(--dur-layout) var(--ease-out)' }}
    >
      <div className="flex shrink-0 items-center justify-between">
        <span className="text-[18px] font-semibold leading-[28px] text-ink">{t('stats.title')}</span>
        <Tooltip content={t('stats.close')}>
          <button
            type="button"
            aria-label={t('stats.close')}
            className="w-[24px] h-[24px] flex items-center justify-center bg-transparent border-0
              rounded-[6px] p-0 cursor-pointer text-ink-3 transition-colors
              hover:text-ink hover:bg-surface-2"
            onClick={onClose}
          >
            <XIcon />
          </button>
        </Tooltip>
      </div>
      {/* With data on screen the only failure is a refused tracking change.
          It is a notice without Retry: Retry reloads the stats, which would
          not repeat the change, and the switch itself is the way to try again. */}
      {data && failure && <StatsFailure failure={{ ...failure, retry: false }} onRetry={onRetry} />}
      {data ? (
        <StatsContent
          data={data}
          trackingBusy={trackingBusy}
          accessMode={accessMode}
          accessLoaded={accessLoaded}
          onToggleTracking={onToggleTracking}
        />
      ) : failure && !loading ? (
        <StatsFailure failure={failure} onRetry={onRetry} />
      ) : (
        <StatsSkeleton />
      )}
    </div>
  );
}

export default StatsPanel;
