import { describe, it, expect } from 'vitest';
import {
  planOf, isPaidPlan, nextUpgradeTier, tierCovers, cleanRequiredTier, cleanAllowanceWindow,
  planFailureFields, windowWarnStep, windowState,
} from './subscriptionPlan';

const read = (plan, over = {}) => ({ reachable: true, plan, ...over });
const PLUS = {
  tier: 'plus',
  status: 'active',
  renewsAt: '2026-12-19T00:00:00Z',
  cancelAtPeriodEnd: false,
  windows: [
    { window: '7d', percentUsed: 10, resetsAt: '2026-11-24T09:00:00Z' },
    { window: '5h', percentUsed: 42, resetsAt: '2026-11-19T18:00:00Z' },
  ],
};

describe('planOf', () => {
  it('is null for no plan, an unreachable read, or a tier this build does not know', () => {
    expect(planOf(null)).toBeNull();
    expect(planOf(read(null))).toBeNull();
    expect(planOf({ reachable: false, plan: PLUS })).toBeNull();
    expect(planOf(read({ ...PLUS, tier: 'max' }))).toBeNull();
    expect(planOf(read('plus'))).toBeNull();
  });

  it('cleans the plan and orders the windows 5h then 7d', () => {
    const plan = planOf(read(PLUS));
    expect(plan.tier).toBe('plus');
    expect(plan.renewsAt).toBe('2026-12-19T00:00:00Z');
    expect(plan.windows.map((w) => w.window)).toEqual(['5h', '7d']);
  });

  it('drops unreadable windows and clamps the share to 0-100', () => {
    const plan = planOf(read({
      ...PLUS,
      windows: [
        { window: '1d', percentUsed: 5 },
        { window: '5h', percentUsed: 'lots' },
        { window: '7d', percentUsed: 140, resetsAt: '' },
      ],
    }));
    expect(plan.windows).toEqual([{ window: '7d', percentUsed: 100, resetsAt: null }]);
  });

  it('reads a Free plan with no windows', () => {
    expect(planOf(read({ tier: 'free', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] })))
      .toEqual({ tier: 'free', status: 'active', renewsAt: null, cancelAtPeriodEnd: false, windows: [] });
  });
});

describe('tiers', () => {
  it('knows which tiers are paid and which comes next', () => {
    expect(isPaidPlan({ tier: 'free' })).toBe(false);
    expect(isPaidPlan({ tier: 'pro' })).toBe(true);
    expect(isPaidPlan(null)).toBe(false);
    expect(nextUpgradeTier('free')).toBe('plus');
    expect(nextUpgradeTier('plus')).toBe('pro');
    expect(nextUpgradeTier('pro')).toBeNull();
    expect(nextUpgradeTier(undefined)).toBeNull();
  });

  it('covers a model at or below the tier, and an unknown coverage counts as covered', () => {
    expect(tierCovers('plus', 'free')).toBe(true);
    expect(tierCovers('plus', 'plus')).toBe(true);
    expect(tierCovers('plus', 'pro')).toBe(false);
    expect(tierCovers('pro', 'pro')).toBe(true);
    expect(tierCovers('plus', null)).toBe(true);
    expect(tierCovers('plus', 'ultra')).toBe(true);
  });

  it('cleans the gate fields on a failure, snake or camel case', () => {
    expect(cleanRequiredTier('pro')).toBe('pro');
    expect(cleanRequiredTier('free')).toBeNull();
    expect(cleanAllowanceWindow('7d')).toBe('7d');
    expect(cleanAllowanceWindow('1d')).toBeNull();
    expect(planFailureFields({ window: '5h', required_tier: 'plus' })).toEqual({ allowanceWindow: '5h', requiredTier: 'plus' });
    expect(planFailureFields({ requiredTier: 'pro' })).toEqual({ allowanceWindow: null, requiredTier: 'pro' });
    expect(planFailureFields(null)).toEqual({ allowanceWindow: null, requiredTier: null });
  });
});

describe('windows', () => {
  it('steps the warning at 80, 90 and 95 percent', () => {
    expect([0, 79, 80, 89, 90, 95, 100].map(windowWarnStep)).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });

  it('says nothing for Free or an unworried paid plan', () => {
    expect(windowState({ tier: 'free', windows: [] })).toEqual({ exhausted: null, warning: null });
    expect(windowState(planOf(read(PLUS)))).toEqual({ exhausted: null, warning: null });
  });

  it('warns on the fullest window past 80% that is not used up', () => {
    const plan = planOf(read({
      ...PLUS,
      windows: [{ window: '5h', percentUsed: 85, resetsAt: null }, { window: '7d', percentUsed: 92, resetsAt: null }],
    }));
    expect(windowState(plan).warning.window).toBe('7d');
  });

  it('when both are used up, names the one that frees up last', () => {
    const plan = planOf(read({
      ...PLUS,
      windows: [
        { window: '5h', percentUsed: 100, resetsAt: '2026-11-19T18:00:00Z' },
        { window: '7d', percentUsed: 100, resetsAt: '2026-11-24T09:00:00Z' },
      ],
    }));
    expect(windowState(plan).exhausted.window).toBe('7d');
  });
});
