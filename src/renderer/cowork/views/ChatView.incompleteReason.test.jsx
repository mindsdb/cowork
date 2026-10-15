// ENG-3436: an answer that stopped early says why, live and after a reload.
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
import { hydrateMessagesFromServerEvents } from '../lib/conversationHistory';

const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });

const persistedTurn = (response) => [
  { role: 'user', content: 'find the figure' },
  {
    role: 'assistant',
    content: 'Here is how far I got.',
    events: [{ type: 'response.created' }, { type: 'response.completed', response }],
  },
];

describe('incomplete reason under the answer', () => {
  it('names the reason on a live answer', () => {
    render(<ChatView task={taskWith([
      { role: 'user', content: 'find the figure' },
      { role: 'assistant', content: 'Here is how far I got.', incompleteReason: 'round_cap' },
    ])} />);
    expect(screen.getByRole('note')).toHaveTextContent('reached its step limit');
    expect(screen.getByText('Here is how far I got.')).toBeInTheDocument();
  });

  it('shows the same reason after a reload', () => {
    const messages = hydrateMessagesFromServerEvents(persistedTurn(
      { status: 'incomplete', incomplete_details: { reason: 'spend_ceiling' } },
    ));
    render(<ChatView task={taskWith(messages)} />);
    expect(screen.getByTestId('incomplete-reason')).toHaveTextContent('reached its token budget');
  });

  it('falls back to a generic line for a reason it does not know', () => {
    const messages = hydrateMessagesFromServerEvents(persistedTurn(
      { status: 'incomplete', incomplete_details: { reason: 'something_new' } },
    ));
    render(<ChatView task={taskWith(messages)} />);
    expect(screen.getByTestId('incomplete-reason')).toHaveTextContent('Stopped before it finished.');
  });

  it.each([
    ['a finished answer', { status: 'completed', incomplete_details: null }],
    ['a server without the change', { status: 'completed' }],
  ])('shows nothing for %s', (_label, response) => {
    render(<ChatView task={taskWith(hydrateMessagesFromServerEvents(persistedTurn(response)))} />);
    expect(screen.queryByTestId('incomplete-reason')).toBeNull();
    expect(screen.getByText('Here is how far I got.')).toBeInTheDocument();
  });
});
