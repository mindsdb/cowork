import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const workspaceUsage = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ codingApi: { workspaceUsage } }));

import { diskUsageLabel, formatBytes, taskDiskUsage, useWorkspaceUsage } from './workspaceUsage';

const measured = {
  items: [{ session_id: 'task-1', bytes: 1_288_490_189 }],
  total_bytes: 19_327_352_832,
  measured_at: '2026-10-15T01:00:00Z',
  measuring: false,
};

describe('workspace disk usage', () => {
  afterEach(() => {
    vi.useRealTimers();
    workspaceUsage.mockReset();
  });

  it('formats sizes compactly', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(740 * 1024 * 1024)).toBe('740 MB');
    expect(formatBytes(1_288_490_189)).toBe('1.2 GB');
  });

  it('labels a task with its share and the total, or says it is still measuring', () => {
    expect(diskUsageLabel(taskDiskUsage(measured, 'task-1'))).toBe('~1.2 GB · 18 GB across tasks');
    expect(diskUsageLabel(taskDiskUsage({ ...measured, items: [], measuring: true }, 'task-1'))).toBe('Measuring…');
    expect(diskUsageLabel(taskDiskUsage({ ...measured, items: [] }, 'task-1'))).toBe('Not measured yet');
    expect(taskDiskUsage(null, 'task-1')).toBeNull();
  });

  it('names the recovery share and says when a newer measurement is on its way', () => {
    const page = {
      ...measured,
      items: [{ session_id: 'task-1', bytes: 1_288_490_189, recovery_bytes: 314_572_800 }],
      measuring: true,
    };
    expect(diskUsageLabel(taskDiskUsage(page, 'task-1'))).toBe('~1.2 GB (300 MB recovery) · 18 GB across tasks · updating…');
    // Older servers send neither field.
    expect(taskDiskUsage(measured, 'task-1')?.recoveryBytes).toBe(0);
  });

  it('asks again while the server is measuring, then stops', async () => {
    vi.useFakeTimers();
    workspaceUsage
      .mockResolvedValueOnce({ items: [], total_bytes: 0, measured_at: null, measuring: true })
      .mockResolvedValueOnce(measured);

    const { result } = renderHook(() => useWorkspaceUsage('task-1'));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current?.measuring).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(result.current).toEqual(measured);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(workspaceUsage).toHaveBeenCalledTimes(2);
  });

  it('fetches nothing without a task, and shows nothing if the server cannot answer', async () => {
    renderHook(() => useWorkspaceUsage(null));
    expect(workspaceUsage).not.toHaveBeenCalled();

    workspaceUsage.mockRejectedValueOnce(new Error('404'));
    const { result } = renderHook(() => useWorkspaceUsage('task-1'));
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it('drops the last measurement when a later request fails or the task leaves this computer', async () => {
    workspaceUsage.mockResolvedValueOnce(measured).mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useWorkspaceUsage(id), {
      initialProps: { id: 'task-1' as string | null },
    });
    await act(async () => {});
    expect(result.current).toEqual(measured);

    rerender({ id: 'task-2' });
    await act(async () => {});
    expect(result.current).toBeNull();

    workspaceUsage.mockResolvedValueOnce(measured);
    rerender({ id: 'task-1' });
    await act(async () => {});
    expect(result.current).toEqual(measured);
    rerender({ id: null });
    expect(result.current).toBeNull();
  });
});
