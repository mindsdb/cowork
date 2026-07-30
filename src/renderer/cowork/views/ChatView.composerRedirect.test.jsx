import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

import ChatView, { isRedirectForTask } from './ChatView';

const task = (id) => ({ id, title: `Task ${id}`, messages: [], status: 'idle' });

/**
 * Mirrors App.jsx's ownership of the signal: the parent holds it, ChatView
 * consumes it, and consuming clears it back to null. `mounted` models the
 * `route === 'task'` conditional mount so a remount can be exercised.
 */
function Harness({ taskId = 't1', onConsumed }) {
  const [redirect, setRedirect] = useState(null);
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setRedirect({ taskId, text: 'queued one', bump: 1 })}>
        fire redirect
      </button>
      <button type="button" onClick={() => setMounted((m) => !m)}>toggle mount</button>
      {mounted ? (
        <ChatView
          task={task('t1')}
          onSend={vi.fn()}
          composerRedirect={redirect}
          onComposerRedirectConsumed={() => { onConsumed?.(); setRedirect(null); }}
        />
      ) : null}
    </>
  );
}

const composer = () => document.querySelector('textarea');

beforeEach(() => { /* cleanup is automatic (tests/setup-renderer.ts) */ });

describe('isRedirectForTask', () => {
  it('accepts a signal aimed at the task on screen', () => {
    expect(isRedirectForTask({ taskId: 't1', text: 'x', bump: 1 }, 't1')).toBe(true);
  });

  it('rejects a signal aimed at another task, and null signals', () => {
    expect(isRedirectForTask({ taskId: 't2', text: 'x', bump: 1 }, 't1')).toBe(false);
    expect(isRedirectForTask(null, 't1')).toBe(false);
    expect(isRedirectForTask({ taskId: 't1', text: 'x', bump: 1 }, undefined)).toBe(false);
  });
});

describe('ChatView composer redirect', () => {
  it('appends the restored text to the live draft instead of replacing it', async () => {
    const user = userEvent.setup();
    const onConsumed = vi.fn();
    render(<Harness onConsumed={onConsumed} />);

    await user.click(composer());
    await user.keyboard('half-written thought');
    await user.click(screen.getByText('fire redirect'));

    await waitFor(() => expect(composer().value).toBe('half-written thought\nqueued one'));
    expect(onConsumed).toHaveBeenCalledTimes(1);
  });

  it('ignores a redirect aimed at a task that is not on screen', async () => {
    const user = userEvent.setup();
    const onConsumed = vi.fn();
    render(<Harness taskId="t2" onConsumed={onConsumed} />);

    await user.click(composer());
    await user.keyboard('my draft');
    await user.click(screen.getByText('fire redirect'));

    expect(composer().value).toBe('my draft');
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it('does not re-apply a consumed redirect when ChatView remounts', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText('fire redirect'));
    await waitFor(() => expect(composer().value).toBe('queued one'));

    // Navigate away and back — ChatView is conditionally mounted in App.jsx,
    // so its guard refs reset. A signal the parent still held would re-prefill.
    await user.click(screen.getByText('toggle mount'));
    expect(composer()).toBeNull();
    await user.click(screen.getByText('toggle mount'));

    await waitFor(() => expect(composer()).not.toBeNull());
    expect(composer().value).toBe('');
  });
});
