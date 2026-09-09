import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

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

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

const scratchpadStep = {
  id: 'step-1',
  label: 'Running code',
  badge: 'Script',
  icon: 'code',
  status: 'in_progress',
  startedAt: 1,
  completedAt: null,
  data: null,
  output: null,
  result: null,
  _isScratchpad: true,
  _scratchpadTabId: null,
  _toolUseId: 'tu-1',
};

// The in-flight indicator must not resize when reasoning traces start.
// Both the pre-step placeholder and the active-with-steps state render
// through the SAME ThinkingBlock header (a collapsible button with
// aria-expanded), so the header box is identical across the transition.
// The placeholder used to be a bare WorkingIndicator with no header
// padding, which made the indicator jump ~8px the moment the first step
// arrived (a layout shift on every request).
describe('in-flight thinking indicator uses one consistent header box', () => {
  it('pre-step placeholder renders inside the collapsible thinking header', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: '',
            steps: [],
            currentThought: null,
            streamStatus: 'in_progress',
            _placeholderLabel: 'Creating task…',
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    const header = container.querySelector('button[aria-expanded]');
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('Creating task…');
  });

  it('active-with-steps state renders through the same header element', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: '',
            steps: [scratchpadStep],
            currentThought: null,
            streamStatus: 'in_progress',
            startedAt: 1,
          },
        ])}
        onSend={vi.fn()}
      />,
    );

    // Same header box as the placeholder — the collapsible thinking header.
    expect(container.querySelector('button[aria-expanded]')).not.toBeNull();
  });
});
