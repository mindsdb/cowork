import Ico from '../Icons';
import { TASK_MODES } from './taskModes';

// Gate hover on a fine pointer to avoid sticky touch states. Use --stagger in classes
// so reduced-motion rules can override the entrance animation.
export default function TaskModePills({ onPick }) {
  return (
    <div
      className="mt-5 flex w-full max-w-[var(--composer-max-width,640px)] flex-wrap justify-center gap-2"
      role="group"
      aria-label="Task types"
    >
      {TASK_MODES.map((mode, i) => (
        <button
          key={mode.id}
          type="button"
          style={{ '--stagger': `${140 + i * 40}ms` }}
          className="group inline-flex cursor-pointer items-center gap-[7px] rounded-full border border-solid border-line-2 bg-[var(--surface-0)] px-[14px] py-2 [font-family:inherit] text-[13.5px] font-medium text-[var(--frost-700)] opacity-0 [animation:fadein-up_300ms_cubic-bezier(0.23,1,0.32,1)_var(--stagger)_both] motion-reduce:animate-none motion-reduce:opacity-100 [transition:background_140ms_ease,color_140ms_ease,border-color_140ms_ease,transform_160ms_cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] motion-reduce:active:transform-none [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[color-mix(in_srgb,var(--ink)_5%,var(--surface-0))] [@media(hover:hover)_and_(pointer:fine)]:hover:text-[var(--text-strong)]"
          onClick={() => onPick(mode)}
        >
          <span
            className="inline-flex text-[var(--frost-600)] [transition:color_140ms_ease] [@media(hover:hover)_and_(pointer:fine)]:group-hover:text-[var(--text-strong)]"
            aria-hidden
          >
            {Ico[mode.icon](15)}
          </span>
          {mode.pillLabel}
        </button>
      ))}
    </div>
  );
}
