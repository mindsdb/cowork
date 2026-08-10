// Visibility contract for the first-run suggestion chips (ENG-1137):
// only on a brand-new account (zero tasks, zero artifacts, onboarding
// not dismissed), and the habit-tracker chip retires once step 1 is done.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const load = async () => {
  vi.resetModules();
  const [{ default: HomeSuggestions }, store] = await Promise.all([
    import('./HomeSuggestions'),
    import('./onboardingStore'),
  ]);
  return { HomeSuggestions, store };
};

describe('HomeSuggestions', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps the step-1 send-match prefix in sync with the prompt', async () => {
    const { HABIT_TRACKER_PROMPT, HABIT_TRACKER_PREFIX } = await import('./steps');
    expect(HABIT_TRACKER_PROMPT.startsWith(HABIT_TRACKER_PREFIX)).toBe(true);
  });

  it('shows all three chips on a brand-new account', async () => {
    const { HomeSuggestions } = await load();
    render(<HomeSuggestions tasksCount={0} artifactsCount={0} onPick={vi.fn()} />);
    expect(screen.getByText('Plan my week')).toBeTruthy();
    expect(screen.getByText('Build me a habit tracker')).toBeTruthy();
    expect(screen.getByText('Draft a project brief')).toBeTruthy();
  });

  it.each([
    ['a task exists', { tasksCount: 1, artifactsCount: 0 }],
    ['an artifact exists', { tasksCount: 0, artifactsCount: 1 }],
  ])('renders nothing when %s', async (_label, counts) => {
    const { HomeSuggestions } = await load();
    const { container } = render(<HomeSuggestions {...counts} onPick={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing once onboarding is dismissed', async () => {
    localStorage.setItem('anton.onboarding.dismissed', 'true');
    const { HomeSuggestions } = await load();
    const { container } = render(<HomeSuggestions tasksCount={0} artifactsCount={0} onPick={vi.fn()} />);
    expect(container.innerHTML).toBe('');
  });

  it('drops the habit-tracker chip after onboarding step 1 completes', async () => {
    localStorage.setItem('anton.onboarding.completed', JSON.stringify(['see-it-work']));
    const { HomeSuggestions } = await load();
    render(<HomeSuggestions tasksCount={0} artifactsCount={0} onPick={vi.fn()} />);
    expect(screen.queryByText('Build me a habit tracker')).toBeNull();
    expect(screen.getByText('Plan my week')).toBeTruthy();
  });

  it('picks with the [placeholder] range selected, and none for the habit tracker', async () => {
    const { HomeSuggestions } = await load();
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<HomeSuggestions tasksCount={0} artifactsCount={0} onPick={onPick} />);

    await user.click(screen.getByText('Plan my week'));
    const [planText, planSelect] = onPick.mock.calls[0];
    expect(planText.slice(planSelect[0], planSelect[1])).toBe("[what's on your plate this week]");

    await user.click(screen.getByText('Build me a habit tracker'));
    const [habitText, habitSelect] = onPick.mock.calls[1];
    expect(habitText.startsWith('Build me a habit tracker')).toBe(true);
    expect(habitSelect).toBeNull();
  });
});
