import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api', () => ({
  addCommentReply: vi.fn(),
  createCommentThread: vi.fn(),
  deleteCommentReply: vi.fn(),
  deleteCommentThread: vi.fn(),
  editCommentReply: vi.fn(),
  editCommentThread: vi.fn(),
  listCommentThreads: vi.fn(),
  markCommentsRead: vi.fn(),
  openCommentsStream: vi.fn(),
  setCommentThreadStatus: vi.fn(),
}));

import { listCommentThreads, openCommentsStream } from '../../../api';
import { useArtifactComments } from './useArtifactComments';

const VIEWER = { user_id: 'owner-user', email: 'owner@example.com', role: 'owner' };
const EXTERNAL_EVENT = {
  type: 'thread.updated',
  id: 'thread-1',
  actor_user_id: 'reviewer-user',
  updated_at: '2026-08-25T16:00:00Z',
  payload: { author: { user_id: 'reviewer-user' }, text: 'Please fix this.' },
};

describe('useArtifactComments unread feedback', () => {
  let streamHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    streamHandlers = null;
    listCommentThreads
      .mockResolvedValueOnce({ threads: [], viewer: VIEWER, unreadCount: 0 })
      .mockResolvedValue({ threads: [EXTERNAL_EVENT], viewer: VIEWER, unreadCount: 1 });
    openCommentsStream.mockImplementation((_userDir, _reportId, _since, handlers) => {
      streamHandlers = handlers;
      return { abort: vi.fn() };
    });
  });

  it('uses the server thread count when one unread thread emits multiple events', async () => {
    const { result } = renderHook(() => useArtifactComments('artifact', 'stable-id'));
    await waitFor(() => expect(streamHandlers).not.toBeNull());

    await act(async () => {
      streamHandlers.onEvent(EXTERNAL_EVENT);
    });
    await waitFor(() => expect(result.current.unreadCount).toBe(1));

    await act(async () => {
      streamHandlers.onEvent({ ...EXTERNAL_EVENT, updated_at: '2026-08-25T16:01:00Z' });
    });
    await waitFor(() => expect(listCommentThreads).toHaveBeenCalledTimes(3));
    expect(result.current.unreadCount).toBe(1);
  });
});

// The hook lives at the viewer level, not on the short-lived panel, so a change
// of artifact has to drop the previous one's state itself. Nothing crashes when
// it doesn't: the old threads simply keep drawing markers on the new artifact.
describe('useArtifactComments on switching artifact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openCommentsStream.mockReturnValue({ abort: vi.fn() });
  });

  it('drops the previous artifact\'s threads before the next set arrives', async () => {
    listCommentThreads
      .mockResolvedValueOnce({ threads: [{ id: 'thread-1' }], viewer: VIEWER, unreadCount: 3 })
      // The next artifact's load is still in flight — the window in which stale
      // state would be on screen.
      .mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(
      ({ reportId }) => useArtifactComments('artifact', reportId),
      { initialProps: { reportId: 'first' } },
    );
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.viewer).toEqual(VIEWER);

    rerender({ reportId: 'second' });

    expect(result.current.threads).toEqual([]);
    expect(result.current.viewer).toBeNull();
    expect(result.current.unreadCount).toBe(0);
  });
});

// A session that expired is terminal. Retrying it is invisible from the UI and
// turns one dead tab into a backoff loop hammering the server forever.
describe('useArtifactComments on a terminal auth failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    openCommentsStream.mockReturnValue({ abort: vi.fn() });
  });
  afterEach(() => vi.useRealTimers());

  it('stops for good on 401 instead of retrying', async () => {
    listCommentThreads.mockRejectedValue(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    );

    const { result } = renderHook(() => useArtifactComments('artifact', 'stable-id'));
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });

    expect(result.current.expired).toBe(true);
    expect(result.current.error).toBe('');
    expect(listCommentThreads).toHaveBeenCalledTimes(1);
    expect(openCommentsStream).not.toHaveBeenCalled();
  });
});
