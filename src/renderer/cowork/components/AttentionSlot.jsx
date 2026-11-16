import Ico from './Icons';
import { Tooltip } from './ui/Tooltip';
import { useTranslation } from '../../lib/i18n';

// Where app-wide attention (Code's bell) portals in, through `slotRef`. Code
// fills it only while Code is in front, so where Code is available a quiet,
// disabled bell holds the spot the rest of the time (CSS shows it only while
// the slot is empty), and the row keeps one shape in both workspaces.
export default function AttentionSlot({ slotRef, className, placeholder = false }) {
  const { t } = useTranslation('shell');
  return (
    <>
      <div ref={slotRef} className={className} />
      {placeholder && (
        <Tooltip content={t('attention.placeholderTooltip')}>
          {/* aria-disabled rather than disabled, so hover and focus still
              explain why it does nothing. */}
          <button
            type="button"
            className="icon-btn app-attention-placeholder"
            aria-disabled="true"
            aria-label={t('attention.placeholderAriaLabel')}
          >
            {Ico.bell(16)}
          </button>
        </Tooltip>
      )}
    </>
  );
}
