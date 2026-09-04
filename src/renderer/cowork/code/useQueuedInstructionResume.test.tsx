import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const runQueued = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ codingApi: { runQueued } }));

import { useQueuedInstructionResume } from './useQueuedInstructionResume';


function queuedSession(status: CodingSession['status'] = 'completed', id = 'task-1'): CodingSession {
  return {
    schema_version: 1,
    id,
    title: 'Queued task',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt-5.6-sol',
    permission_mode: 'supervised',
    status,
    source_path: `/work/${id}`,
    workspace_path: `/work/${id}`,
    workspace_kind: 'direct_folder',
    source_dirty: false,
    queued_instructions: [{ id: `${id}-queue-1`, prompt: 'Run tests', created_at: '2026-08-23T09:00:00Z' }],
    event_count: 0,
    created_at: '2026-08-23T09:00:00Z',
    updated_at: '2026-08-23T09:00:00Z',
  };
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}


afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});


describe('useQueuedInstructionResume', () => {
  it('retries a persisted queue after a transient failure', async () => {
    vi.useFakeTimers();
    runQueued.mockRejectedValueOnce(new Error('sidecar restarting')).mockResolvedValueOnce(queuedSession('running'));
    const refresh = vi.fn(async () => {});
    const onError = vi.fn();
    renderHook(() => useQueuedInstructionResume(queuedSession(), refresh, onError));

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('sidecar restarting');

    await act(async () => { vi.advanceTimersByTime(1_000); await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('treats a queue-head conflict as already started', async () => {
    vi.useFakeTimers();
    runQueued.mockRejectedValueOnce(Object.assign(new Error('That queued instruction is no longer next in the queue'), { status: 409 }));
    const refresh = vi.fn(async () => {});
    const onError = vi.fn();
    renderHook(() => useQueuedInstructionResume(queuedSession(), refresh, onError));

    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued).toHaveBeenCalledWith('task-1', 'task-1-queue-1');
    expect(refresh).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued).toHaveBeenCalledTimes(1);
  });

  it('leaves queue progression to the server while a turn is active', async () => {
    renderHook(() => useQueuedInstructionResume(queuedSession('running'), vi.fn(async () => {}), vi.fn()));
    await act(async () => { await Promise.resolve(); });
    expect(runQueued).not.toHaveBeenCalled();
  });

  it('sends the same queued instruction once while the session re-renders mid-request', async () => {
    const pending = deferred<CodingSession>();
    runQueued.mockReturnValueOnce(pending.promise);
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ session }: { session: CodingSession }) => useQueuedInstructionResume(session, refresh, vi.fn()),
      { initialProps: { session: queuedSession('completed') } },
    );

    rerender({ session: queuedSession('ready') });
    expect(runQueued).toHaveBeenCalledTimes(1);

    pending.resolve(queuedSession('running'));
    await act(async () => { await pending.promise; });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores a resume response that arrives after switching tasks', async () => {
    const first = deferred<CodingSession>();
    const second = deferred<CodingSession>();
    runQueued.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ session }: { session: CodingSession }) => useQueuedInstructionResume(session, refresh, vi.fn()),
      { initialProps: { session: queuedSession('completed', 'task-1') } },
    );

    rerender({ session: queuedSession('completed', 'task-2') });
    expect(runQueued).toHaveBeenCalledTimes(2);

    first.resolve(queuedSession('running', 'task-1'));
    await act(async () => { await first.promise; });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('retries a failed instruction once after its backoff even when the task is left and revisited', async () => {
    vi.useFakeTimers();
    runQueued.mockRejectedValueOnce(new Error('sidecar restarting')).mockResolvedValue(queuedSession('running'));
    const { rerender } = renderHook(
      ({ session }: { session: CodingSession }) => useQueuedInstructionResume(session, vi.fn(async () => {}), vi.fn()),
      { initialProps: { session: queuedSession('completed', 'task-1') } },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued).toHaveBeenCalledTimes(1);

    rerender({ session: queuedSession('completed', 'task-2') });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    rerender({ session: queuedSession('completed', 'task-1') });
    expect(runQueued).toHaveBeenCalledTimes(2);

    await act(async () => { vi.advanceTimersByTime(60_000); await Promise.resolve(); await Promise.resolve(); });
    expect(runQueued.mock.calls.filter(([id]) => id === 'task-1')).toHaveLength(2);
    expect(runQueued).toHaveBeenCalledTimes(3);
  });

  it('keeps a pending resume in flight when the task is left and revisited', async () => {
    const pending = deferred<CodingSession>();
    runQueued.mockReturnValueOnce(pending.promise).mockReturnValue(new Promise(() => {}));
    const refresh = vi.fn(async () => {});
    const { rerender } = renderHook(
      ({ session }: { session: CodingSession }) => useQueuedInstructionResume(session, refresh, vi.fn()),
      { initialProps: { session: queuedSession('completed', 'task-1') } },
    );

    rerender({ session: queuedSession('completed', 'task-2') });
    rerender({ session: queuedSession('completed', 'task-1') });
    expect(runQueued.mock.calls.filter(([id]) => id === 'task-1')).toHaveLength(1);

    pending.resolve(queuedSession('running', 'task-1'));
    await act(async () => { await pending.promise; });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
