import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  title: 'Side task title',
  status: 'idle',
  messages: [
    { role: 'user', content: 'Build the dashboard' },
    { role: 'assistant', content: 'Here is the dashboard.' },
  ],
};

// A comparison side shows only its transcript: the Compare screen owns the
// header, the one composer both sides share, and the side panel.
describe('ChatView pane mode', () => {
  it('renders the transcript without the task chrome', () => {
    const { container } = render(<ChatView pane task={task} onSend={vi.fn()} />);
    expect(screen.getByText('Build the dashboard')).toBeTruthy();
    expect(screen.getByText('Here is the dashboard.')).toBeTruthy();
    expect(container.querySelector('.chat-floating-composer')).toBeNull();
    expect(container.querySelector('.chat-rail-aside')).toBeNull();
    expect(screen.queryByLabelText('Expand panel')).toBeNull();
    expect(screen.queryByText('Side task title')).toBeNull();
    // No column held open for a rail that is not there.
    expect(container.firstChild.className).not.toContain('320px');
  });

  it('keeps the full task view by default', () => {
    const { container } = render(<ChatView task={task} onSend={vi.fn()} />);
    expect(container.querySelector('.chat-floating-composer')).not.toBeNull();
    expect(container.querySelector('.chat-rail-aside')).not.toBeNull();
    expect(screen.getByText('Side task title')).toBeTruthy();
  });
});
