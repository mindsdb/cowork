import { describe, expect, it } from 'vitest';
import { diffNewApprovals } from './usePendingApprovals';

const ap = (id) => ({ id, status: 'pending' });

describe('diffNewApprovals', () => {
  it('first load is baseline, never news', () => {
    const r = diffNewApprovals(null, [ap('a'), ap('b')]);
    expect(r.baseline).toBe(true);
    expect(r.fresh).toEqual([]);
    expect([...r.ids].sort()).toEqual(['a', 'b']);
  });

  it('reports only ids not seen before', () => {
    const prev = new Set(['a']);
    const r = diffNewApprovals(prev, [ap('a'), ap('b'), ap('c')]);
    expect(r.baseline).toBe(false);
    expect(r.fresh.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('resolved-away ids produce no news and shrink the id set', () => {
    const prev = new Set(['a', 'b']);
    const r = diffNewApprovals(prev, [ap('b')]);
    expect(r.fresh).toEqual([]);
    expect([...r.ids]).toEqual(['b']);
  });
});
