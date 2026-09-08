import Ico from '../Icons';

// Small rounded checkbox — hollow while pending, accent-filled with a tick
// once the step is done.
function Checkbox({ done }) {
  return (
    <span
      aria-hidden
      className="shrink-0 mt-[1px] w-4 h-4 rounded-[5px] grid place-items-center text-white border border-solid [transition:background_140ms_ease,border-color_140ms_ease]"
      style={{
        borderColor: done ? 'var(--accent)' : 'var(--border-02, var(--line-2))',
        background: done ? 'var(--accent)' : 'transparent',
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
      className="onboarding-step-row flex gap-[10px] items-start w-full text-left font-[inherit] border-0 rounded-[var(--r-sm)] py-[7px] px-[6px]"
      data-done={done || undefined}
      onClick={() => onStart(step)}
      style={{ cursor: done ? 'default' : 'pointer' }}
    >
      <Checkbox done={done} />
      <span className="flex-1 min-w-0">
        <span
          className="block text-[13px] font-[550] leading-[1.35] [text-decoration-color:var(--frost-500)]"
          style={{
            color: done ? 'var(--frost-500)' : 'var(--text-strong)',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {step.title}
        </span>
        {/* Collapsible description: the 0fr→1fr grid row animates height
            open/closed without hard-coding a pixel value. */}
        <span className="onboarding-step-desc">
          <span className="overflow-hidden min-h-0">
            <span className="block text-[12px] leading-[1.4] text-[var(--frost-600)] mt-[2px]">
              {step.description}
            </span>
          </span>
        </span>
      </span>
    </button>
  );
}
