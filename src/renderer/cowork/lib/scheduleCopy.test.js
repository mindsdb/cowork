import { describe, expect, it } from 'vitest';
import { missedRunText } from './scheduleCopy';

describe('missedRunText', () => {
  it('gives a one-off the hour cutoff', () => {
    expect(missedRunText('once')).toMatch(/within the hour/);
  });

  it.each(['hourly', 'daily', 'weekdays', 'weekly'])('runs a %s task once on return, never a backlog', (cadence) => {
    expect(missedRunText(cadence)).toMatch(/runs once when it reopens/);
    expect(missedRunText(cadence)).toMatch(/Earlier missed times are skipped/);
  });
});
