import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCodeTaskActions } from './useCodeTaskActions';


function renderActions(loadSessions = vi.fn(async () => [])) {
  return renderHook(() => useCodeTaskActions({
    selectedId: 'task-1',
    session: null,
    refresh: vi.fn(async () => {}),
    loadSessions,
    onSessionsChange: vi.fn(),
    onSelectionChange: vi.fn(),
  }));
}


describe('useCodeTaskActions', () => {
  it('does not report a successful mutation as failed when list reconciliation drops', async () => {
    const loadSessions = vi.fn(async () => { throw new Error('temporary list failure'); });
    const action = vi.fn(async () => {});
    const { result } = renderActions(loadSessions);

    await act(async () => {
      await expect(result.current.run(action, true, true)).resolves.toBeUndefined();
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain('The operation completed');
    expect(result.current.error).toContain('temporary list failure');
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
