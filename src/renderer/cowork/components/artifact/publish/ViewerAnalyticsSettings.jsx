// The Share panel's viewer-analytics settings (ENG-4455):
//
//   Collect viewer analytics      — who opens the page, for how long, and
//                                   which parts they read
//
// "Ask for email before viewing" is out of the first version.
//
// `controller` is a useArtifactStats for the artifact: the settings come with
// its stats, and a change saved here reaches an open Stats panel too.

import { Switch } from '../../ui/Switch';
import { useTranslation } from '../../../../lib/i18n';
import { TrackingRefusal } from '../stats/TrackingRefusal';
import { describeStatsError } from '../stats/StatsPanel';

function SettingRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <div className="flex items-center justify-between gap-3">
        <span className="font-body text-sm text-ink">{label}</span>
        <Switch size="sm" aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {hint && <span className="font-body text-xs leading-[1.4] text-ink-3">{hint}</span>}
    </div>
  );
}

export function ViewerAnalyticsSettings({ controller }) {
  const { t } = useTranslation('artifacts');
  const data = controller?.data || null;
  const error = controller?.error || null;
  const busy = !!controller?.trackingBusy;
  const tracking = data?.tracking === true;
  const loadFailure = !data && error ? describeStatsError(error) : null;
  return (
    <div className="flex flex-col gap-3" data-testid="viewer-analytics-settings">
      <SettingRow
        label={t('analytics.collect')}
        hint={t('analytics.collectHint')}
        checked={tracking}
        disabled={!data || busy}
        onChange={(on) => controller?.setTracking(on)}
      />
      {!data && controller?.loading && (
        <span role="status" className="font-body text-xs text-ink-3">{t('analytics.loading')}</span>
      )}
      {!data && !controller?.loading && error && (
        // Says why, as the Stats panel does (describeStatsError), and offers
        // Retry only where trying again can help.
        <div className="flex flex-wrap items-baseline gap-x-2 font-body text-xs text-ink-3">
          <span>{t('analytics.loadFailed')}</span>
          {loadFailure && loadFailure.message !== t('stats.errors.loadFailed') && (
            <span className="basis-full text-ink-4">{loadFailure.message}</span>
          )}
          {loadFailure?.retry !== false && (
            <button
              type="button"
              onClick={() => controller?.reload()}
              className="cursor-pointer border-0 bg-transparent p-0 font-body text-xs font-medium text-accent"
            >
              {t('stats.retry')}
            </button>
          )}
        </div>
      )}
      {data && <TrackingRefusal error={error} />}
    </div>
  );
}

export default ViewerAnalyticsSettings;
