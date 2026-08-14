import Ico from '../Icons';

// Small rounded checkbox — hollow while pending, accent-filled with a tick
// once the step is done.
function Checkbox({ done }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0, marginTop: 1,
        width: 16, height: 16, borderRadius: 5,
        display: 'grid', placeItems: 'center', color: '#fff',
        border: `1px solid ${done ? 'var(--accent)' : 'var(--border-02, var(--line-2))'}`,
        background: done ? 'var(--accent)' : 'transparent',
        transition: 'background 140ms ease, border-color 140ms ease',
      }}
    >
      {done && Ico.check(11)}
    </span>
  );
}

// One checklist row. Pending: title + description shown. Done: title struck
// through and muted, description collapsed — revealed again on hover. Hover
// visuals live in CSS (`.onboarding-step-row`), not React state.
export default function OnboardingItem({ step, done, onStart }) {
  return (
    <button
      type="button"
      className="onboarding-step-row"
      data-done={done || undefined}
      onClick={() => onStart(step)}
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start',
        width: '100%', textAlign: 'left', font: 'inherit',
        border: 0, cursor: done ? 'default' : 'pointer', borderRadius: 'var(--r-sm)', padding: '7px 6px',
      }}
    >
      <Checkbox done={done} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block', fontSize: 13, fontWeight: 550, lineHeight: 1.35,
            color: done ? 'var(--frost-500)' : 'var(--text-strong)',
            textDecoration: done ? 'line-through' : 'none',
            textDecorationColor: 'var(--frost-500)',
          }}
        >
          {step.title}
        </span>
        {/* Collapsible description: the 0fr→1fr grid row animates height
            open/closed without hard-coding a pixel value. */}
        <span className="onboarding-step-desc">
          <span style={{ overflow: 'hidden', minHeight: 0 }}>
            <span style={{ display: 'block', fontSize: 12, lineHeight: 1.4, color: 'var(--frost-600)', marginTop: 2 }}>
              {step.description}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
