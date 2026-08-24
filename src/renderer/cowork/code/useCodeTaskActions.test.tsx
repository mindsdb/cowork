import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CodingSession } from './api';
import { useCodeTaskActions } from './useCodeTaskActions';


function renderActions({
  refresh = vi.fn(async () => {}),
  loadSessions = vi.fn(async () => []),
}: {
  refresh?: () => Promise<void>;
  loadSessions?: () => Promise<CodingSession[]>;
} = {}) {
  return renderHook(() => useCodeTaskActions({
    selectedId: 'task-1',
    session: null,
    refresh,
    loadSessions,
    onSessionsChange: vi.fn(),
    onSelectionChange: vi.fn(),
  }));
}


describe('useCodeTaskActions', () => {
  it('does not report a successful mutation as failed when list reconciliation drops', async () => {
    const loadSessions = vi.fn(async () => { throw new Error('temporary list failure'); });
    const action = vi.fn(async () => {});
    const { result } = renderActions({ loadSessions });

    await act(async () => {
      await expect(result.current.run(action, true, true)).resolves.toBeUndefined();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain('The operation completed');
    expect(result.current.error).toContain('temporary list failure');
  });

  it('returns a successful result when only detail refresh fails', async () => {
    const action = vi.fn(async () => ({ status: 'applied' }));
    const refresh = vi.fn(async () => { throw new Error('temporary detail failure'); });
    const { result } = renderActions({ refresh });
    let resolved: { status: string } | undefined;

    await act(async () => {
      resolved = await result.current.runResult(action, false, true);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual({ status: 'applied' });
    expect(result.current.error).toContain('The operation completed');
    expect(result.current.error).toContain('temporary detail failure');
  });

  it('still rethrows a mutation failure so the composer can restore its draft', async () => {
    const action = vi.fn(async () => { throw new Error('turn rejected'); });
    const { result } = renderActions();

    await act(async () => {
      await expect(result.current.run(action, true, true)).rejects.toThrow('turn rejected');
    });

    expect(result.current.error).toBe('turn rejected');
  });
});
