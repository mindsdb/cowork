import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Host-mock pattern (ApprovalCard.test.jsx): vi.hoisted + whole-module mock.
// No mockClear/mockReset in beforeEach — vitest 4 flags caught rejections as
// unhandled with that combo; implementations are set per-test.
const api = vi.hoisted(() => ({
  fetchPendingApprovals: vi.fn(async () => []),
  fetchInFlightList: vi.fn(async () => []),
  fetchSchedules: vi.fn(async () => ({ schedules: [] })),
  fetchResolvedApprovals: vi.fn(async () => []),
  fetchExpiredApprovals: vi.fn(async () => []),
  fetchApprovalMetrics: vi.fn(async () => null),
}));
vi.mock('../../api', () => api);

import { useBoard, enrichRunning, groupShipped } from './useBoard';

describe('enrichRunning', () => {
  it('pairs in-flight rows with task topics, tolerating wire shapes', () => {
    const rows = enrichRunning(
      [
        { conversation_id: 'c1', started_at: '2026-07-23T10:00:00Z' },
        { conversationId: 'c2' },
        { nope: true },
      ],
      [{ id: 'c1', title: 'Weekly digest' }],
    );
    expect(rows).toEqual([
      { conversationId: 'c1', topic: 'Weekly digest', startedAt: '2026-07-23T10:00:00Z' },
      { conversationId: 'c2', topic: 'Untitled task', startedAt: null },
    ]);
  });

  it('handles empty/garbage input', () => {
    expect(enrichRunning(null, [])).toEqual([]);
    expect(enrichRunning(undefined, undefined)).toEqual([]);
  });
});

describe('groupShipped', () => {
  it('splits resolved approvals into today vs older', () => {
    // TZ=UTC in tests (tests/setup-env.ts), so local midnight == UTC midnight.
    const now = new Date('2026-07-23T15:00:00Z');
    const { today, older } = groupShipped([
      { id: 'a', resolvedAt: '2026-07-23T10:00:00Z' },
      { id: 'b', resolvedAt: '2026-07-22T23:59:59Z' },
      { id: 'c', resolvedAt: 'not a date' },
    ], now);
    expect(today.map((x) => x.id)).toEqual(['a']);
    expect(older.map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('useBoard', () => {
  it('composes the four columns from the feeds', async () => {
    api.fetchPendingApprovals.mockImplementation(async () => [
      { id: 'ap-1', conversationId: 'c9', kind: 'action', status: 'pending' },
    ]);
    api.fetchInFlightList.mockImplementation(async () => [
      { conversation_id: 'c1', started_at: '2026-07-23T09:00:00Z' },
    ]);
    api.fetchSchedules.mockImplementation(async () => ({
      schedules: [{ id: 's1', title: 'Digest', cadence: 'daily', enabled: true }],
    }));
    api.fetchResolvedApprovals.mockImplementation(async () => [
      { id: 'ap-2', status: 'approved', resolvedAt: new Date().toISOString() },
    ]);
    api.fetchExpiredApprovals.mockImplementation(async () => [
      { id: 'ap-3', status: 'expired' },
    ]);

    const { result } = renderHook(() => useBoard({ tasks: [{ id: 'c1', title: 'Running task' }] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.needsYou).toHaveLength(1);
    expect(result.current.running).toEqual([
      { conversationId: 'c1', topic: 'Running task', startedAt: '2026-07-23T09:00:00Z' },
    ]);
    expect(result.current.scheduled).toHaveLength(1);
    expect(result.current.shipped.today).toHaveLength(1);
    expect(result.current.shipped.older).toHaveLength(0);
    expect(result.current.expired).toHaveLength(1);
  });

  it('starts quiet when every feed is empty', async () => {
    api.fetchPendingApprovals.mockImplementation(async () => []);
    api.fetchInFlightList.mockImplementation(async () => []);
    api.fetchSchedules.mockImplementation(async () => ({ schedules: [] }));
    api.fetchResolvedApprovals.mockImplementation(async () => []);
    api.fetchExpiredApprovals.mockImplementation(async () => []);

    const { result } = renderHook(() => useBoard({ tasks: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.needsYou).toEqual([]);
    expect(result.current.running).toEqual([]);
    expect(result.current.scheduled).toEqual([]);
    expect(result.current.shipped).toEqual({ today: [], older: [] });
    expect(result.current.expired).toEqual([]);
  });

  it('refresh re-pulls the feeds', async () => {
    api.fetchInFlightList.mockImplementation(async () => []);
    api.fetchSchedules.mockImplementation(async () => ({ schedules: [] }));
    api.fetchResolvedApprovals.mockImplementation(async () => []);
    api.fetchExpiredApprovals.mockImplementation(async () => []);

    const { result } = renderHook(() => useBoard({ tasks: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    api.fetchInFlightList.mockClear();
    await act(async () => { await result.current.refresh(); });
    expect(api.fetchInFlightList).toHaveBeenCalledTimes(1);
  });

  it('polls ~10s while running is non-empty, and not when empty', async () => {
    vi.useFakeTimers();
    try {
      api.fetchInFlightList.mockImplementation(async () => [{ conversation_id: 'c1' }]);
      api.fetchSchedules.mockImplementation(async () => ({ schedules: [] }));
      api.fetchResolvedApprovals.mockImplementation(async () => []);
      api.fetchExpiredApprovals.mockImplementation(async () => []);

      const { result } = renderHook(() => useBoard({ tasks: [] }));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.running).toHaveLength(1);

      api.fetchInFlightList.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(api.fetchInFlightList).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(api.fetchInFlightList).toHaveBeenCalledTimes(2);

      // Now the run finishes — the poll must stop once the list is empty.
      api.fetchInFlightList.mockImplementation(async () => []);
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(result.current.running).toHaveLength(0);
      api.fetchInFlightList.mockClear();
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(api.fetchInFlightList).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

it('flags serverDown when every feed rejects instead of reading as calm', async () => {
  api.fetchInFlightList.mockRejectedValue(new Error('down'));
  api.fetchSchedules.mockRejectedValue(new Error('down'));
  api.fetchResolvedApprovals.mockRejectedValue(new Error('down'));
  api.fetchExpiredApprovals.mockRejectedValue(new Error('down'));
  api.fetchApprovalMetrics.mockRejectedValue(new Error('down'));
  const { result } = renderHook(() => useBoard({ tasks: [] }));
  await waitFor(() => expect(result.current.serverDown).toBe(true));
});
