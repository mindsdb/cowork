// Onboarding store contract: step completion + dismissal persist to
// localStorage and notify subscribers with a fresh snapshot identity
// (useSyncExternalStore's requirement).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const load = async () => {
  vi.resetModules();
  return import('./onboardingStore');
};

describe('onboardingStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('completes a step, persists it, and emits a new snapshot', async () => {
    const store = await load();
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.completeStep('see-it-work');

    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.completed.has('see-it-work')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem('anton.onboarding.completed'))).toEqual(['see-it-work']);

    // Re-completing the same step is a no-op — no extra emit.
    store.completeStep('see-it-work');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('restores completed steps and dismissal from localStorage', async () => {
    localStorage.setItem('anton.onboarding.completed', JSON.stringify(['connect-app']));
    localStorage.setItem('anton.onboarding.dismissed', 'true');
    const store = await load();
    const snap = store.getSnapshot();
    expect(snap.completed.has('connect-app')).toBe(true);
    expect(snap.dismissed).toBe(true);
  });

  it('retires the checklist for an upgrading profile, but not mid-run', async () => {
    // Untouched progress + an account that already has work → this is an
    // existing user, not a first run. Retire the card.
    const store = await load();
    store.dismissIfUntouched();
    expect(store.getSnapshot().dismissed).toBe(true);

    // A fresh user partway through the steps has tasks too — theirs stays.
    localStorage.clear();
    const fresh = await load();
    fresh.completeStep('see-it-work');
    fresh.dismissIfUntouched();
    expect(fresh.getSnapshot().dismissed).toBe(false);
  });

  it('tracks the first-artifact tip flag independently of the snapshot', async () => {
    const store = await load();
    expect(store.isArtifactTipDismissed()).toBe(false);
    store.dismissArtifactTip();
    expect(store.isArtifactTipDismissed()).toBe(true);
    store.reset();
    expect(store.isArtifactTipDismissed()).toBe(false);
    expect(store.getSnapshot().dismissed).toBe(false);
  });
});
