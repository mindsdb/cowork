import { useOnboarding } from './useOnboarding';
import OnboardingItem from './OnboardingItem';
import OnboardingComplete from './OnboardingComplete';

// "Get to know Cowork" checklist, docked at the foot of the sidebar above
// the backend status pill. Each row seeds a new chat; finishing all four
// swaps the list for the reward state. `onStartChat` is the home
// composer's send handler (creates a fresh session).
//
// Card chrome (background + box-shadow) lives in the `.onboarding-card`
// class so it can flip between the light-mode spec shadow and a darker,
// elevated treatment under `body[data-theme="dark"]`.
export default function OnboardingChecklist({ onStartChat }) {
  const { steps, isComplete, completedCount, total, allDone, dismissed, complete, dismiss } = useOnboarding();

  if (dismissed) return null;

  // Mark the step done first so it shows struck through afterwards, then
  // hand its prompt to the composer to open the new chat.
  const start = (step) => {
    complete(step.id);
    onStartChat(step.prompt);
  };

  return (
    <div style={{ flexShrink: 0, margin: '4px 10px 8px', animation: 'fadein-up 320ms ease-out both' }}>
      <div className="onboarding-card" style={{ padding: 12 }}>
        {allDone ? (
          <OnboardingComplete onDismiss={dismiss} />
        ) : (
          <>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, padding: '0 6px' }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 650, color: 'var(--text-strong)' }}>
                Get to know Cowork
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--frost-600)', fontVariantNumeric: 'tabular-nums' }}>
                {completedCount}/{total}
              </span>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {steps.map((step) => (
                <OnboardingItem key={step.id} step={step} done={isComplete(step.id)} onStart={start} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
