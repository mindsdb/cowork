import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useArtifactViewerComments } from './useArtifactViewerComments';

const mocks = vi.hoisted(() => ({
  useArtifactComments: vi.fn(),
  useArtifactCommentLayer: vi.fn(),
}));
vi.mock('./comments', () => mocks);

describe('useArtifactViewerComments', () => {
  let comments;
  let workspace;
  let layer;

  beforeEach(() => {
    vi.clearAllMocks();
    comments = {
      threads: [],
      unreadCount: 0,
      markRead: vi.fn(),
      setStatus: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue({ id: 'thread-1' }),
    };
    workspace = {
      mode: 'preview',
      commentsReady: false,
      currentRevision: { id: 'revision-1' },
      releaseRepairsForComment: vi.fn().mockResolvedValue(undefined),
    };
    layer = { exitMode: vi.fn() };
    mocks.useArtifactComments.mockReturnValue(comments);
    mocks.useArtifactCommentLayer.mockReturnValue(layer);
  });

  function renderComments() {
    return renderHook(({ open }) => useArtifactViewerComments({ artifactKey: 'owner/report' }, {
      open, pub: {}, workspace, iframeRef: { current: null },
    }), { initialProps: { open: true } });
  }

  it('requests a stable bridge before transport readiness but gates mutations on review controls', () => {
    const { result, rerender } = renderComments();
    expect(result.current.commentLayerRequested).toBe(true);
    expect(result.current.commentsEnabled).toBe(false);
    expect(mocks.useArtifactCommentLayer).toHaveBeenLastCalledWith(
      expect.anything(), expect.objectContaining({ enabled: false }),
    );
    workspace.commentsReady = true;
    rerender({ open: true });
    expect(result.current.commentLayerRequested).toBe(true);
    expect(mocks.useArtifactCommentLayer).toHaveBeenLastCalledWith(
      expect.anything(), expect.objectContaining({ enabled: false }),
    );
    act(() => result.current.toggleComments());
    expect(mocks.useArtifactCommentLayer).toHaveBeenLastCalledWith(
      expect.anything(), expect.objectContaining({ enabled: true }),
    );
    rerender({ open: false });
    expect(mocks.useArtifactComments).toHaveBeenLastCalledWith(
      'owner', 'report', expect.objectContaining({ enabled: false }),
    );
    expect(mocks.useArtifactCommentLayer).toHaveBeenLastCalledWith(
      expect.anything(), expect.objectContaining({ enabled: false }),
    );
  });

  it('releases repairs only after the thread resolves successfully', async () => {
    let finishStatus;
    comments.setStatus.mockReturnValue(new Promise((resolve) => { finishStatus = resolve; }));
    const { result } = renderComments();
    const statusRequest = result.current.setCommentStatus('thread-1', 'resolved');
    expect(workspace.releaseRepairsForComment).not.toHaveBeenCalled();
    finishStatus(true);
    await expect(statusRequest).resolves.toBe(true);
    expect(workspace.releaseRepairsForComment).toHaveBeenCalledWith('thread-1');
  });

  it('does not release repairs for failed resolves or other status changes', async () => {
    const { result } = renderComments();
    comments.setStatus.mockResolvedValueOnce(false);
    await expect(result.current.setCommentStatus('thread-1', 'resolved')).resolves.toBe(false);
    comments.setStatus.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current.setCommentStatus('thread-1', 'resolved')).rejects.toThrow('offline');
    await result.current.setCommentStatus('thread-1', 'open');
    expect(workspace.releaseRepairsForComment).not.toHaveBeenCalled();
  });

  it('stamps new comments with the current revision after revision changes', async () => {
    const { result, rerender } = renderComments();
    await result.current.createArtifactComment({ text: 'Feedback', revisionId: 'stale' });
    expect(comments.create).toHaveBeenLastCalledWith({ text: 'Feedback', revisionId: 'revision-1' });
    workspace.currentRevision = { id: 'revision-2' };
    rerender({ open: true });
    await result.current.createArtifactComment({ text: 'More feedback' });
    expect(comments.create).toHaveBeenLastCalledWith({ text: 'More feedback', revisionId: 'revision-2' });
  });

  it('opens and marks the inbox read in review mode, then exits comments in edit mode', () => {
    workspace.commentsReady = true;
    workspace.mode = 'review';
    comments.unreadCount = 1;
    const { result, rerender } = renderComments();
    expect(result.current.commentsOpen).toBe(true);
    expect(result.current.inboxOpen).toBe(true);
    expect(comments.markRead).toHaveBeenCalled();
    workspace.mode = 'edit';
    rerender({ open: true });
    expect(layer.exitMode).toHaveBeenCalled();
    expect(result.current.commentsOpen).toBe(false);
    expect(result.current.inboxOpen).toBe(false);
  });
});
