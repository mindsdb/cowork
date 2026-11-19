// Stats panel: owner-only viewer analytics for a published artifact
// (ENG-4455). It docks beside the stage like the comments inbox (same width,
// entrance and compact-screen takeover) and renders from props only.
//
//   overview  — visits, unique viewers, average time, completion; time per
//               page for everyone; all visits, one row per viewer, which
//               unfolds in place into that viewer's device, location and
//               time per page (ActivityList); views per day
//
// The analytics settings live in the Share panel; when analytics is off this
// panel says so and can turn it on.

import { useState } from 'react';
import { Button, Tooltip } from '../../ui';
import { ConfirmModal } from '../../ConfirmModal';
import { relativeAge } from '../../../lib/formatTime';
import { XIcon } from '../comments/icons';
import { StatsChart } from './StatsChart';
import { PageBars } from './PageBars';
import { ActivityList } from './ActivityList';
import { StatsFailure, StatsSkeleton, describeStatsError } from './StatsStates';
import { CREDITS_REQUIRED_CODE, TRACKING_OFF_CODE, TrackingRefusal } from './TrackingRefusal';
import { exactTime, formatDuration, formatPercent } from './formatStats';
import { useTranslation } from '../../../../lib/i18n';

export { describeStatsError };

// Stable fallback: StatsChart rebuilds the chart whenever `daily` changes identity.
const NO_DAYS = [];
const NO_ROWS = [];

const SETTINGS_REFUSALS = new Set([CREDITS_REQUIRED_CODE, TRACKING_OFF_CODE]);

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

function Section({ title, aside = null, children }) {
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={SECTION_TITLE}>{title}</h3>
        {aside && <span className="text-[11px] leading-[14px] tabular-nums text-ink-4">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

// The overview chart's bars: every section in page order, with its average
// time and reach.
function audienceBars(sections) {
  return [...sections]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((section, i) => ({
      key: section.key ?? `#${section.index ?? i}`,
      label: section.label,
      seconds: section.avg_seconds,
      reach: section.reach,
    }));
}

function LastSeen({ iso }) {
  return (
    <Tooltip content={exactTime(iso)}>
      <span tabIndex={iso ? 0 : undefined}>{relativeAge(iso) || '—'}</span>
    </Tooltip>
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

function Overview({
  data, viewer, accessMode, accessLoaded, trackingBusy, deleting, onToggleTracking, onOpenViewer, onCloseViewer, onDelete,
}) {
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
              label={t('stats.metrics.visits')}
              value={data.total_views ?? analytics?.visits ?? 0}
              hint={data.last_viewed ? t('stats.metrics.lastViewedHint', { time: relativeAge(data.last_viewed) || exactTime(data.last_viewed) }) : ''}
            />
            <Metric label={t('stats.metrics.viewers')} value={uniqueViewers || 0} />
            <Metric label={t('stats.metrics.avgTime')} value={analytics ? formatDuration(analytics.avg_seconds || 0) : '—'} />
            <Metric label={t('stats.metrics.completion')} value={formatPercent(analytics?.completion)} />
          </div>
          {sections.length > 0 && (
            <Section title={t('stats.pages.title')}>
              <PageBars bars={audienceBars(sections)} mode="avg" label={t('stats.pages.audienceChart')} />
            </Section>
          )}
          <Section
            title={t('stats.activity.title')}
            aside={analyticsViewers.length > 0 ? t('stats.activity.viewerCount', { count: analyticsViewers.length }) : null}
          >
            {analyticsViewers.length > 0 ? (
              <ActivityList
                viewers={analyticsViewers}
                outline={sections}
                openViewer={viewer}
                onOpenViewer={onOpenViewer}
                onCloseViewer={onCloseViewer}
              />
            ) : legacyViewers.length > 0 ? (
              <LegacyViewers viewers={legacyViewers} />
            ) : (
              <span className={MUTED}>
                {!restricted && accessLoaded && !tracking ? t('stats.viewers.restrictedOnly') : t('stats.viewers.none')}
              </span>
            )}
          </Section>
          <Section title={t('stats.chartTitle')}>
            <StatsChart daily={daily} />
            <span className="text-[11px] leading-[14px] text-ink-4">{t('stats.daysInUtc')}</span>
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
  return (
    <div
      className="artifact-stats-panel flex flex-col gap-[14px] overflow-y-auto bg-surface px-3 py-2
        font-[family-name:var(--font-body)]"
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
      {data ? (
        <Overview
          data={data}
          viewer={viewer}
          onCloseViewer={onCloseViewer}
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
