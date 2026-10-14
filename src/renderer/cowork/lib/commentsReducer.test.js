// The realtime-merge contract for artifact comment threads. Pure, and trusted
// by every consumer (useArtifactComments, useArtifactCommentLayer,
// CommentsPanel, InboxCard), so it is tested directly per CLAUDE.md §Testing.
//
// None of these have a visible failure mode: a dropped SSE event just looks
// like a slow server, a resurrected deleted thread looks like someone else's
// comment, and a jumping timestamp looks like a rendering quirk.

import { describe, expect, it } from 'vitest';
import {
  maxUpdatedAt,
  normalizeThreadForLayer,
  upsertThread,
  viewerCanEdit,
} from './commentsReducer';

const thread = (over = {}) => ({
  id: 'thread-1',
  status: 'open',
  selector: null,
  version: 1,
  updated_at: '2026-08-25T12:00:00+00:00',
  payload: {
    author: { user_id: 'author-user', email: 'author@example.com' },
    text: 'Please clarify the outcome.',
    replies: [],
  },
  ...over,
});

describe('upsertThread', () => {
  it('appends a thread it has never seen', () => {
    const created = thread({ type: 'thread.created' });

    expect(upsertThread([], created)).toEqual([created]);
  });

  it('replaces the held thread when the event is newer', () => {
    const held = thread();
    const newer = thread({ version: 2, payload: { ...held.payload, text: 'Edited.' } });

    expect(upsertThread([held], newer)).toEqual([newer]);
  });

  // The idempotency / reorder guard. After a reconnect the server replays from
  // the `since` cursor, so the client sees versions it already holds; applying
  // them would clobber anything newer that arrived in between.
  it('ignores an event whose version is not ahead of the held one', () => {
    const held = thread({ version: 3 });
    const list = [held];

    expect(upsertThread(list, thread({ version: 3 }))).toBe(list);
    expect(upsertThread(list, thread({ version: 2 }))).toBe(list);
  });

  it('removes the thread on thread.deleted', () => {
    const other = thread({ id: 'thread-2' });

    expect(upsertThread([thread(), other], { type: 'thread.deleted', id: 'thread-1' }))
      .toEqual([other]);
  });

  // A delete that arrives twice, or for a thread this client never loaded.
  it('leaves the set untouched when deleting an id it does not hold', () => {
    const list = [thread()];

    expect(upsertThread(list, { type: 'thread.deleted', id: 'thread-9' })).toBe(list);
  });

  it('ignores an event with no id', () => {
    const list = [thread()];

    expect(upsertThread(list, { type: 'thread.updated' })).toBe(list);
    expect(upsertThread(undefined, { type: 'thread.updated' })).toEqual([]);
  });
});

describe('maxUpdatedAt', () => {
  it('returns the latest timestamp, and an empty cursor for an empty set', () => {
    const loaded = [
      thread({ id: 'a', updated_at: '2026-08-25T12:00:00+00:00' }),
      thread({ id: 'b', updated_at: '2026-08-25T14:30:00+00:00' }),
      thread({ id: 'c', updated_at: '2026-08-25T09:15:00+00:00' }),
    ];

    expect(maxUpdatedAt(loaded)).toBe('2026-08-25T14:30:00+00:00');
    expect(maxUpdatedAt([])).toBe('');
    expect(maxUpdatedAt(undefined)).toBe('');
  });
});

describe('normalizeThreadForLayer', () => {
  // The injected layer renders the popover timestamp off `created_at`. Falling
  // back to `updated_at` made it jump forward on every reply and status change.
  it('prefers created_at and falls back to updated_at', () => {
    const created = '2026-08-24T09:00:00+00:00';
    const updated = '2026-08-26T18:00:00+00:00';
    const epoch = (iso) => Math.floor(Date.parse(iso) / 1000);

    expect(normalizeThreadForLayer(thread({ created_at: created, updated_at: updated })).created_at)
      .toBe(epoch(created));
    expect(normalizeThreadForLayer(thread({ updated_at: updated })).created_at)
      .toBe(epoch(updated));
  });

  it('flattens replies and tolerates an author without a user_id', () => {
    const source = thread({
      selector: '#chart > tbody tr:nth-child(2)',
      payload: {
        author: { email: 'author@example.com' },
        text: 'Please clarify the outcome.',
        edited_at: '2026-08-26T08:00:00+00:00',
        replies: [{
          id: 'reply-1',
          author: { email: 'reviewer@example.com' },
          text: 'Done.',
          created_at: '2026-08-26T09:00:00+00:00',
        }],
      },
    });

    expect(normalizeThreadForLayer(source)).toMatchObject({
      id: 'thread-1',
      // The layer anchors its pin off this, so it has to survive the flatten.
      selector: '#chart > tbody tr:nth-child(2)',
      author: 'author@example.com',
      author_user_id: null,
      text: 'Please clarify the outcome.',
      edited_at: '2026-08-26T08:00:00+00:00',
      replies: [{
        id: 'reply-1',
        author: 'reviewer@example.com',
        author_user_id: null,
        text: 'Done.',
        created_at: Math.floor(Date.parse('2026-08-26T09:00:00+00:00') / 1000),
      }],
    });
  });
});

describe('viewerCanEdit', () => {
  it('matches on user_id regardless of type', () => {
    expect(viewerCanEdit({ author: { user_id: '42' } }, { user_id: 42 })).toBe(true);
    expect(viewerCanEdit({ author: { user_id: 'a' } }, { user_id: 'b' })).toBe(false);
  });

  // Both sides must be identified. Without this, a viewer the server could not
  // identify would be offered edit/delete on an authorless payload — controls
  // the service then refuses, which reads as the app being broken.
  it('refuses when either side has no user_id', () => {
    expect(viewerCanEdit({ author: {} }, { user_id: 'someone' })).toBe(false);
    expect(viewerCanEdit({ author: { user_id: 'someone' } }, null)).toBe(false);
    expect(viewerCanEdit(null, null)).toBe(false);
  });
});
