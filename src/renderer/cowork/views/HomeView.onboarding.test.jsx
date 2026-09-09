// Onboarding step 1 from the home composer (ENG-2307): the habit-tracker
// prompt marks "See Cowork work" done only once onSend reports the send
// went out. A false answer (provider preflight failed) leaves it pending.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { HABIT_TRACKER_PROMPT } from '../components/onboarding/steps';
import { getSnapshot, reset } from '../components/onboarding/onboardingStore';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchSkills: vi.fn(async () => []) };
});

const renderHome = (onSend) => {
  render(<HomeView
    onSend={onSend}
    activeTasks={[]}
    onSelectTask={vi.fn()}
    onClearActive={vi.fn()}
    project={{ name: 'general' }}
    projects={[{ name: 'general' }]}
    models={[]}
    onProjectChange={vi.fn()}
    onModelChange={vi.fn()}
    configReady
    serverOnline
    skipIntro
    onPrefill={vi.fn()}
  />);
};

const sendHabitTracker = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('textbox'));
  await user.paste(HABIT_TRACKER_PROMPT);
  await user.keyboard('{Enter}');
};

beforeEach(() => {
  window.localStorage.clear();
  reset();
});

describe('HomeView onboarding step 1 (ENG-2307)', () => {
  it('completes the step once the send goes out', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    await sendHabitTracker();
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    await waitFor(() => expect(getSnapshot().completed.has('see-it-work')).toBe(true));
  });

  it('leaves the step pending when the send does not go out', async () => {
    const onSend = vi.fn(async () => false);
    renderHome(onSend);
    await sendHabitTracker();
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(getSnapshot().completed.has('see-it-work')).toBe(false);
  });
});
