import { beforeEach, describe, expect, it } from 'vitest';
import { getLiveApps, setLiveApps, subscribeLiveApps } from './liveApps';

describe('liveApps store', () => {
  beforeEach(() => setLiveApps(false));

  it('defaults to false before anything is resolved', () => {
    // Every deployment but one that runs live apps never sets it, so false
    // has to be the resting value: it hides every live-app control.
    expect(getLiveApps()).toBe(false);
  });

  it('returns what boot resolved', () => {
    setLiveApps(true);
    expect(getLiveApps()).toBe(true);
    setLiveApps(false);
    expect(getLiveApps()).toBe(false);
  });

  it('notifies subscribers only on a real change', () => {
    let seen = 0;
    const unsubscribe = subscribeLiveApps(() => {
      seen += 1;
    });
    setLiveApps(true);
    setLiveApps(true); // same value — no extra notification
    unsubscribe();
    setLiveApps(false); // after unsubscribe — not counted
    expect(seen).toBe(1);
  });
});
