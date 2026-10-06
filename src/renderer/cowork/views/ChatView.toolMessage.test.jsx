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

const row = (id, label, startedAt, completedAt, status = 'completed') => ({
  id, label, badge: 'ToolProgress', icon: 'code', status, startedAt, completedAt,
  data: null, output: null, result: null,
  _isScratchpad: false, _isToolCall: false, _scratchpadTabId: 'tc_1',
});
const brief = (id, markdown, at) => ({
  id, label: '', badge: 'Message', status: 'completed', startedAt: at, completedAt: at,
  data: { markdown }, output: null, result: null,
  _isScratchpad: false, _isToolCall: false, _toolUseId: 'tc_1',
});
const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });
const inOrder = (container, texts) => {
  const text = container.textContent;
  let from = 0;
  for (const t of texts) {
    const at = text.indexOf(t, from);
    if (at === -1) return false;
    from = at + t.length;
  }
  return true;
};
const headers = (container) => [...container.querySelectorAll('.answer-turn button[aria-expanded]')];

describe('a tool message renders as an agent message between the steps', () => {
  it('completed turn: the brief sits between the work and the reply, once', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: 'Done.',
            startedAt: 1000,
            steps: [
              row('step-1', 'Preparing a short brief for you', 1000, 5000),
              brief('step-2', 'BRIEF-TEXT assumptions', 5000),
              row('step-3', 'Writing down the requirements (step 1 of 4)', 5000, 9000),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );
    expect(inOrder(container, ['BRIEF-TEXT assumptions', 'Done.'])).toBe(true);
    expect(container.textContent.split('BRIEF-TEXT').length - 1).toBe(1);
  });

  it('live turn: the working header stays below the brief', () => {
    const { container } = render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'hi' },
          {
            role: '_streaming',
            content: 'Let me build it.',
            streamStatus: 'in_progress',
            steps: [
              row('step-1', 'Preparing a short brief for you', 1000, 5000),
              brief('step-2', 'BRIEF-TEXT assumptions', 5000),
            ],
          },
        ])}
        onSend={vi.fn()}
      />,
    );
    // One header for the finished work above the brief, one live header below it.
    const [finished, liveHeader] = headers(container);
    expect(headers(container).length).toBe(2);
    const briefNode = [...container.querySelectorAll('*')]
      .find((el) => el.children.length === 0 && el.textContent.includes('BRIEF-TEXT'));
    expect(briefNode).toBeTruthy();
    expect(finished.compareDocumentPosition(briefNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(briefNode.compareDocumentPosition(liveHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
