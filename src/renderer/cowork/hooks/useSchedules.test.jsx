import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  resumeSchedule: vi.fn(),
}));
vi.mock('../api', () => api);

import { useSchedules } from './useSchedules';

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.fetchSchedules.mockResolvedValue({ schedules: [], runs_index: {} });
  api.createSchedule.mockResolvedValue();
  api.updateSchedule.mockResolvedValue();
  api.deleteSchedule.mockResolvedValue();
  api.pauseSchedule.mockResolvedValue();
  api.resumeSchedule.mockResolvedValue();
});

describe('useSchedules', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSchedules());
    expect(result.current.scheduled).toEqual([]);
    expect(result.current.scheduleRunsIndex).toEqual({});
  });

  it('refreshSchedules loads the list + runs index and returns the list', async () => {
    api.fetchSchedules.mockResolvedValue({ schedules: [{ id: 's1' }], runs_index: { c1: 's1' } });
    const { result } = renderHook(() => useSchedules());
    let ret;
    await act(async () => { ret = await result.current.refreshSchedules(); });
    expect(ret).toEqual([{ id: 's1' }]);
    expect(result.current.scheduled).toEqual([{ id: 's1' }]);
    expect(result.current.scheduleRunsIndex).toEqual({ c1: 's1' });
  });

  it('refreshSchedules tolerates a response missing the arrays', async () => {
    api.fetchSchedules.mockResolvedValue({});
    const { result } = renderHook(() => useSchedules());
    await act(async () => { await result.current.refreshSchedules(); });
    expect(result.current.scheduled).toEqual([]);
    expect(result.current.scheduleRunsIndex).toEqual({});
  });

  it('handleCreateSchedule creates then refreshes the list', async () => {
    api.fetchSchedules.mockResolvedValue({ schedules: [{ id: 'new' }], runs_index: {} });
    const { result } = renderHook(() => useSchedules());
    await act(async () => { await result.current.handleCreateSchedule({ cron: '* * * * *' }); });
    expect(api.createSchedule).toHaveBeenCalledWith({ cron: '* * * * *' });
    expect(api.fetchSchedules).toHaveBeenCalled();
    expect(result.current.scheduled).toEqual([{ id: 'new' }]);
  });

  it('update / delete / pause / resume each delegate to the API then refresh', async () => {
    const { result } = renderHook(() => useSchedules());
    await act(async () => { await result.current.handleUpdateSchedule('s1', { enabled: false }); });
    expect(api.updateSchedule).toHaveBeenCalledWith('s1', { enabled: false });
    await act(async () => { await result.current.handleDeleteSchedule('s1'); });
    expect(api.deleteSchedule).toHaveBeenCalledWith('s1');
    await act(async () => { await result.current.handlePauseSchedule('s1'); });
    expect(api.pauseSchedule).toHaveBeenCalledWith('s1');
    await act(async () => { await result.current.handleResumeSchedule('s1'); });
    expect(api.resumeSchedule).toHaveBeenCalledWith('s1');
    expect(api.fetchSchedules).toHaveBeenCalledTimes(4);
  });
});
