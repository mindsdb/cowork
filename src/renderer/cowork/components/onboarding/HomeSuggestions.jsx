import Ico from '../Icons';
import { useOnboarding } from './useOnboarding';
import { HABIT_TRACKER_PROMPT } from './steps';

// First-run suggestion chips under the home composer. Each chip drops a
// ready-to-send prompt into the composer; prompts with a [bracketed]
// placeholder land with that range selected so the user types their own
// words straight over it.
//
// Visibility contract (ENG-1137): chips render ONLY while the account is
// brand new — zero tasks, zero artifacts, onboarding not dismissed. The
// habit-tracker chip additionally disappears once onboarding step 1 is
// done (it IS step 1, reachable from either surface).

const PLAN_WEEK_PROMPT =
  "Plan my week. I'm working on [what's on your plate this week]. Build it as a live artifact: a one-page board with my priorities, a plan for the week, and a checklist I can tick off. Keep it easy to edit.";

const PROJECT_BRIEF_PROMPT =
  'Draft a project brief for [the project on your mind]. Build it as a live artifact: one page with the goal, scope, milestones, and open questions, easy to edit and share.';

// Selection range covering the [placeholder] token, brackets included, so
// the first keystroke replaces the whole hint.
function placeholderRange(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const end = text.indexOf(']', start);
  return end === -1 ? null : [start, end + 1];
}

const CHIPS = [
  { id: 'plan-week', label: 'Plan my week', icon: (s) => Ico.list(s), prompt: PLAN_WEEK_PROMPT },
  { id: 'habit-tracker', label: 'Build me a habit tracker', icon: (s) => Ico.clock(s), prompt: HABIT_TRACKER_PROMPT },
  { id: 'project-brief', label: 'Draft a project brief', icon: (s) => Ico.doc(s), prompt: PROJECT_BRIEF_PROMPT },
];

// Hover visuals (icon-tile lift, label color) live in CSS
// (`.home-suggestion-chip`), not React state.
function Chip({ chip, onPick, index }) {
  return (
    <button
      type="button"
      onClick={() => onPick(chip)}
      className="home-suggestion-chip"
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', textAlign: 'left', font: 'inherit',
        border: 0, background: 'transparent', cursor: 'pointer',
        padding: '5px 4px', borderRadius: 'var(--r)',
        // Stagger the chips in behind the composer's own fade.
        opacity: 0,
        animation: `fadein-up 300ms cubic-bezier(0.23, 1, 0.32, 1) ${180 + index * 60}ms both`,
      }}
    >
      {/* Icon tile — outer radius 9 = inner content radius + padding. */}
      <span className="home-suggestion-chip__tile" aria-hidden>
        {chip.icon(16)}
      </span>
      <span className="home-suggestion-chip__label">
        {chip.label}
      </span>
    </button>
  );
}

export default function HomeSuggestions({ tasksCount, artifactsCount, onPick }) {
  const { isComplete, dismissed } = useOnboarding();

  if (dismissed || tasksCount > 0 || artifactsCount > 0) return null;

  const chips = CHIPS.filter((c) => !(c.id === 'habit-tracker' && isComplete('see-it-work')));
  if (!chips.length) return null;

  const pick = (chip) => onPick(chip.prompt, placeholderRange(chip.prompt));

  return (
    <div style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', marginTop: 32 }}>
      <div style={{
        fontSize: 13, color: 'var(--frost-500)', margin: '0 4px 12px',
        opacity: 0,
        animation: 'fadein-up 300ms cubic-bezier(0.23, 1, 0.32, 1) 120ms both',
      }}>
        Not sure where to start? Try one of these.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {chips.map((chip, i) => (
          <Chip key={chip.id} chip={chip} onPick={pick} index={i} />
        ))}
      </div>
    </div>
  );
}
