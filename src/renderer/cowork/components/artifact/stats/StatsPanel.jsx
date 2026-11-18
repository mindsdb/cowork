// Stats panel: owner-only viewer analytics for a published artifact
// (ENG-4455). It docks beside the stage like the comments inbox (same width,
// entrance and compact-screen takeover) and renders from props only.
//
//   overview  — views, unique viewers, average time, completion; views per
//               day; time per section; the viewers, newest first
//   viewer    — one viewer's visits, each with its time per section
//
// The analytics settings live in the Share panel; when analytics is off this
// panel says so and can turn it on.

import { useState } from 'react';
import Ico from '../../Icons';
import { Button, Tooltip } from '../../ui';
import { ConfirmModal } from '../../ConfirmModal';
import { relativeAge } from '../../../lib/formatTime';
import { XIcon } from '../comments/icons';
import { StatsChart } from './StatsChart';
import { SectionsChart } from './SectionsChart';
import { CREDITS_REQUIRED_CODE, TRACKING_OFF_CODE, TrackingRefusal } from './TrackingRefusal';
import { exactTime, formatDuration, formatPercent } from './formatStats';
import i18n, { useTranslation } from '../../../../lib/i18n';

// Stable fallback: StatsChart rebuilds the chart whenever `daily` changes identity.
const NO_DAYS = [];
const NO_ROWS = [];

// Refusals with a known cause. Only a transient outage is worth a Retry.
const CODED_ERRORS = {
  stats_owned_by_other_account: { key: 'otherAccount', retry: false },
  stats_unavailable: { key: 'unavailable', retry: false },
  publish_credential_missing: { key: 'reconnect', retry: false },
  publish_credential_rejected: { key: 'reconnect', retry: false },
  stats_temporarily_unavailable: { key: 'temporarilyUnavailable', retry: true },
};

const SETTINGS_REFUSALS = new Set([CREDITS_REQUIRED_CODE, TRACKING_OFF_CODE]);

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

const SECTION_TITLE = 'm-0 text-[12px] font-semibold leading-[16px] text-ink';
const MUTED = 'text-[12px] leading-[16px] text-ink-3';

function Metric({ label, value, hint = '' }) {
  return (
    <div className="flex min-w-0 flex-col gap-[2px] rounded-[8px] bg-surface-2 px-[10px] py-2">
      <span className="text-[11px] leading-[14px] text-ink-3">{label}</span>
      {/* Focusable when it has a hint, so it is reachable from the keyboard too. */}
      <Tooltip content={hint}>
        <span
          tabIndex={hint ? 0 : undefined}
          className="truncate text-[18px] font-semibold leading-[24px] tabular-nums text-ink"
        >
          {value}
        </span>
      </Tooltip>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {children}
    </section>
  );
}

function StatsSkeleton({ label }) {
  const { t } = useTranslation('artifacts');
  const block = 'rounded-[8px] bg-surface-2 animate-pulse motion-reduce:animate-none';
  return (
    <div role="status" aria-label={label || t('stats.loading')} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-[54px] ${block}`} />)}
      </div>
      <div className={`h-[120px] ${block}`} />
      <div className={`h-[22px] ${block}`} />
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

function viewerName(viewer, t) {
  return viewer?.email || t('stats.viewers.anonymous');
}

function LastSeen({ iso }) {
  return (
    <Tooltip content={exactTime(iso)}>
      <span tabIndex={iso ? 0 : undefined}>{relativeAge(iso) || '—'}</span>
    </Tooltip>
  );
}

// The analytics viewers: each row opens that viewer's visits.
function ViewerList({ viewers, onOpen }) {
  const { t } = useTranslation('artifacts');
  return (
    <ul aria-label={t('stats.viewers.title')} className="m-0 flex list-none flex-col p-0">
      {viewers.map((viewer, i) => (
        <li key={viewer.id || i} style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
          <button
            type="button"
            onClick={() => onOpen?.(viewer.id)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] border-0 bg-transparent
              px-1 py-2 text-left font-body transition-colors hover:bg-surface-2"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className={`truncate text-[13px] leading-[18px] ${viewer.email ? 'text-ink' : 'text-ink-2'}`}>
                {viewerName(viewer, t)}
              </span>
              <span className="text-[11px] leading-[14px] tabular-nums text-ink-3">
                {t('stats.viewers.summary', {
                  count: viewer.visits || 0,
                  time: formatDuration(viewer.total_seconds || 0),
                })}
              </span>
            </span>
            <span className="shrink-0 text-[11px] leading-[14px] text-ink-3" title={exactTime(viewer.last_seen)}>
              {relativeAge(viewer.last_seen) || '—'}
            </span>
            <span aria-hidden="true" className="inline-flex shrink-0 text-ink-4">{Ico.chevRight(12)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Viewers recorded before analytics (restricted links only): email and last
// seen, nothing to open.
function LegacyViewers({ viewers }) {
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
            <tr key={`${viewer.email}-${i}`} className="text-ink-2" style={{ borderTop: '1px solid var(--line)' }}>
              <td className="max-w-[160px] truncate py-1 pr-2" title={viewer.email}>{viewer.email}</td>
              <td className="whitespace-nowrap py-1"><LastSeen iso={viewer.last_seen} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function deviceLabel(device, t) {
  return ['desktop', 'mobile', 'tablet'].includes(device) ? t(`stats.devices.${device}`) : t('stats.devices.unknown');
}

function ViewerDetail({ viewer, summary, onBack, onRetry }) {
  const { t } = useTranslation('artifacts');
  const detail = viewer.data;
  const person = detail?.viewer || summary || {};
  const visits = Array.isArray(detail?.visits) ? detail.visits : NO_ROWS;
  const failure = viewer.error ? describeStatsError(viewer.error) : null;
  return (
    <>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 font-body
            text-[12px] font-medium text-accent"
        >
          <span aria-hidden="true" className="inline-flex">{Ico.chevLeft(12)}</span>
          {t('stats.viewer.back')}
        </button>
        <h3 className="m-0 truncate text-[15px] font-semibold leading-[20px] text-ink" title={viewerName(person, t)}>
          {viewerName(person, t)}
        </h3>
        {(person.visits != null || person.last_seen) && (
          <span className={MUTED}>
            {t('stats.viewer.summary', {
              count: person.visits || 0,
              time: formatDuration(person.total_seconds || 0),
              lastSeen: relativeAge(person.last_seen) || '—',
            })}
          </span>
        )}
      </div>
      {viewer.loading ? (
        <StatsSkeleton label={t('stats.viewer.loading')} />
      ) : failure ? (
        <StatsFailure failure={failure} onRetry={onRetry} />
      ) : visits.length === 0 ? (
        <div className="py-6 text-center text-[12px] leading-[16px] text-ink-4">{t('stats.viewer.noVisits')}</div>
      ) : (
        <ol aria-label={t('stats.viewer.visits')} className="m-0 flex list-none flex-col gap-3 p-0">
          {visits.map((visit, i) => {
            const started = exactTime(visit.started_at);
            const sections = Array.isArray(visit.sections) ? visit.sections : NO_ROWS;
            return (
              <li key={visit.id || i} className="flex flex-col gap-2 rounded-[8px] bg-surface-2 px-3 py-[10px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[12px] font-medium leading-[16px] text-ink" title={started}>
                    {started || '—'}
                  </span>
                  <span className="shrink-0 text-[12px] font-semibold leading-[16px] tabular-nums text-ink">
                    {formatDuration(visit.seconds || 0)}
                  </span>
                </div>
                <span className="text-[11px] leading-[14px] text-ink-3">{deviceLabel(visit.device, t)}</span>
                {sections.length > 0 && (
                  <SectionsChart
                    sections={sections}
                    showReach={false}
                    label={t('stats.viewer.visitSections', { started: started || '—' })}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function TrackingOff({ busy, onTurnOn }) {
  const { t } = useTranslation('artifacts');
  return (
    <div className="flex shrink-0 flex-col items-start gap-2 rounded-[8px] bg-surface-2 px-3 py-3">
      <span className="text-[13px] font-medium leading-[18px] text-ink">{t('stats.off.title')}</span>
      <span className={MUTED}>{t('stats.off.body')}</span>
      {onTurnOn && (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => onTurnOn(true)}>
          {t('stats.off.turnOn')}
        </Button>
      )}
    </div>
  );
}

function Overview({ data, accessMode, accessLoaded, trackingBusy, deleting, onToggleTracking, onOpenViewer, onDelete }) {
  const { t } = useTranslation('artifacts');
  const analytics = data.analytics && typeof data.analytics === 'object' ? data.analytics : null;
  const analyticsViewers = Array.isArray(analytics?.viewers) ? analytics.viewers : NO_ROWS;
  const sections = Array.isArray(analytics?.sections) ? analytics.sections : NO_ROWS;
  const legacyViewers = Array.isArray(data.viewers) ? data.viewers : NO_ROWS;
  const daily = Array.isArray(data.daily) ? data.daily : NO_DAYS;
  const tracking = data.tracking === true;
  const restricted = accessMode === 'restricted';
  const hasViews = (data.total_views || 0) > 0 || (data.views_in_period || 0) > 0 || (analytics?.visits || 0) > 0;
  const uniqueViewers = analytics ? analyticsViewers.length : (data.unique_viewers ?? legacyViewers.length);
  return (
    <>
      {!tracking && <TrackingOff busy={trackingBusy} onTurnOn={onToggleTracking} />}
      {hasViews ? (
        <>
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <Metric
              label={t('stats.metrics.views')}
              value={data.total_views ?? analytics?.visits ?? 0}
              hint={data.last_viewed ? t('stats.metrics.lastViewedHint', { time: relativeAge(data.last_viewed) || exactTime(data.last_viewed) }) : ''}
            />
            <Metric label={t('stats.metrics.viewers')} value={uniqueViewers || 0} />
            <Metric label={t('stats.metrics.avgTime')} value={analytics ? formatDuration(analytics.avg_seconds || 0) : '—'} />
            <Metric label={t('stats.metrics.completion')} value={formatPercent(analytics?.completion)} />
          </div>
          <Section title={t('stats.chartTitle')}>
            <StatsChart daily={daily} />
            <span className="text-[11px] leading-[14px] text-ink-4">{t('stats.daysInUtc')}</span>
          </Section>
          {sections.length > 0 && (
            <Section title={t('stats.sections.title')}>
              <SectionsChart sections={sections} />
            </Section>
          )}
          <Section title={t('stats.viewers.title')}>
            {analyticsViewers.length > 0 ? (
              <ViewerList viewers={analyticsViewers} onOpen={onOpenViewer} />
            ) : legacyViewers.length > 0 ? (
              <LegacyViewers viewers={legacyViewers} />
            ) : (
              <span className={MUTED}>
                {!restricted && accessLoaded && !tracking ? t('stats.viewers.restrictedOnly') : t('stats.viewers.none')}
              </span>
            )}
          </Section>
          {onDelete && (
            <div className="flex shrink-0 justify-start pt-1">
              <Button size="sm" variant="danger" disabled={deleting} onClick={onDelete}>
                {t('stats.delete.action')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-1 py-6 text-center">
          <span className="text-[13px] font-medium leading-[18px] text-ink-2">{t('stats.noViews')}</span>
          {tracking && <span className="text-[12px] leading-[16px] text-ink-4">{t('stats.noViewsHint')}</span>}
        </div>
      )}
    </>
  );
}

export function StatsPanel({
  data = null,
  loading = false,
  error = null,
  trackingBusy = false,
  deleting = false,
  // `{ id, data, loading, error }` while one viewer's visits are open.
  viewer = null,
  accessMode = 'public',
  accessLoaded = false,
  onToggleTracking,
  onOpenViewer,
  onCloseViewer,
  onDeleteAnalytics,
  onRetry,
  onClose,
}) {
  const { t } = useTranslation('artifacts');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const failure = describeStatsError(error);
  const settingsRefusal = data && error && SETTINGS_REFUSALS.has(error.code);
  const viewerSummary = viewer && Array.isArray(data?.analytics?.viewers)
    ? data.analytics.viewers.find((row) => row.id === viewer.id)
    : null;
  return (
    <div
      className="artifact-stats-panel flex flex-col gap-[14px] overflow-y-auto bg-surface px-3 py-2
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
      {/* With data on screen a failure is a refused action (a settings
          change or a delete). It is a notice without Retry: Retry reloads the
          stats, which would not repeat the action. */}
      {settingsRefusal && <TrackingRefusal error={error} className="shrink-0" />}
      {data && failure && !settingsRefusal && (
        <StatsFailure failure={{ ...failure, retry: false }} onRetry={onRetry} />
      )}
      {data && viewer ? (
        <ViewerDetail
          viewer={viewer}
          summary={viewerSummary}
          onBack={onCloseViewer}
          onRetry={() => onOpenViewer?.(viewer.id)}
        />
      ) : data ? (
        <Overview
          data={data}
          accessMode={accessMode}
          accessLoaded={accessLoaded}
          trackingBusy={trackingBusy}
          deleting={deleting}
          onToggleTracking={onToggleTracking}
          onOpenViewer={onOpenViewer}
          onDelete={onDeleteAnalytics ? () => setConfirmDelete(true) : null}
        />
      ) : failure && !loading ? (
        <StatsFailure failure={failure} onRetry={onRetry} />
      ) : (
        <StatsSkeleton />
      )}
      <ConfirmModal
        open={confirmDelete}
        title={t('stats.delete.title')}
        message={t('stats.delete.message')}
        confirmLabel={t('stats.delete.confirm')}
        busy={deleting}
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await onDeleteAnalytics?.();
          setConfirmDelete(false);
        }}
      />
    </div>
  );
}

export default StatsPanel;
