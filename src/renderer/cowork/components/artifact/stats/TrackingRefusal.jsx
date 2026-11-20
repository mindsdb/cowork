// Why a viewer-analytics setting did not save (ENG-4455). Turning analytics
// on needs credits: that refusal (402 `credits_required`) says so and links
// to where credits are added, the same billing deep link the usage notices
// use. Shared by the Share panel and the Stats panel.

import { host } from '../../../../platform/host';
import { useTranslation } from '../../../../lib/i18n';
import { useHubUsageContext } from '../../../lib/hubUsageContext';
import { USAGE_ACTIONS, usageActionUrl } from '../../../lib/usageWarnings';
import { useConsoleLink } from '../../../hooks/useConsoleLink';

export const CREDITS_REQUIRED_CODE = 'credits_required';
export const TRACKING_OFF_CODE = 'tracking_off';

export function TrackingRefusal({ error, className = '' }) {
  const { t } = useTranslation('artifacts');
  const isBillingOwner = !!useHubUsageContext()?.usage?.isBillingOwner;
  const consoleLink = useConsoleLink();
  if (!error) return null;
  const credits = error.code === CREDITS_REQUIRED_CODE;
  const message = credits
    ? t('analytics.errors.creditsRequired')
    : error.code === TRACKING_OFF_CODE
      ? t('analytics.errors.trackingOff')
      : (error.message || t('analytics.errors.saveFailed'));
  return (
    <div role="alert" className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] leading-[16px] text-ink-2 ${className}`}>
      <span>{message}</span>
      {credits && (
        <button
          type="button"
          className="cursor-pointer border-0 bg-transparent p-0 font-body text-[12px] font-medium text-accent"
          onClick={() => host.openExternal(consoleLink(usageActionUrl(USAGE_ACTIONS.addFunds, { isBillingOwner })))}
        >
          {t('analytics.addCredits')}
        </button>
      )}
    </div>
  );
}

export default TrackingRefusal;
