import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScheduleFromAnswer } from './useScheduleFromAnswer';
import { isAnswerScheduled, resetScheduledAnswersForTests } from '../lib/scheduledAnswers';

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const setup = (over = {}) => {
  const options = {
    create: vi.fn(),
    runNow: vi.fn().mockResolvedValue({}),
    onSaved: vi.fn(),
    onRunFailed: vi.fn(),
    ...over,
  };
  const view = renderHook(() => useScheduleFromAnswer(options));
  return { ...options, view };
};

describe('useScheduleFromAnswer', () => {
  beforeEach(() => resetScheduledAnswersForTests());

  it('creates one schedule when Schedule is submitted twice while the first is pending', async () => {
    const pending = deferred();
    const { create, runNow, view } = setup({ create: vi.fn(() => pending.promise) });
    let first; let second;
    act(() => {
      first = view.result.current.submit({ title: 'Grants' }, 'a1');
      second = view.result.current.submit({ title: 'Grants' }, 'a1');
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(view.result.current.busy).toBe(true);
    await act(async () => { pending.resolve({ id: 's1' }); await first; await second; });
    expect(view.result.current.busy).toBe(false);
    expect(isAnswerScheduled('a1')).toBe(true);
    expect(runNow).not.toHaveBeenCalled();
  });

  it('creates one schedule and runs it once when Save and run once is submitted twice', async () => {
    const pending = deferred();
    const { create, runNow, view } = setup({ create: vi.fn(() => pending.promise) });
    let first; let second;
    act(() => {
      first = view.result.current.submit({ title: 'Grants' }, 'a1', { runOnce: true });
      second = view.result.current.submit({ title: 'Grants' }, 'a1', { runOnce: true });
    });
    await act(async () => { pending.resolve({ id: 's1' }); await first; await second; });
    expect(create).toHaveBeenCalledTimes(1);
    expect(runNow).toHaveBeenCalledTimes(1);
    expect(runNow).toHaveBeenCalledWith('s1');
  });

  it('lets a retry create again after a failed create, and marks the answer only once one saved', async () => {
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValueOnce({ id: 's2' });
    const { onSaved, view } = setup({ create });
    await act(async () => {
      await expect(view.result.current.submit({ title: 'Grants' }, 'a1')).rejects.toThrow('server down');
    });
    expect(view.result.current.busy).toBe(false);
    expect(isAnswerScheduled('a1')).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => { await view.result.current.submit({ title: 'Grants' }, 'a1'); });
    expect(create).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(isAnswerScheduled('a1')).toBe(true);
  });

  it('keeps the save when the trial run fails, and says so', async () => {
    const error = new Error('no slot');
    const { onRunFailed, view } = setup({
      create: vi.fn().mockResolvedValue({ id: 's1' }),
      runNow: vi.fn().mockRejectedValue(error),
    });
    await act(async () => { await view.result.current.submit({ title: 'Grants' }, 'a1', { runOnce: true }); });
    expect(onRunFailed).toHaveBeenCalledWith({ title: 'Grants' }, error);
    expect(isAnswerScheduled('a1')).toBe(true);
  });
});
