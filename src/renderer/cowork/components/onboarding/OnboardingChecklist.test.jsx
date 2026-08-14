// Dismissability contract for the sidebar checklist (ENG-1502): the card
// closes at any time without spawning chats, and a done step can't start
// duplicate chats on re-click.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const load = async () => {
  vi.resetModules();
  const { default: OnboardingChecklist } = await import('./OnboardingChecklist');
  return { OnboardingChecklist };
};

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('closes from the header X without starting any chat', async () => {
    const { OnboardingChecklist } = await load();
    const onStartChat = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<OnboardingChecklist onStartChat={onStartChat} />);

    await user.click(screen.getByLabelText('Close checklist'));

    expect(container.innerHTML).toBe('');
    expect(onStartChat).not.toHaveBeenCalled();
    expect(localStorage.getItem('anton.onboarding.dismissed')).toBe('true');
  });

  it('does not start a duplicate chat when a done step is clicked again', async () => {
    const { OnboardingChecklist } = await load();
    const onStartChat = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingChecklist onStartChat={onStartChat} />);

    const step = screen.getByText('See Cowork work');
    await user.click(step);
    await user.click(step);

    expect(onStartChat).toHaveBeenCalledTimes(1);
  });
});
