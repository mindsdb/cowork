// Rows without an id (error cards, optimistic sends) must keep their React key
// when an older page is prepended, or their local state is lost or handed to
// a different row. The host mock is module-level, hence its own file.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchHealth: vi.fn(async () => ({ status: 'ok' })),
}));

vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isWeb: false,
    host: { ...actual.host, mindshubFinalize: vi.fn(async () => ({ ok: true })) },
  };
});

import ChatView from './ChatView';

const authFailure = { role: 'error', code: 'provider_auth', reconnectable: true, content: 'Session expired' };
const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'idle', hasMoreMessages: false, messages });

describe('id-less rows across a prepend', () => {
  it('a reconnect card that already reconnected stays reconnected when older messages load', async () => {
    const user = userEvent.setup();
    const newest = [
      { role: 'user', id: 'u2', content: 'Turn two question' },
      { role: 'assistant', id: 'a2', content: '', events: [] },
      authFailure,
    ];
    const { rerender } = render(<ChatView task={taskWith(newest)} />);
    await user.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(await screen.findByText('Reconnected')).toBeInTheDocument();

    rerender(<ChatView task={taskWith([
      { role: 'user', id: 'u1', content: 'Turn one question' },
      { role: 'assistant', id: 'a1', content: 'Turn one answer' },
      ...newest,
    ])} />);

    expect(screen.getByText('Reconnected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});
