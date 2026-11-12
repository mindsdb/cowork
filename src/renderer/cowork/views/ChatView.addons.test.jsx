import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

// Messages sent while Anton was working (ENG-4194), as ChatView shows them.
const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });
const addonStep = (state, extra = {}) => ({
  id: 'addon-k1', label: '', badge: 'Addon', status: 'completed', startedAt: 2000, completedAt: 2000,
  data: { addon_id: 'ad1', local_key: 'k1', text: 'use the sales DB', state, decided_by: 'jev', ...extra },
});

describe('a saved add-on with no turn on the page', () => {
  it('is labelled as added to the task, in words', () => {
    render(
      <ChatView
        task={taskWith([
          { id: 'u2', role: 'user', content: 'use the sales DB', _addon: { decidedBy: 'jev' } },
        ])}
        agentLabel="Anton"
        onSend={vi.fn()}
      />,
    );
    const note = screen.getByTestId('addon-note');
    expect(note).toHaveTextContent('Added to current task');
    expect(note.textContent).not.toMatch(/undefined/);
  });
});

describe('an add-on row inside the turn', () => {
  const renderRow = (state) => render(
    <ChatView
      task={taskWith([
        { role: 'user', content: 'build the report' },
        { role: 'assistant', content: 'Done.', startedAt: 1000, steps: [addonStep(state)] },
      ])}
      agentLabel="Anton"
      onSend={vi.fn()}
    />,
  );

  it('announces its status politely', () => {
    renderRow('read');
    const row = screen.getByTestId('addon-row');
    const status = within(row).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Read by Anton');
  });

  it('shows a withdrawn message as moved to the queue', () => {
    renderRow('withdrawn');
    expect(within(screen.getByTestId('addon-row')).getByRole('status')).toHaveTextContent('Moved to queue');
  });
});

describe('the queue strip', () => {
  const live = taskWith([
    { role: 'user', content: 'build the report' },
    { role: '_streaming', content: '', streamStatus: 'in_progress', steps: [] },
  ]);

  it('hides the slot a mid-task send holds while the turn shows it', () => {
    render(
      <ChatView
        task={live}
        queuedMessages={[{ id: 'q1', text: 'held slot', addonOffer: true, addonPending: true }]}
        onSend={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('queued-chip')).toBeNull();
  });

  it('offers to send an unconfirmed message again', async () => {
    const onResendQueued = vi.fn();
    render(
      <ChatView
        task={live}
        queuedMessages={[{ id: 'q1', text: 'maybe added', paused: true, unconfirmed: true }]}
        onAddQueuedToTask={vi.fn()}
        onResendQueued={onResendQueued}
        onSend={vi.fn()}
      />,
    );
    const chip = screen.getByTestId('queued-chip');
    expect(chip).toHaveAttribute('data-paused', 'true');
    // Not offered to the task again while its fate is unknown.
    expect(within(chip).queryByRole('button', { name: 'Add to current task' })).toBeNull();
    await userEvent.setup().click(within(chip).getByRole('button', { name: 'Send again' }));
    expect(onResendQueued).toHaveBeenCalledWith('q1');
  });
});
