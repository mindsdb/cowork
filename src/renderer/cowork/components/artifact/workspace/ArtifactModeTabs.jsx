const MODES = [
  ['preview', 'Preview'],
  ['edit', 'Edit'],
  ['review', 'Review'],
];

export function ArtifactModeTabs({
  value,
  onChange,
  canEdit,
  canReview,
  editDisabledReason = 'Only the artifact owner can edit',
  reviewDisabledReason = 'Review is not available for this artifact',
}) {
  return (
    <div
      role="tablist"
      aria-label="Artifact mode"
      className="artifact-mode-tabs"
    >
      {MODES.map(([mode, label]) => {
        const disabled = (mode === 'edit' && !canEdit) || (mode === 'review' && !canReview);
        const disabledReason = mode === 'edit' ? editDisabledReason : reviewDisabledReason;
        return (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={value === mode}
            aria-label={disabled ? `${label} unavailable — ${disabledReason}` : label}
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
