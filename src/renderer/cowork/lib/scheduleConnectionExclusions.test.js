import { describe, expect, it } from 'vitest';
import { matchesScheduleExclusion, scheduleConnectionExclusions, toggleScheduleExclusion } from './scheduleConnectionExclusions';

describe('scheduled datasource exclusions', () => {
  it('keeps a renamed datasource excluded and still lets the user allow it', () => {
    const original = { engine: 'postgres', name: 'Primary', datasourceId: 12 };
    const renamed = { ...original, name: 'Renamed' };
    const other = { ...renamed, datasourceId: 13 };
    const excluded = toggleScheduleExclusion([], original, false);
    expect(excluded).toEqual([{ engine: 'postgres', name: 'Primary', datasource_id: 12 }]);
    const saved = scheduleConnectionExclusions(excluded);
    expect(matchesScheduleExclusion(saved[0], renamed)).toBe(true);
    expect(matchesScheduleExclusion(saved[0], other)).toBe(false);
    expect(toggleScheduleExclusion(saved, renamed, true)).toEqual([]);
  });
});
