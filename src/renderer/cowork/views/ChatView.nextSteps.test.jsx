// Next steps under the latest finished answer.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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

const TABLE = 'Here are the grants.\n\n| Funder | Deadline |\n| --- | --- |\n| A | Dec 31 |';
const taskWith = (messages, extra = {}) => ({ id: 'conv-a', title: 'Alpha', status: 'active', projectId: 'p1', messages, ...extra });
const tableTurn = [
  { id: 'u1', role: 'user', content: 'Find open grants for my NGO' },
  { id: 'a1', role: 'assistant', content: TABLE, steps: [] },
];
const row = () => screen.queryByTestId('next-steps');

describe('next steps under an answer', () => {
  it('offers a page and a schedule after a table, and sends the page step without typing', () => {
    const onSend = vi.fn();
    render(<ChatView task={taskWith(tableTurn)} onSend={onSend} onScheduleFromChat={vi.fn()} />);
    expect(row()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn it into a page' }));
    expect(onSend).toHaveBeenCalledWith('Turn this into a web page I can share.', []);
  });

  it('offers a page after a table written without outer pipes, which the chat renders as a table', () => {
    const { container } = render(<ChatView
      task={taskWith([
        { id: 'u1', role: 'user', content: 'Find open grants for my NGO' },
        { id: 'a1', role: 'assistant', content: 'Here they are.\n\nFunder | Deadline\n--- | ---\nA | Dec 31', steps: [] },
      ])}
      onSend={vi.fn()}
      onScheduleFromChat={vi.fn()}
    />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Turn it into a page' })).toBeInTheDocument();
  });

  it('opens the schedule form with the message the answer replied to', () => {
    const onScheduleFromChat = vi.fn();
    render(<ChatView task={taskWith(tableTurn)} onSend={vi.fn()} onScheduleFromChat={onScheduleFromChat} />);
    fireEvent.click(screen.getByRole('button', { name: 'Run this on a schedule' }));
    expect(onScheduleFromChat).toHaveBeenCalledWith({ prompt: 'Find open grants for my NGO', projectId: 'p1', answerKey: 'conv-a:m:a1' });
  });

  it('leaves the schedule step out where no schedule form is wired', () => {
    render(<ChatView task={taskWith(tableTurn)} onSend={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Run this on a schedule' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn it into a page' })).toBeInTheDocument();
  });

  it('shows only under the latest answer', () => {
    render(<ChatView
      task={taskWith([...tableTurn, { id: 'u2', role: 'user', content: 'thanks' }, { id: 'a2', role: 'assistant', content: 'You are welcome.' }])}
      onSend={vi.fn()}
      onScheduleFromChat={vi.fn()}
    />);
    expect(row()).toBeNull();
  });

  it('offers only a page after a follow-up, never a schedule', () => {
    render(<ChatView
      task={taskWith([
        { id: 'u0', role: 'user', content: 'hi' },
        { id: 'a0', role: 'assistant', content: 'Hello! What can I do?' },
        ...tableTurn,
      ])}
      onSend={vi.fn()}
      onScheduleFromChat={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Turn it into a page' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run this on a schedule' })).toBeNull();
  });

  it('offers no schedule when earlier history is not loaded, since the first message is unknown', () => {
    render(<ChatView task={taskWith(tableTurn, { hasMoreMessages: true })} onSend={vi.fn()} onScheduleFromChat={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Run this on a schedule' })).toBeNull();
  });

  it('shows nothing while the conversation is still running', () => {
    render(<ChatView task={taskWith(tableTurn)} onSend={vi.fn()} inFlightSet={new Set(['conv-a'])} />);
    expect(row()).toBeNull();
  });

  it('shows nothing after an answer that stopped early', () => {
    render(<ChatView
      task={taskWith([tableTurn[0], { ...tableTurn[1], incompleteReason: 'round_cap' }])}
      onSend={vi.fn()}
    />);
    expect(row()).toBeNull();
  });

  it('shows nothing where no message can be sent', () => {
    render(<ChatView task={taskWith(tableTurn)} />);
    expect(row()).toBeNull();
  });
});
