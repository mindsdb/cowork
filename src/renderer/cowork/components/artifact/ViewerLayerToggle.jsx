// A header toggle for a viewer layer (ENG-4227): icon and label, pressed
// when on, filled with the accent then.

export function ViewerLayerToggle({ icon, label, pressed, onToggle, badge = 0, badgeLabel }) {
  return (
    <span className="artifact-layer-toggle-wrap">
      <button
        type="button"
        className="artifact-layer-toggle"
        aria-pressed={pressed}
        aria-label={badge > 0 && badgeLabel ? badgeLabel : label}
        onClick={() => onToggle(!pressed)}
      >
        {icon}
        <span className="artifact-layer-toggle-label">{label}</span>
      </button>
      {badge > 0 && (
        <span className="artifact-feedback-badge" aria-hidden="true">{Math.min(99, badge)}</span>
      )}
    </span>
  );
}

export default ViewerLayerToggle;
