import Ico from '../Icons';
import { TASK_MODES } from './taskModes';

// Task-mode pill row under the home composer (ENG-1594). Always visible for
// every account (unlike the old first-run-only suggestion chips) whenever no
// mode is selected. Picking a pill hands the full mode object to the parent,
// which owns the selection state.
export default function TaskModePills({ onPick }) {
  return (
    <div className="task-mode-pills" role="group" aria-label="Task types">
      {TASK_MODES.map((mode, i) => (
        <button
          key={mode.id}
          type="button"
          className="task-mode-pill"
          style={{
            // Stagger in behind the composer's own fade — same curve the
            // rest of the home surface uses.
            opacity: 0,
            animation: `fadein-up 300ms cubic-bezier(0.23, 1, 0.32, 1) ${140 + i * 40}ms both`,
          }}
          onClick={() => onPick(mode)}
        >
          <span className="task-mode-pill__icon" aria-hidden>{Ico[mode.icon](15)}</span>
          {mode.pillLabel}
        </button>
      ))}
    </div>
  );
}
