// Onboarding steps completed from the home composer (ENG-2307): a step's
// prompt, or an example, marks it done only once onSend reports the send went
// out. A false answer (provider preflight failed) leaves it pending.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { HABIT_TRACKER_PROMPT, OWN_WORK_PROMPT } from '../components/onboarding/steps';
import { findSample } from '../lib/consoleHandoff';
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

const sendText = async (text) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('textbox'));
  await user.paste(text);
  await user.keyboard('{Enter}');
};
const sendHabitTracker = () => sendText(HABIT_TRACKER_PROMPT);

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

  it('completes the own-work step, and not the example step, when its prompt is sent', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    await sendText(OWN_WORK_PROMPT);
    await waitFor(() => expect(getSnapshot().completed.has('bring-your-work')).toBe(true));
    expect(getSnapshot().completed.has('see-it-work')).toBe(false);
  });

  it('leaves the own-work step pending when the send does not go out', async () => {
    const onSend = vi.fn(async () => false);
    renderHome(onSend);
    await sendText(OWN_WORK_PROMPT);
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect(getSnapshot().completed.has('bring-your-work')).toBe(false);
  });

  it('completes the example step when any example goes out as placed', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    await sendText(findSample('games', 'classic-snake-game').sample.prompt);
    await waitFor(() => expect(getSnapshot().completed.has('see-it-work')).toBe(true));
    expect(getSnapshot().completed.has('bring-your-work')).toBe(false);
  });

  it('completes nothing for an ordinary message', async () => {
    const onSend = vi.fn(async () => true);
    renderHome(onSend);
    await sendText('what is on my calendar today');
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    expect([...getSnapshot().completed]).toEqual([]);
  });
});
