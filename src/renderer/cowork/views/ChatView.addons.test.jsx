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

// ENG-4208: the add-on row, queue chips and paused chips, state by state.
describe('add-on row states', () => {
  const renderSaved = (state) => render(
    <ChatView
      task={taskWith([
        { role: 'user', content: 'build the report' },
        { role: 'assistant', content: 'Done.', startedAt: 1000, steps: [addonStep(state)] },
      ])}
      agentLabel="Anton"
      onSend={vi.fn()}
    />,
  );

  it.each([
    ['sending', 'Sending…', true],
    ['added', 'Added to current task', false],
    ['withdrawing', 'Moving to queue…', true],
    ['read', 'Read by Anton', false],
    ['returned', 'Moved to queue', false],
    ['withdrawn', 'Moved to queue', false],
    ['saved', 'Added to current task', false],
  ])('%s reads "%s"', (state, label, dimmed) => {
    renderSaved(state);
    const row = screen.getByTestId('addon-row');
    expect(row).toHaveAttribute('data-addon-state', state);
    expect(row).toHaveTextContent('use the sales DB');
    const status = within(row).getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(label);
    // A request still out shows dimmed.
    expect(row.className.includes('opacity-70')).toBe(dimmed);
  });

  it('names the agent the person set', () => {
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'build the report' },
          { role: 'assistant', content: 'Done.', startedAt: 1000, steps: [addonStep('read')] },
        ])}
        agentLabel="Jarvis"
        onSend={vi.fn()}
      />,
    );
    expect(within(screen.getByTestId('addon-row')).getByRole('status')).toHaveTextContent('Read by Jarvis');
  });
});

describe('Move to queue on an add-on row', () => {
  const renderLive = (step, onMoveAddonToQueue = vi.fn()) => {
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'build the report' },
          { role: '_streaming', content: '', streamStatus: 'in_progress', startedAt: 1000, steps: [step] },
        ])}
        agentLabel="Anton"
        onMoveAddonToQueue={onMoveAddonToQueue}
        onSend={vi.fn()}
      />,
    );
    return onMoveAddonToQueue;
  };
  const moveButton = () => screen.queryByRole('button', { name: 'Move to queue' });

  it('is offered on this client\'s unread message in the running turn', async () => {
    const onMove = renderLive(addonStep('added', { own: true, decided_by: 'user' }));
    await userEvent.setup().click(moveButton());
    expect(onMove).toHaveBeenCalledWith('ad1', 'use the sales DB', 'user');
  });

  it.each(['sending', 'withdrawing', 'read', 'returned', 'withdrawn'])('is not offered once it is %s', (state) => {
    renderLive(addonStep(state, { own: true }));
    expect(moveButton()).toBeNull();
  });

  it('is not offered on a message another client sent', () => {
    renderLive(addonStep('added'));
    expect(screen.getByTestId('addon-row')).toHaveTextContent('Added to current task');
    expect(moveButton()).toBeNull();
  });

  it('is not offered before the server has given the message an id', () => {
    renderLive(addonStep('added', { own: true, addon_id: null }));
    expect(moveButton()).toBeNull();
  });

  it('is not offered on a finished turn', () => {
    render(
      <ChatView
        task={taskWith([
          { role: 'user', content: 'build the report' },
          { role: 'assistant', content: 'Done.', startedAt: 1000, steps: [addonStep('added', { own: true })] },
        ])}
        agentLabel="Anton"
        onMoveAddonToQueue={vi.fn()}
        onSend={vi.fn()}
      />,
    );
    expect(moveButton()).toBeNull();
  });
});

describe('queue chips', () => {
  const live = taskWith([
    { role: 'user', content: 'build the report' },
    { role: '_streaming', content: '', streamStatus: 'in_progress', steps: [] },
  ]);
  const idle = taskWith([
    { role: 'user', content: 'build the report' },
    { role: 'assistant', content: 'Done.' },
  ]);
  const renderQueue = (queuedMessages, props = {}) => render(
    <ChatView task={live} queuedMessages={queuedMessages} agentLabel="Anton" onSend={vi.fn()} {...props} />,
  );

  it('says why a message waits on hover, in one tooltip', async () => {
    renderQueue([{ id: 'q1', text: 'make a new deck', queuedReason: 'next_task' }]);
    const chip = screen.getByTestId('queued-chip');
    // The reason replaces the native title: two tooltips at once overlap.
    expect(chip).not.toHaveAttribute('title');
    const reason = within(chip).getByTestId('queued-reason');
    expect(reason).toHaveAttribute('data-reason', 'separate');
    await userEvent.setup().hover(reason);
    expect((await screen.findAllByText('Queued: this looks like a separate request, so it runs after the current task.')).length)
      .toBeGreaterThan(0);
  });

  it('keeps the full text as the title of a message the person queued themselves', () => {
    renderQueue([{ id: 'q1', text: 'a message I queued', queuedReason: 'moved' }]);
    const chip = screen.getByTestId('queued-chip');
    expect(chip).toHaveAttribute('title', 'a message I queued');
    expect(within(chip).queryByTestId('queued-reason')).toBeNull();
  });

  it('adds a queued message to the running task', async () => {
    const onAddQueuedToTask = vi.fn();
    renderQueue([{ id: 'q1', text: 'skip the chart' }], { onAddQueuedToTask });
    await userEvent.setup().click(within(screen.getByTestId('queued-chip')).getByRole('button', { name: 'Add to current task' }));
    expect(onAddQueuedToTask).toHaveBeenCalledWith('q1');
  });

  it('shows the chip as pending while its request is out', () => {
    renderQueue([{ id: 'q1', text: 'skip the chart', addonPending: true }], { onAddQueuedToTask: vi.fn() });
    const chip = screen.getByTestId('queued-chip');
    expect(chip).toHaveAttribute('aria-busy', 'true');
    expect(within(chip).getByRole('status', { name: 'Adding to current task' })).toBeInTheDocument();
    expect(within(chip).queryByRole('button', { name: 'Add to current task' })).toBeNull();
  });

  it.each([
    ['the task is not running', { task: idle }, {}],
    ['it has files', {}, { attachments: [{ id: 'f1', name: 'q3.csv' }] }],
    ['the conversation has no server id yet', { task: { ...live, id: 'tmp-1' } }, {}],
  ])('does not offer Add to current task when %s', (_case, props, item) => {
    renderQueue([{ id: 'q1', text: 'skip the chart', ...item }], { onAddQueuedToTask: vi.fn(), ...props });
    expect(screen.queryByRole('button', { name: 'Add to current task' })).toBeNull();
  });
});

describe('paused chips', () => {
  const live = taskWith([
    { role: 'user', content: 'build the report' },
    { role: '_streaming', content: '', streamStatus: 'in_progress', steps: [] },
  ]);
  const paused = { id: 'q1', text: 'maybe added', paused: true, unconfirmed: true };

  it('says why it waits, in one tooltip', async () => {
    render(<ChatView task={live} queuedMessages={[paused]} onResendQueued={vi.fn()} onSend={vi.fn()} />);
    const chip = screen.getByTestId('queued-chip');
    expect(chip).not.toHaveAttribute('title');
    await userEvent.setup().hover(within(chip).getByTestId('queued-unconfirmed'));
    expect((await screen.findAllByText("Couldn't confirm whether this was added. Send it again?")).length).toBeGreaterThan(0);
  });

  it('sends it again on the person\'s say-so', async () => {
    const onResendQueued = vi.fn();
    render(<ChatView task={live} queuedMessages={[paused]} onResendQueued={onResendQueued} onSend={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send again' }));
    expect(onResendQueued).toHaveBeenCalledWith('q1');
  });

  it('is shown even after the turn ends, still offering Send again', () => {
    const idle = taskWith([
      { role: 'user', content: 'build the report' },
      { role: 'assistant', content: 'Done.' },
    ]);
    render(<ChatView task={idle} queuedMessages={[paused]} onResendQueued={vi.fn()} onSend={vi.fn()} />);
    expect(screen.getByTestId('queued-chip')).toHaveAttribute('data-paused', 'true');
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument();
  });
});
