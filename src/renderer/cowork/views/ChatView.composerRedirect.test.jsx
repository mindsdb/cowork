import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, useRef } from 'react';
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

import ChatView, { redirectForTask } from './ChatView';

const task = (id) => ({ id, title: `Task ${id}`, messages: [], status: 'idle' });

/**
 * Mirrors App.jsx's ownership of the redirect map: the parent holds it,
 * ChatView consumes its own key, and consuming deletes just that key.
 * `mounted` models App's `route === 'task'` conditional mount so a remount can
 * be exercised; `openTaskId` models navigating between conversations.
 */
function Harness({ taskId = 't1', onConsumed }) {
  const [redirects, setRedirects] = useState({});
  const [mounted, setMounted] = useState(true);
  const [openTaskId, setOpenTaskId] = useState('t1');
  const bump = useRef(0);
  const fire = (tid, text) => setRedirects((prev) => {
    bump.current += 1;
    return { ...prev, [tid]: { text, bump: bump.current } };
  });
  return (
    <>
      <button type="button" onClick={() => fire(taskId, 'queued one')}>fire redirect</button>
      <button type="button" onClick={() => fire('t-other', 'other task text')}>
        fire other redirect
      </button>
      <button type="button" onClick={() => setMounted((m) => !m)}>toggle mount</button>
      <button type="button" onClick={() => setOpenTaskId((t) => (t === 't1' ? 't-other' : 't1'))}>
        switch task
      </button>
      {mounted ? (
        <ChatView
          task={task(openTaskId)}
          onSend={vi.fn()}
          composerRedirects={redirects}
          onComposerRedirectConsumed={(tid) => {
            onConsumed?.(tid);
            setRedirects((prev) => {
              if (!prev[tid]) return prev;
              const next = { ...prev };
              delete next[tid];
              return next;
            });
          }}
        />
      ) : null}
    </>
  );
}

const composer = () => document.querySelector('textarea');

beforeEach(() => { /* cleanup is automatic (tests/setup-renderer.ts) */ });

describe('redirectForTask', () => {
  const redirects = { t1: { text: 'for one', bump: 1 }, t2: { text: 'for two', bump: 2 } };

  it('looks up only the entry for the task on screen', () => {
    expect(redirectForTask(redirects, 't1')).toEqual({ text: 'for one', bump: 1 });
    expect(redirectForTask(redirects, 't2')).toEqual({ text: 'for two', bump: 2 });
  });

  it('is null for a task with no pending redirect, and for empty inputs', () => {
    expect(redirectForTask(redirects, 't3')).toBeNull();
    expect(redirectForTask(null, 't1')).toBeNull();
    expect(redirectForTask({}, 't1')).toBeNull();
    expect(redirectForTask(redirects, undefined)).toBeNull();
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

  it('keeps an unconsumed redirect for another task until that task is opened', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // Task t-other drains while the user is looking at t1 — nothing consumes
    // it — and then t1 drains too. A single shared slot would have dropped
    // t-other's text at this point.
    await user.click(screen.getByText('fire other redirect'));
    await user.click(screen.getByText('fire redirect'));
    await waitFor(() => expect(composer().value).toBe('queued one'));

    // App keeps one ChatView instance across task switches, so the draft
    // carries over; clear it first to keep the assertion unambiguous.
    await user.clear(composer());
    await user.click(screen.getByText('switch task'));

    await waitFor(() => expect(composer().value).toBe('other task text'));
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
