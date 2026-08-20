import { beforeEach, describe, expect, it } from 'vitest';
import { getOrgMode, setOrgMode, subscribeOrgMode } from './orgMode';

describe('orgMode store', () => {
  beforeEach(() => setOrgMode(false));

  it('defaults to false before anything is resolved', () => {
    // The desktop build never resolves it, so false has to be the resting value.
    expect(getOrgMode()).toBe(false);
  });

  it('returns what boot resolved', () => {
    setOrgMode(true);
    expect(getOrgMode()).toBe(true);
    setOrgMode(false);
    expect(getOrgMode()).toBe(false);
  });

  it('notifies subscribers only on a real change', () => {
    let seen = 0;
    const unsubscribe = subscribeOrgMode(() => {
      seen += 1;
    });
    setOrgMode(true);
    setOrgMode(true); // same value — no extra notification
    unsubscribe();
    setOrgMode(false); // after unsubscribe — not counted
    expect(seen).toBe(1);
  });
});
