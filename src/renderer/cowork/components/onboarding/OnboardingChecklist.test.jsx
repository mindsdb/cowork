// Dismissability contract for the sidebar checklist (ENG-1502): the card
// closes at any time without spawning chats, and a done step can't start
// duplicate chats on re-click.
// Platform contract (ENG-1778): desktopOnly steps are hidden on web, and
// the counts/completion follow the visible steps.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const hostMock = vi.hoisted(() => ({ isWeb: false }));
vi.mock('../../../platform/host', () => ({ host: hostMock }));

const load = async () => {
  vi.resetModules();
  const { default: OnboardingChecklist } = await import('./OnboardingChecklist');
  return { OnboardingChecklist };
};

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    localStorage.clear();
    hostMock.isWeb = false;
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

  it('shows all steps on desktop', async () => {
    const { OnboardingChecklist } = await load();
    render(<OnboardingChecklist onStartChat={vi.fn()} />);

    expect(screen.getByText('See Cowork work')).toBeTruthy();
    expect(screen.getByText('Customize Cowork to your role')).toBeTruthy();
    expect(screen.getByText('Connect an app')).toBeTruthy();
    // The folder step is gone on purpose: no host can deliver its promise
    // yet (ENG-1852) — restore one when ENG-384/ENG-497 ship.
    expect(screen.queryByText('Point it at a folder')).toBeNull();
    expect(screen.getByText('0/3')).toBeTruthy();
  });

  it('hides the desktopOnly steps on web and counts only the visible ones', async () => {
    hostMock.isWeb = true;
    const { OnboardingChecklist } = await load();
    render(<OnboardingChecklist onStartChat={vi.fn()} />);

    expect(screen.getByText('See Cowork work')).toBeTruthy();
    expect(screen.getByText('Customize Cowork to your role')).toBeTruthy();
    expect(screen.queryByText('Connect an app')).toBeNull();
    expect(screen.getByText('0/2')).toBeTruthy();
  });

  it('completes at 2/2 on web after the two visible steps', async () => {
    hostMock.isWeb = true;
    const { OnboardingChecklist } = await load();
    const onStartChat = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingChecklist onStartChat={onStartChat} />);

    await user.click(screen.getByText('See Cowork work'));
    await user.click(screen.getByText('Customize Cowork to your role'));

    expect(onStartChat).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/got the basics/)).toBeTruthy();
  });

  it('does not complete on desktop after only the two web-visible steps', async () => {
    const { OnboardingChecklist } = await load();
    const user = userEvent.setup();
    render(<OnboardingChecklist onStartChat={vi.fn()} />);

    await user.click(screen.getByText('See Cowork work'));
    await user.click(screen.getByText('Customize Cowork to your role'));

    expect(screen.queryByText(/got the basics/)).toBeNull();
    expect(screen.getByText('2/3')).toBeTruthy();
  });
});
