import { describe, it, expect } from 'vitest';
import { isFrontierModel, isModelLocked, orderUnlockedFirst } from './modelEntitlement';

describe('isFrontierModel', () => {
  it('treats the free model (Kimi / Minds Air) as not frontier', () => {
    expect(isFrontierModel('latest:kimi')).toBe(false);
    expect(isFrontierModel('fireworks/kimi-k2p6')).toBe(false);
    expect(isFrontierModel('minds-air')).toBe(false);
    expect(isFrontierModel('minds air')).toBe(false);
  });

  it('treats everything else as frontier', () => {
    expect(isFrontierModel('latest:opus')).toBe(true);
    expect(isFrontierModel('claude-opus-4-8')).toBe(true);
    expect(isFrontierModel('gemini-3-flash')).toBe(true);
    expect(isFrontierModel('gpt-5.5')).toBe(true);
  });

  it('is falsy for an empty id', () => {
    expect(isFrontierModel('')).toBe(false);
    expect(isFrontierModel(undefined)).toBe(false);
  });
});

describe('isModelLocked', () => {
  it('locks frontier models on the free tier and leaves the free model open', () => {
    expect(isModelLocked({ id: 'latest:opus' }, 'free')).toBe(true);
    expect(isModelLocked({ id: 'claude-opus-4-8' }, 'free')).toBe(true);
    expect(isModelLocked({ id: 'latest:kimi' }, 'free')).toBe(false);
  });

  it('locks nothing for pro or an unknown/absent tier (dormant in production)', () => {
    expect(isModelLocked({ id: 'latest:opus' }, 'pro')).toBe(false);
    expect(isModelLocked({ id: 'latest:opus' }, null)).toBe(false);
    expect(isModelLocked({ id: 'latest:opus' }, undefined)).toBe(false);
  });

  it('honors a server-provided locked flag over the heuristic (both directions)', () => {
    // Server says unlocked even though the heuristic would lock it on free.
    expect(isModelLocked({ id: 'claude-opus-4-8', locked: false }, 'free')).toBe(false);
    // Server says locked even for the free model / on the pro tier.
    expect(isModelLocked({ id: 'latest:kimi', locked: true }, 'pro')).toBe(true);
  });
});

describe('orderUnlockedFirst', () => {
  it('moves unlocked models ahead of locked ones, preserving order within each group', () => {
    const models = [
      { id: 'a', locked: true },
      { id: 'b', locked: false },
      { id: 'c', locked: true },
      { id: 'd', locked: false },
    ];
    expect(orderUnlockedFirst(models).map((m) => m.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is a no-op when nothing is locked', () => {
    const models = [{ id: 'a', locked: false }, { id: 'b', locked: false }];
    expect(orderUnlockedFirst(models).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const models = [{ id: 'a', locked: true }, { id: 'b', locked: false }];
    const copy = [...models];
    orderUnlockedFirst(models);
    expect(models).toEqual(copy);
  });
});
