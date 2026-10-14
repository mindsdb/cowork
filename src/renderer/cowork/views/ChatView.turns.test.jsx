// The workhorse pieces of a chat turn: the user's bubble, the long-message
// clamp, and the copy / edit / delete actions on each side of an exchange.
// Written against roles and labels so they hold across the shared
// components/chat primitives that both chat surfaces render.
import { describe, it, expect, vi, afterEach } from 'vitest';
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
vi.mock('../lib/clipboard', async (importOriginal) => ({
  ...(await importOriginal()),
  copyText: vi.fn(async () => true),
}));

import ChatView from './ChatView';
import { copyText } from '../lib/clipboard';

const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });

const exchange = [
  { role: 'user', id: 'u1', content: 'Please **summarise** the report' },
  { role: 'assistant', id: 'a1', content: 'Here is the summary.' },
];

afterEach(() => vi.mocked(copyText).mockClear());

describe('a chat turn', () => {
  it('renders the user message as markdown', () => {
    render(<ChatView task={taskWith(exchange)} />);
    expect(screen.getByText('summarise').tagName).toBe('STRONG');
  });

  it('copies the answer from its own actions', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(exchange)} />);
    const answer = screen.getByText('Here is the summary.').closest('.answer-turn');
    await user.click(within(answer).getByRole('button', { name: /^copy/i }));
    expect(copyText).toHaveBeenLastCalledWith('Here is the summary.');
  });

  it('copies the user message from its own actions', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(exchange)} />);
    const bubble = screen.getByText('summarise').closest('.user-turn');
    await user.click(within(bubble).getByRole('button', { name: /^copy/i }));
    expect(copyText).toHaveBeenLastCalledWith('Please **summarise** the report');
  });

  it('puts the user message back in the composer to edit and resend', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith(exchange)} />);
    await user.click(screen.getByRole('button', { name: /edit and resend/i }));
    expect(screen.getByRole('textbox')).toHaveValue('Please **summarise** the report');
  });

  it('deletes an exchange from the answer, and an unanswered message from itself', async () => {
    const user = userEvent.setup();
    const onDeleteTurn = vi.fn();
    const orphan = [...exchange, { role: 'user', id: 'u2', content: 'Still there?' }];
    render(<ChatView task={taskWith(orphan)} onDeleteTurn={onDeleteTurn} />);
    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    expect(deletes).toHaveLength(2);
    await user.click(deletes[0]);
    await user.click(deletes[1]);
    expect(onDeleteTurn.mock.calls.map((c) => c[0])).toEqual(['a1', 'u2']);
  });
});

describe('a long user message', () => {
  // happy-dom does no layout; the clamp measures scrollHeight against its cap.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', original);
    else delete HTMLElement.prototype.scrollHeight;
  });

  it('clamps behind Show more and expands on request', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 600; } });
    const user = userEvent.setup();
    render(<ChatView task={taskWith([{ role: 'user', id: 'u1', content: 'A very long pasted prompt' }])} />);
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows no toggle when the message fits', () => {
    render(<ChatView task={taskWith([{ role: 'user', id: 'u1', content: 'Short' }])} />);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});
