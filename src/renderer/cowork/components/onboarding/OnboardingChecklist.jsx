import { useOnboarding } from './useOnboarding';
import OnboardingItem from './OnboardingItem';
import OnboardingComplete from './OnboardingComplete';

// "Get to know Cowork" checklist. Two surfaces, one shared state:
//   • variant="home"    — prominent welcome card on the home screen, shown
//                         to a brand-new user BEFORE they start a step.
//   • variant="sidebar" — compact tracker docked above the backend pill,
//                         shown ONCE the user has started, as a persistent
//                         nudge to finish (and the reward state at the end).
// Each row seeds a new chat; `onStartChat` is the home composer's send
// handler. Card chrome lives in `.onboarding-card` (theme-aware).
export default function OnboardingChecklist({ onStartChat, variant = 'sidebar' }) {
  const { steps, isComplete, completedCount, total, allDone, started, dismissed, complete, dismiss } = useOnboarding();

  if (dismissed) return null;
  // The home card hands off to the sidebar the moment work begins, so the
  // two never show at the same time.
  if (variant === 'home' && started) return null;
  if (variant === 'sidebar' && !started) return null;

  const isHome = variant === 'home';

  // Mark the step done first so it shows struck through afterwards, then
  // hand its prompt to the composer to open the new chat.
  const start = (step) => {
    complete(step.id);
    onStartChat(step.prompt);
  };

  const body = allDone ? (
    <OnboardingComplete onDismiss={dismiss} />
  ) : (
    <>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: isHome ? 2 : 6, padding: '0 6px' }}>
        <span style={{ flex: 1, fontSize: isHome ? 15 : 13, fontWeight: 650, color: 'var(--text-strong)' }}>
          Get to know Cowork
        </span>
        <span style={{ fontSize: isHome ? 12.5 : 11.5, fontWeight: 500, color: 'var(--frost-600)', fontVariantNumeric: 'tabular-nums' }}>
          {completedCount}/{total}
        </span>
      </header>
      {isHome && (
        <p style={{ margin: '0 0 10px', padding: '0 6px', fontSize: 12.5, lineHeight: 1.45, color: 'var(--frost-600)' }}>
          A few quick ways to see what I can do — pick one to begin.
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {steps.map((step) => (
          <OnboardingItem key={step.id} step={step} done={isComplete(step.id)} onStart={start} />
        ))}
      </div>
    </>
  );

  if (isHome) {
    return (
      <div style={{ width: '100%', maxWidth: 'var(--composer-max-width, 640px)', marginTop: 28, animation: 'fadein-up 360ms ease-out both' }}>
        <div className="onboarding-card" style={{ padding: 18 }}>{body}</div>
      </div>
    );
  }

  return (
    <div style={{ flexShrink: 0, margin: '4px 10px 8px', animation: 'fadein-up 320ms ease-out both' }}>
      <div className="onboarding-card" style={{ padding: 12 }}>{body}</div>
    </div>
  );
}
