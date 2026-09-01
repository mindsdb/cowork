import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';


const setPinned = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({ codingApi: { setPinned } }));

import { useCodeWorkspace } from './useCodeWorkspace';


function codingSession(pinned = false): CodingSession {
  return {
    schema_version: 1,
    id: 'task-1',
    title: 'Task one',
    engine_id: 'codex',
    engine_adapter_version: '1',
    model: 'gpt',
    permission_mode: 'supervised',
    status: 'completed',
    source_path: '/work/source',
    workspace_path: '/work/task-1',
    workspace_kind: 'git_worktree',
    repository_root: '/work/source',
    source_dirty: false,
    event_count: 0,
    pinned,
    created_at: '2026-08-30T10:00:00Z',
    updated_at: '2026-08-30T10:00:00Z',
  };
}


describe('useCodeWorkspace', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owns pin mutations and reconciles the canonical task collection', async () => {
    const openCode = vi.fn();
    const updated = codingSession(true);
    setPinned.mockResolvedValue(updated);
    const { result } = renderHook(() => useCodeWorkspace(openCode));

    act(() => result.current.setSessions([codingSession()]));
    await act(async () => { await result.current.setSessionPinned('task-1', true); });

    expect(setPinned).toHaveBeenCalledWith('task-1', true);
    expect(result.current.sessions).toEqual([updated]);
  });

  it('does not mutate local task state when the server rejects a pin', async () => {
    setPinned.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCodeWorkspace(vi.fn()));
    const original = codingSession();

    act(() => result.current.setSessions([original]));
    await expect(act(async () => result.current.setSessionPinned('task-1', true))).rejects.toThrow('offline');

    expect(result.current.sessions).toEqual([original]);
  });
});
