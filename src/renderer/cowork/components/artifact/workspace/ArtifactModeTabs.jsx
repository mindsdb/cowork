import { useTranslation } from '../../../../lib/i18n';

const MODES = ['preview', 'edit', 'review'];

export function ArtifactModeTabs({
  value,
  onChange,
  canEdit,
  canReview,
  editDisabledReason: editDisabledReasonProp,
  reviewDisabledReason: reviewDisabledReasonProp,
}) {
  const { t } = useTranslation('artifacts');
  const editDisabledReason = editDisabledReasonProp ?? t('modeTabs.editDisabled');
  const reviewDisabledReason = reviewDisabledReasonProp ?? t('modeTabs.reviewDisabled');
  return (
    <div
      role="tablist"
      aria-label={t('modeTabs.ariaLabel')}
      className="artifact-mode-tabs"
    >
      {MODES.map((mode) => {
        const label = t(`modeTabs.${mode}`);
        const disabled = (mode === 'edit' && !canEdit) || (mode === 'review' && !canReview);
        const disabledReason = mode === 'edit' ? editDisabledReason : reviewDisabledReason;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={value === mode}
            aria-label={disabled ? t('modeTabs.unavailable', { label, reason: disabledReason }) : label}
            disabled={disabled}
            title={disabled ? disabledReason : undefined}
            onClick={() => onChange(mode)}
            className="artifact-mode-tab"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default ArtifactModeTabs;
