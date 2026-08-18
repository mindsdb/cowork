// Light/dark toggle in the task header: the floating corner toggle
// (App.jsx) hides itself on the task route since it competes with the
// composer/task content there, so the task view needs its own way to flip
// theme without a trip to Settings. Same theme/onThemeChange App.jsx
// already owns and hands to the Display settings modal.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

import ChatView from './ChatView';

const task = {
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages: [],
};

describe('ChatView — light/dark toggle in the header', () => {
  it('shows a sun icon (switch to light) in dark mode', () => {
    render(<ChatView task={task} theme="dark" onThemeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('shows a moon icon (switch to dark) in light mode', () => {
    render(<ChatView task={task} theme="light" onThemeChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('calls onThemeChange with the opposite theme when clicked', async () => {
    const user = userEvent.setup();
    const onThemeChange = vi.fn();
    render(<ChatView task={task} theme="dark" onThemeChange={onThemeChange} />);

    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('renders no toggle when onThemeChange is not provided', () => {
    render(<ChatView task={task} theme="dark" />);
    expect(screen.queryByRole('button', { name: /switch to (light|dark) mode/i })).not.toBeInTheDocument();
  });
});
