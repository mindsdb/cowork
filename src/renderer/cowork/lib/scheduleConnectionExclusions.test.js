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

  it('keeps a datasource added again under its name excluded, and lets the user give it back', () => {
    const saved = [{ engine: 'postgres', name: 'Primary', datasource_id: 12 }];
    const added = { engine: 'postgres', name: 'Primary', datasourceId: 13 };
    const other = { engine: 'postgres', name: 'Other', datasourceId: 14 };
    const listed = [added, other];
    expect(matchesScheduleExclusion(saved[0], added, listed)).toBe(true);
    expect(matchesScheduleExclusion(saved[0], other, listed)).toBe(false);
    expect(toggleScheduleExclusion(saved, added, true, listed)).toEqual([]);
  });

  it('does not match by name while the excluded datasource is still listed', () => {
    const saved = [{ engine: 'postgres', name: 'Primary', datasource_id: 12 }];
    const renamed = { engine: 'postgres', name: 'Renamed', datasourceId: 12 };
    const newcomer = { engine: 'postgres', name: 'Primary', datasourceId: 13 };
    expect(matchesScheduleExclusion(saved[0], newcomer, [renamed, newcomer])).toBe(false);
  });
});
