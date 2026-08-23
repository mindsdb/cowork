import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const runQueued = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ codingApi: { runQueued } }));

import { useQueuedInstructionResume } from './useQueuedInstructionResume';


function queuedSession(status: CodingSession['status'] = 'completed'): CodingSession {
  return {
    schema_version: 1,
    id: 'task-1',
    title: 'Queued task',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt-5.6-sol',
    permission_mode: 'supervised',
    status,
    source_path: '/work/task-1',
    workspace_path: '/work/task-1',
    workspace_kind: 'direct_folder',
    source_dirty: false,
    queued_instructions: [{ id: 'queue-1', prompt: 'Run tests', created_at: '2026-08-23T09:00:00Z' }],
    event_count: 0,
    created_at: '2026-08-23T09:00:00Z',
    updated_at: '2026-08-23T09:00:00Z',
  };
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

  it('leaves queue progression to the server while a turn is active', async () => {
    renderHook(() => useQueuedInstructionResume(queuedSession('running'), vi.fn(async () => {}), vi.fn()));
    await act(async () => { await Promise.resolve(); });
    expect(runQueued).not.toHaveBeenCalled();
  });
});
