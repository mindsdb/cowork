import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import MobileShell from './MobileShell';

// The mobile chrome has no room for the desktop floating-toggle-row
// (bottom-right, over the FAB) — the theme toggle moves into the top bar,
// opposite the hamburger, and the coding-mode toggle is dropped entirely
// rather than given a second spot.

const baseProps = {
  route: 'home',
  tasks: [],
  projects: [],
  scheduled: [],
  artifacts: [],
};

describe('MobileShell — top-bar theme toggle', () => {
  it('renders a theme toggle opposite the hamburger by default', () => {
    render(<MobileShell {...baseProps}>content</MobileShell>);
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument();
  });

  it('shows the light-mode icon label when theme is light', () => {
    render(<MobileShell {...baseProps} theme="light">content</MobileShell>);
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  it('calls onToggleTheme when tapped', () => {
    const onToggleTheme = vi.fn();
    render(<MobileShell {...baseProps} theme="dark" onToggleTheme={onToggleTheme}>content</MobileShell>);
    screen.getByRole('button', { name: /switch to light mode/i }).click();
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain spacer (no toggle) when showThemeToggle is false', () => {
    render(<MobileShell {...baseProps} showThemeToggle={false}>content</MobileShell>);
    expect(screen.queryByRole('button', { name: /switch to (light|dark) mode/i })).toBeNull();
  });

  it('never renders a coding-mode toggle in the mobile chrome', () => {
    render(<MobileShell {...baseProps}>content</MobileShell>);
    expect(screen.queryByRole('button', { name: /coding mode/i })).toBeNull();
  });
});

describe('MobileShell — call button and recent chats', () => {
  it('puts the browser and call buttons left of the theme toggle', () => {
    const onClick = vi.fn();
    const onShowBrowser = vi.fn();
    render(<MobileShell {...baseProps} onShowBrowser={onShowBrowser} callShortcut={{ label: 'Call Anton', onClick }}>content</MobileShell>);
    const order = [...document.querySelectorAll('.mshell__top button')].map((b) => b.getAttribute('aria-label'));
    expect(order.slice(-3)).toEqual(['Show browser', 'Call Anton', 'Switch to light mode']);
    screen.getByRole('button', { name: 'Call Anton' }).click();
    screen.getByRole('button', { name: 'Show browser' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onShowBrowser).toHaveBeenCalledTimes(1);
  });

  it('lists the 4 newest chats under Chat, and See all opens the rest in place', async () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, title: `Chat ${i}` }));
    render(<MobileShell {...baseProps} tasks={tasks}>content</MobileShell>);
    await act(async () => { screen.getByRole('button', { name: /open menu/i }).click(); });
    const chats = () => [...document.querySelectorAll('.mshell-recent-chat')];
    expect(chats().map((n) => n.textContent)).toEqual(['Chat 0', 'Chat 1', 'Chat 2', 'Chat 3']);
    await act(async () => { screen.getByRole('button', { name: 'See all 6' }).click(); });
    expect(chats()).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });
});
