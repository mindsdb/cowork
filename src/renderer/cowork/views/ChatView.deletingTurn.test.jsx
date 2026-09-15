// A turn delete takes seconds on the hosted path, so the exchange has to read
// as in flight for that whole wait. The first test closes the seam between
// App and ChatView: the index ChatView hands to onDeleteTurn is the same index
// it must accept back as deletingTurnIndex. Neither side's own test can catch
// a mismatch there — App's mocks ChatView, and .jsx is in no typecheck program.
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

const taskWith = (messages) => ({
  id: 'conv-a',
  title: 'Alpha task',
  status: 'active',
  messages,
});

const twoExchanges = [
  { role: 'user', content: 'first question' },
  { role: 'assistant', content: 'first answer' },
  { role: 'user', content: 'second question' },
  { role: 'assistant', content: 'second answer' },
];

const busyAround = (text) => screen.getByText(text).closest('[aria-busy="true"]');

describe('a turn being deleted', () => {
  it('marks the exchange whose index it just emitted', async () => {
    const user = userEvent.setup();
    const onDeleteTurn = vi.fn();
    const { rerender } = render(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={onDeleteTurn} />,
    );

    // Take the index from the component rather than assuming it: index 0 is
    // also falsy, so a truthiness check anywhere in the chain would pass every
    // other test and break the single-exchange task.
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(onDeleteTurn).toHaveBeenCalledTimes(1);
    const emitted = onDeleteTurn.mock.calls[0][0];
    expect(emitted).toBe(0);

    rerender(
      <ChatView
        task={taskWith(twoExchanges)}
        onDeleteTurn={onDeleteTurn}
        deletingTurnIndex={emitted}
      />,
    );

    expect(busyAround('first question')).not.toBeNull();
    expect(busyAround('first answer')).not.toBeNull();
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    // The exchange that is not going anywhere still reads as normal.
    expect(busyAround('second question')).toBeNull();
    expect(busyAround('second answer')).toBeNull();
  });

  it('leaves no delete affordance anywhere in the conversation while one is out', () => {
    render(
      <ChatView
        task={taskWith(twoExchanges)}
        onDeleteTurn={vi.fn()}
        deletingTurnIndex={0}
      />,
    );

    // Not just the turn being deleted: any other turn's index is about to be
    // reindexed by the server, so its delete would remove the wrong exchange.
    expect(screen.queryAllByRole('button', { name: 'Delete' })).toHaveLength(0);
  });

  it('restores the affordance once the delete is no longer in flight', () => {
    const { rerender } = render(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={vi.fn()} deletingTurnIndex={0} />,
    );
    expect(screen.queryByText('Deleting…')).toBeInTheDocument();

    rerender(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={vi.fn()} deletingTurnIndex={null} />,
    );
    expect(screen.queryByText('Deleting…')).not.toBeInTheDocument();
    expect(busyAround('first question')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);
  });

  it('marks an orphan user turn, which has no answer bubble to carry the label', async () => {
    const user = userEvent.setup();
    const onDeleteTurn = vi.fn();
    const orphan = [{ role: 'user', content: 'stopped before any answer' }];
    const { rerender } = render(
      <ChatView task={taskWith(orphan)} onDeleteTurn={onDeleteTurn} />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const emitted = onDeleteTurn.mock.calls[0][0];

    rerender(
      <ChatView task={taskWith(orphan)} onDeleteTurn={onDeleteTurn} deletingTurnIndex={emitted} />,
    );
    expect(busyAround('stopped before any answer')).not.toBeNull();
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
  });

  it('announces the delete outside the busy subtree, where a reader can hear it', () => {
    const { rerender } = render(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={vi.fn()} />,
    );
    // Selected by its own hook: artifact cards each render a role="status"
    // region too, and theirs precede this one in document order.
    // Mounted before the delete starts: a live region inserted at the moment
    // it should speak is not reliably announced. It also has to sit outside
    // the aria-busy turn, which tells a reader to hold off on that subtree.
    const live = screen.getByTestId('delete-turn-status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live.textContent).toBe('');
    expect(live.closest('[aria-busy="true"]')).toBeNull();

    rerender(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={vi.fn()} deletingTurnIndex={0} />,
    );
    const liveAfter = screen.getByTestId('delete-turn-status');
    expect(liveAfter.textContent).toMatch(/deleting/i);
    expect(liveAfter.closest('[aria-busy="true"]')).toBeNull();
  });

  it('marks a carded failure, not only the generic error bubble', () => {
    const rateLimited = [
      { role: 'user', content: 'ask me' },
      { role: 'error', content: 'Too many requests', code: 'rate_limited' },
    ];
    render(
      <ChatView task={taskWith(rateLimited)} onDeleteTurn={vi.fn()} deletingTurnIndex={0} />,
    );

    // A failed exchange is a likely delete target, and its answer half is a
    // card rather than the generic error bubble.
    expect(busyAround('ask me')).not.toBeNull();
    expect(document.querySelectorAll('.answer-turn[aria-busy="true"]')).toHaveLength(1);
  });

  it('leaves no action toolbar on the turn being deleted', () => {
    render(
      <ChatView task={taskWith(twoExchanges)} onDeleteTurn={vi.fn()} deletingTurnIndex={0} />,
    );

    // Copy goes too: the exchange is on its way out, so its toolbar is not
    // something to offer.
    const busy = document.querySelectorAll('[aria-busy="true"]');
    expect(busy.length).toBeGreaterThan(0);
    busy.forEach((node) => {
      expect(node.querySelector('button[aria-label="Copy"]')).toBeNull();
    });
    // The surviving exchange keeps its own toolbar.
    expect(screen.getAllByRole('button', { name: 'Copy' }).length).toBeGreaterThan(0);
  });

  it('marks both halves of a failed exchange, not just the question', () => {
    const failed = [
      { role: 'user', content: 'draw me a chart' },
      { role: 'error', content: 'The turn failed before it produced anything.', code: 'server_error' },
    ];
    render(
      <ChatView task={taskWith(failed)} onDeleteTurn={vi.fn()} deletingTurnIndex={0} />,
    );

    expect(busyAround('draw me a chart')).not.toBeNull();
    expect(busyAround('The turn failed before it produced anything.')).not.toBeNull();
  });
});
