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
import { moveDraft, __resetDraftsForTests } from '../lib/draftStore';

const task = (id) => ({
  id,
  title: `Task ${id}`,
  messages: [],
  status: 'idle',
});

/**
 * Mirrors App.jsx's ownership of the redirect map: the parent holds it,
 * ChatView consumes its own key, and consuming deletes just that key.
 * `mounted` models App's `route === 'task'` conditional mount so a remount can
 * be exercised; `openTaskId` models navigating between conversations.
 *
 * "adopt server id" models App's `adoptServerId`: `moveDraft` carries the draft
 * from the pre-adoption `tmp-` surface onto the id the server minted, then the
 * task is renamed. That pairing is the whole of the rename handling now — the
 * composer's text lives in the per-surface draft store, so nothing else has to
 * be told a rename is not a switch to a different conversation.
 */
function Harness({ taskId = 't1', onConsumed }) {
  const [redirects, setRedirects] = useState({});
  const [mounted, setMounted] = useState(true);
  const [openTaskId, setOpenTaskId] = useState('t1');
  const bump = useRef(0);
  const fire = (tid, text, attachments) => setRedirects((prev) => {
    bump.current += 1;
    return { ...prev, [tid]: { text, attachments, bump: bump.current } };
  });
  return (
    <>
      <button type="button" onClick={() => fire(taskId, 'queued one')}>fire redirect</button>
      <button type="button" onClick={() => fire('t-other', 'other task text')}>
        fire other redirect
      </button>
      <button
        type="button"
        onClick={() => fire(taskId, 'queued one', [{ id: 'a1', name: 'notes.txt' }])}
      >
        fire redirect with files
      </button>
      <button type="button" onClick={() => setMounted((m) => !m)}>toggle mount</button>
      <button type="button" onClick={() => setOpenTaskId((t) => (t === 't1' ? 't-other' : 't1'))}>
        switch task
      </button>
      <button type="button" onClick={() => setOpenTaskId('t1')}>open t1</button>
      <button type="button" onClick={() => setOpenTaskId('tmp-9')}>open brand-new task</button>
      <button
        type="button"
        onClick={() => { moveDraft('tmp-9', 'conv-9'); setOpenTaskId('conv-9'); }}
      >
        adopt server id
      </button>
      {mounted ? (
        <ChatView
          task={task(openTaskId)}
          onSend={vi.fn()}
          composerRedirects={redirects}
          onComposerRedirectConsumed={(tid, attachments) => {
            onConsumed?.(tid, attachments);
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

// The draft store is module-level, so without this each test inherits the
// previous one's typing (which is what made this file red once ENG-1221 landed).
beforeEach(() => { __resetDraftsForTests(); });

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

  it('hands the drained files to the parent when it consumes the entry', async () => {
    // The files ride the same per-task entry as the text: the app-wide staged
    // list is not keyed by task, so staging them any earlier would put them on
    // whichever conversation is open.
    const user = userEvent.setup();
    const onConsumed = vi.fn();
    render(<Harness onConsumed={onConsumed} />);

    await user.click(screen.getByText('fire redirect with files'));

    await waitFor(() => expect(onConsumed).toHaveBeenCalledTimes(1));
    expect(onConsumed).toHaveBeenCalledWith('t1', [{ id: 'a1', name: 'notes.txt' }]);
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

    // Opening t-other shows ITS draft (empty) plus its own restored text — t1's
    // restored text stays under t1's key rather than being carried into the box.
    await user.click(screen.getByText('switch task'));

    await waitFor(() => expect(composer().value).toBe('other task text'));
  });

  it('does not splice one task\'s restored text into another task\'s draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // A draft typed in t1. The composer instance is shared across conversations,
    // but its value comes from the per-surface draft store, so switching swaps
    // the text rather than carrying it.
    await user.click(composer());
    await user.keyboard('draft for t1');

    // t-other drained while t1 was on screen, and only reaches its composer when
    // the user opens it. It must join t-other's own draft, and leave t1's alone.
    await user.click(screen.getByText('fire other redirect'));
    await user.click(screen.getByText('switch task'));
    await waitFor(() => expect(composer().value).toBe('other task text'));

    await user.click(screen.getByText('switch task'));
    await waitFor(() => expect(composer().value).toBe('draft for t1'));
  });

  it('shows this task\'s own draft after a switch, and appends the drain to that', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The invariant the ownership bookkeeping was replaced by: whatever is in
    // the box after a switch belongs to the task on screen, whichever order the
    // switch and the drain arrive in.
    await user.click(composer());
    await user.keyboard('draft for t1');
    await user.click(screen.getByText('switch task'));
    expect(composer().value).toBe('');
    await user.click(composer());
    await user.keyboard('typed in t-other');

    await user.click(screen.getByText('switch task'));
    await waitFor(() => expect(composer().value).toBe('draft for t1'));
    await user.click(screen.getByText('fire redirect'));

    await waitFor(() => expect(composer().value).toBe('draft for t1\nqueued one'));
  });

  it('leaves a brand-new task\'s draft alone when another task drains', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The draft was typed in a task whose id is still the pre-adoption `tmp-…`
    // form, i.e. on its own surface like any other conversation.
    await user.click(screen.getByText('open brand-new task'));
    await user.click(composer());
    await user.keyboard('draft in the brand-new task');
    await user.click(screen.getByText('fire redirect'));

    // Opening t1, which has a pending redirect: its restored text lands on t1's
    // (empty) draft, and the brand-new task's draft is still there afterwards.
    await user.click(screen.getByText('open t1'));
    await waitFor(() => expect(composer().value).toBe('queued one'));

    await user.click(screen.getByText('open brand-new task'));
    await waitFor(() => expect(composer().value).toBe('draft in the brand-new task'));
  });

  it('keeps a pre-adoption draft when the server renames the conversation', async () => {
    const user = userEvent.setup();
    render(<Harness taskId="conv-9" />);

    // Typed before `response.created`, so it sits under the tmp- surface…
    await user.click(screen.getByText('open brand-new task'));
    await user.click(composer());
    await user.keyboard('typed before adoption');

    // …and adoptServerId's moveDraft has to carry it onto the minted id, or this
    // task's own drain appends to an empty box and the draft is gone.
    await user.click(screen.getByText('adopt server id'));
    await waitFor(() => expect(composer().value).toBe('typed before adoption'));
    await user.click(screen.getByText('fire redirect'));

    await waitFor(() => expect(composer().value).toBe('typed before adoption\nqueued one'));
  });

  it('still appends to a draft the user typed in this task', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The property the append exists for: a drain hands text BACK to the user,
    // so it must not destroy the draft they are mid-typing in THIS conversation.
    await user.click(screen.getByText('switch task'));
    await user.click(composer());
    await user.keyboard('typed in t-other');
    await user.click(screen.getByText('fire other redirect'));

    await waitFor(() => expect(composer().value).toBe('typed in t-other\nother task text'));
  });

  it('does not re-apply a consumed redirect when ChatView remounts', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText('fire redirect'));
    await waitFor(() => expect(composer().value).toBe('queued one'));
    // Emptied so the assertion after the remount is about the redirect and not
    // about the draft store legitimately restoring the text it holds.
    await user.clear(composer());

    // Navigate away and back — ChatView is conditionally mounted in App.jsx,
    // so its guard refs reset. A signal the parent still held would re-prefill.
    await user.click(screen.getByText('toggle mount'));
    expect(composer()).toBeNull();
    await user.click(screen.getByText('toggle mount'));

    await waitFor(() => expect(composer()).not.toBeNull());
    expect(composer().value).toBe('');
  });
});
