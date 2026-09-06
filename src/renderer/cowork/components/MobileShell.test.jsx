import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import MobileShell from './MobileShell';

// Mobile moves theme control into the top bar and omits the desktop coding-mode toggle.

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
