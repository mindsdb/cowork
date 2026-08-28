import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
