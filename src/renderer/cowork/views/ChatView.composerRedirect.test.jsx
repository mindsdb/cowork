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

const task = (id, adoptedFromId) => ({
  id,
  title: `Task ${id}`,
  messages: [],
  status: 'idle',
  ...(adoptedFromId ? { adoptedFromId } : {}),
});

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
  // A brand-new task before the server has minted its id, and the rename that
  // follows. App.jsx's adoptServerId stamps `adoptedFromId` so a rename can be
  // told apart from a switch to a different conversation.
  const [adoptedFrom, setAdoptedFrom] = useState(null);
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
      <button
        type="button"
        onClick={() => { setAdoptedFrom(null); setOpenTaskId('tmp-9'); }}
      >
        open brand-new task
      </button>
      <button
        type="button"
        onClick={() => { setAdoptedFrom('tmp-9'); setOpenTaskId('conv-9'); }}
      >
        adopt server id
      </button>
      {mounted ? (
        <ChatView
          task={task(openTaskId, adoptedFrom)}
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

    // App keeps one ChatView instance across task switches, so the draft
    // carries over; clear it first to keep the assertion unambiguous.
    await user.clear(composer());
    await user.click(screen.getByText('switch task'));

    await waitFor(() => expect(composer().value).toBe('other task text'));
  });

  it('does not append one task\'s restored text onto another task\'s draft', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // A draft typed in t1 — which is still in the box after switching, because
    // App keeps one Composer instance for every conversation.
    await user.click(composer());
    await user.keyboard('draft for t1');

    // t-other drained while t1 was on screen, and only reaches its composer when
    // the user opens it. Appending there would splice another conversation's
    // queued messages into what the user was writing.
    await user.click(screen.getByText('fire other redirect'));
    await user.click(screen.getByText('switch task'));

    await waitFor(() => expect(composer().value).toBe('other task text'));
  });

  it('replaces a carried-over draft even when the task is opened first', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The other order: switch first, then the drain lands. The draft in the box
    // still belongs to t1, so ownership cannot be inferred from "did the task id
    // change on this run".
    await user.click(composer());
    await user.keyboard('draft for t1');
    await user.click(screen.getByText('switch task'));
    expect(composer().value).toBe('draft for t1');

    await user.click(screen.getByText('fire other redirect'));

    await waitFor(() => expect(composer().value).toBe('other task text'));
  });

  it('does not treat a brand-new task\'s draft as belonging to another task', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The draft was typed in a task whose id is still the pre-adoption `tmp-…`
    // form. That says it was typed in SOME brand-new conversation — not in the
    // one being opened next, which is what a bare `tmp-` prefix check assumed.
    await user.click(screen.getByText('open brand-new task'));
    await user.click(composer());
    await user.keyboard('draft in the brand-new task');
    await user.click(screen.getByText('fire redirect'));

    // Opening t1, which has a pending redirect: its restored text must replace
    // the other conversation's draft, not be spliced onto it.
    await user.click(screen.getByText('switch task'));

    await waitFor(() => expect(composer().value).toBe('queued one'));
  });

  it('keeps a pre-adoption draft when the server renames the conversation', async () => {
    const user = userEvent.setup();
    render(<Harness taskId="conv-9" />);

    // Typed before `response.created`, so it is attributed to the tmp- id…
    await user.click(screen.getByText('open brand-new task'));
    await user.click(composer());
    await user.keyboard('typed before adoption');

    // …and the rename must carry that attribution over, or this task's own drain
    // would wipe the draft it is supposed to be handed back alongside.
    await user.click(screen.getByText('adopt server id'));
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

    // Navigate away and back — ChatView is conditionally mounted in App.jsx,
    // so its guard refs reset. A signal the parent still held would re-prefill.
    await user.click(screen.getByText('toggle mount'));
    expect(composer()).toBeNull();
    await user.click(screen.getByText('toggle mount'));

    await waitFor(() => expect(composer()).not.toBeNull());
    expect(composer().value).toBe('');
  });
});
