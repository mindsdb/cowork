import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScheduleForAnswer,
  isAnswerScheduled,
  markAnswerScheduled,
  resetScheduledAnswersForTests,
  subscribeScheduledAnswers,
} from './scheduledAnswers';

describe('scheduledAnswers', () => {
  beforeEach(() => resetScheduledAnswersForTests());

  it('remembers the answers a schedule was saved from, and only those', () => {
    markAnswerScheduled('t1:m:a1');
    expect(isAnswerScheduled('t1:m:a1')).toBe(true);
    expect(isAnswerScheduled('t1:m:a2')).toBe(false);
    expect(isAnswerScheduled('')).toBe(false);
  });

  it('tells listeners once per newly scheduled answer, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeScheduledAnswers(listener);
    markAnswerScheduled('t1:m:a1');
    markAnswerScheduled('t1:m:a1');
    markAnswerScheduled(null);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    markAnswerScheduled('t1:m:a2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks the answer only after the schedule saved', async () => {
    const create = vi.fn().mockResolvedValue({ id: 's1' });
    await expect(createScheduleForAnswer(create, { prompt: 'p' }, 't1:m:a1')).resolves.toEqual({ id: 's1' });
    expect(create).toHaveBeenCalledWith({ prompt: 'p' });
    expect(isAnswerScheduled('t1:m:a1')).toBe(true);
  });

  it('leaves the step offered when the save fails', async () => {
    const create = vi.fn().mockRejectedValue(new Error('nope'));
    await expect(createScheduleForAnswer(create, { prompt: 'p' }, 't1:m:a1')).rejects.toThrow('nope');
    expect(isAnswerScheduled('t1:m:a1')).toBe(false);
  });
});
