import { describe, expect, it } from 'vitest';
import { missedOnceTitle, missedRunLabel, missedRunPast, missedRunText } from './scheduleCopy';

describe('missedRunText', () => {
  it('gives a one-off the hour cutoff', () => {
    expect(missedRunText('once', false)).toMatch(/within the hour/);
    expect(missedRunText('once', true)).toMatch(/within the hour/);
  });

  it.each(['hourly', 'daily', 'weekdays', 'weekly'])('runs a %s task once on return, never a backlog', (cadence) => {
    expect(missedRunText(cadence, false)).toMatch(/runs once when it reopens/);
    expect(missedRunText(cadence, false)).toMatch(/Earlier missed times are skipped/);
    expect(missedRunText(cadence, true)).toMatch(/runs once when it’s back/);
    expect(missedRunText(cadence, true)).toMatch(/Earlier missed times are skipped/);
  });

  it('blames a closed app on desktop and a down server on web', () => {
    for (const cadence of ['once', 'daily']) {
      expect(missedRunText(cadence, false)).toMatch(/MindsHub is closed/);
      expect(missedRunText(cadence, true)).toMatch(/the server is down/);
      expect(missedRunText(cadence, true)).not.toMatch(/MindsHub|reopens/);
    }
    expect(missedRunLabel(false)).toBe('If MindsHub is closed at this time');
    expect(missedRunLabel(true)).toBe('If the server is down at this time');
    expect(missedOnceTitle(false)).toMatch(/while MindsHub was closed$/);
    expect(missedOnceTitle(true)).toMatch(/while the server was down$/);
    expect(missedRunPast(false)).toEqual({ absent: 'while MindsHub was closed', back: 'when it reopened' });
    expect(missedRunPast(true)).toEqual({ absent: 'while the server was down', back: 'when it was back' });
  });
});
