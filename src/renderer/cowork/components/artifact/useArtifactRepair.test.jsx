import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArtifactRepair } from './useArtifactRepair';

vi.mock('../../api', () => ({ allocateConversationId: () => 'repair-chat' }));

describe('useArtifactRepair polling', () => {
  let workspace;

  beforeEach(() => {
    vi.useFakeTimers();
    workspace = {
      supported: true,
      repair: { id: 'repair-1', status: 'queued' },
      refreshRepair: vi.fn().mockResolvedValue({ repair: { status: 'queued' } }),
    };
  });

  afterEach(() => vi.useRealTimers());

  function renderRepair() {
    return renderHook(({ open }) => useArtifactRepair({ id: 'artifact-1' }, {
      open,
      workspace,
      comments: { threads: [] },
      diagnostics: { errors: [] },
      setError: vi.fn(),
    }), { initialProps: { open: true } });
  }

  it('polls queued repairs and stops when a suggestion is ready', async () => {
    const { unmount } = renderRepair();
    await act(() => vi.advanceTimersByTimeAsync(1199));
    expect(workspace.refreshRepair).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(1);
    workspace.refreshRepair.mockResolvedValue({ repair: { status: 'ready' } });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('backs off after an error and clears pending polling on close', async () => {
    workspace.refreshRepair.mockRejectedValueOnce(new Error('offline'));
    const { rerender } = renderRepair();
    await act(() => vi.advanceTimersByTimeAsync(1200));
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(2);
    rerender({ open: false });
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(2);
  });

  it.each(['close', 'unmount'])('does not restart an in-flight poll after %s', async (action) => {
    let finishRefresh;
    workspace.refreshRepair.mockReturnValue(new Promise((resolve) => { finishRefresh = resolve; }));
    const { rerender, unmount } = renderRepair();
    await act(() => vi.advanceTimersByTimeAsync(1200));
    if (action === 'close') rerender({ open: false });
    else unmount();
    await act(async () => { finishRefresh({ repair: { status: 'queued' } }); });
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(workspace.refreshRepair).toHaveBeenCalledTimes(1);
  });
});
