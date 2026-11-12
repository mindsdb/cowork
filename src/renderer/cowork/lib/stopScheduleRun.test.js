import { describe, expect, it, vi } from 'vitest';
import { stopScheduleRun } from './stopScheduleRun';

function deps(runs, { fetchFails = false, cancelResult = { status: 'ok' } } = {}) {
  return {
    fetchRuns: vi.fn(async () => {
      if (fetchFails) throw new Error('offline');
      return { runs };
    }),
    cancel: vi.fn(async () => cancelResult),
    refresh: vi.fn(async () => {}),
  };
}

describe('stopScheduleRun', () => {
  it('cancels the running run’s conversation and refreshes', async () => {
    const d = deps([{ status: 'running', conversationId: 'c1' }]);
    await stopScheduleRun('s1', d);
    expect(d.fetchRuns).toHaveBeenCalledWith('s1', { limit: 5, strict: true });
    expect(d.cancel).toHaveBeenCalledWith('c1');
    expect(d.refresh).toHaveBeenCalled();
  });

  it('says so when the run has no conversation to stop yet', async () => {
    const d = deps([{ status: 'running', conversationId: null }]);
    await expect(stopScheduleRun('s1', d)).rejects.toThrow('The run is still starting');
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('says so when the runs can’t be read', async () => {
    const d = deps([], { fetchFails: true });
    await expect(stopScheduleRun('s1', d)).rejects.toThrow('Couldn’t reach the server');
    expect(d.cancel).not.toHaveBeenCalled();
  });

  it('says so when the cancel fails', async () => {
    const d = deps([{ status: 'running', conversationId: 'c1' }], { cancelResult: { status: 'error' } });
    await expect(stopScheduleRun('s1', d)).rejects.toThrow('Couldn’t stop the run');
  });

  it('just refreshes when the run already ended', async () => {
    const d = deps([{ status: 'success', conversationId: 'c1' }]);
    await stopScheduleRun('s1', d);
    expect(d.cancel).not.toHaveBeenCalled();
    expect(d.refresh).toHaveBeenCalled();
  });
});
