import { describe, it, expect } from 'vitest';
import { settingKeyForRole, buildRoleModels, withSelectionFirst, isRoleModelLocked } from './roleModels';

describe('isRoleModelLocked', () => {
  it('locks when the server availability map marks the id unavailable', () => {
    expect(isRoleModelLocked({ id: 'latest:opus' }, null, { 'latest:opus': false })).toBe(true);
  });

  it('unlocks when the server marks it available, overriding the tier heuristic', () => {
    // Frontier id would be locked by the free-tier heuristic, but the server
    // says it is available for this user, so the server wins.
    expect(isRoleModelLocked({ id: 'latest:opus' }, 'free', { 'latest:opus': true })).toBe(false);
  });

  it('falls back to the tier heuristic when the server has no entry for the id', () => {
    expect(isRoleModelLocked({ id: 'latest:opus' }, 'free', {})).toBe(true);
    expect(isRoleModelLocked({ id: 'latest:kimi' }, 'free', {})).toBe(false);
  });
});

describe('settingKeyForRole', () => {
  it('maps coding to codingModel and everything else to planningModel', () => {
    expect(settingKeyForRole('coding')).toBe('codingModel');
    expect(settingKeyForRole('planning')).toBe('planningModel');
    // Defensive: an unknown/absent role falls back to planning (the default).
    expect(settingKeyForRole(undefined)).toBe('planningModel');
    expect(settingKeyForRole('anything')).toBe('planningModel');
  });
});

describe('buildRoleModels', () => {
  const rec = { 'minds-cloud': ['latest:kimi', 'latest:opus', 'latest:sonnet'] };

  it('maps ids to {id, name, locked} with the config label as the name', () => {
    // No tier → nothing locked; order preserved.
    expect(buildRoleModels(rec, 'minds-cloud', null)).toEqual([
      { id: 'latest:kimi', name: 'latest:kimi', locked: false },
      { id: 'latest:opus', name: 'latest:opus', locked: false },
      { id: 'latest:sonnet', name: 'latest:sonnet', locked: false },
    ]);
  });

  it('locks frontier models on the free tier and surfaces the unlocked one first', () => {
    const out = buildRoleModels(rec, 'minds-cloud', 'free');
    // Free model (kimi) unlocked and hoisted to the top; frontier models locked.
    expect(out.map((m) => m.id)).toEqual(['latest:kimi', 'latest:opus', 'latest:sonnet']);
    expect(out.map((m) => m.locked)).toEqual([false, true, true]);
  });

  it('reorders so the only unlocked model leads even when listed last', () => {
    const recTail = { 'minds-cloud': ['latest:opus', 'latest:sonnet', 'latest:kimi'] };
    const out = buildRoleModels(recTail, 'minds-cloud', 'free');
    expect(out.map((m) => m.id)).toEqual(['latest:kimi', 'latest:opus', 'latest:sonnet']);
  });

  it('prefers a config-provided label for the display name', () => {
    const recLabelled = { 'minds-cloud': [{ id: 'latest:kimi', label: 'MindsHub Air' }] };
    expect(buildRoleModels(recLabelled, 'minds-cloud', 'free')).toEqual([
      { id: 'latest:kimi', name: 'MindsHub Air', locked: false },
    ]);
  });

  it('uses the server availability map over the tier heuristic', () => {
    // Server says opus is available (unlocked) and kimi is NOT, inverting the
    // free-tier heuristic. kimi becomes locked, opus unlocked and hoisted.
    const modelEnabled = { 'latest:opus': true, 'latest:kimi': false };
    const out = buildRoleModels(rec, 'minds-cloud', 'free', modelEnabled);
    const byId = Object.fromEntries(out.map((m) => [m.id, m.locked]));
    expect(byId['latest:opus']).toBe(false);
    expect(byId['latest:kimi']).toBe(true);
    // Unlocked (opus, sonnet-via-heuristic-locked?) ordering: opus leads.
    expect(out[0].id).toBe('latest:opus');
  });

  it('returns [] for an unknown provider', () => {
    expect(buildRoleModels(rec, 'anthropic', 'free')).toEqual([]);
  });
});

describe('withSelectionFirst', () => {
  const list = [
    { id: 'latest:kimi', name: 'latest:kimi', locked: false },
    { id: 'latest:opus', name: 'latest:opus', locked: true },
  ];

  it('returns the list unchanged (same ref) when the selection is already present', () => {
    const selected = { id: 'latest:kimi', name: 'latest:kimi' };
    expect(withSelectionFirst(selected, list, 'free')).toBe(list);
  });

  it('returns the list unchanged when there is no selection', () => {
    expect(withSelectionFirst(null, list, 'free')).toBe(list);
  });

  it('prepends an unlocked absent selection ahead of the list', () => {
    const selected = { id: 'latest:haiku', name: 'latest:haiku' };
    const out = withSelectionFirst(selected, list, 'pro'); // pro → nothing locked
    expect(out.map((m) => m.id)).toEqual(['latest:haiku', 'latest:kimi', 'latest:opus']);
    expect(out).not.toBe(list);
  });

  it('computes lock for the injected selection and keeps it below unlocked models', () => {
    // An absent frontier model on the free tier is locked, so it must not sit
    // above the unlocked kimi.
    const selected = { id: 'latest:gpt', name: 'latest:gpt' };
    const out = withSelectionFirst(selected, list, 'free');
    // Unlocked kimi leads; among locked rows the prepended gpt keeps its
    // ahead-of-opus position (stable order).
    expect(out.map((m) => m.id)).toEqual(['latest:kimi', 'latest:gpt', 'latest:opus']);
    const injected = out.find((m) => m.id === 'latest:gpt');
    expect(injected.locked).toBe(true);
  });
});
