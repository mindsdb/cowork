import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { getStatsUiEnabled, setStatsUiEnabled, useStatsUiEnabled } from './statsUiAccess';

afterEach(() => {
  setStatsUiEnabled(false);
});

describe('statsUiAccess', () => {
  it('is off by default', () => {
    expect(getStatsUiEnabled()).toBe(false);
  });

  it('is turned on and off from the console helpers', () => {
    expect(window.enableArtifactStats()).toMatch(/enabled/);
    expect(getStatsUiEnabled()).toBe(true);

    expect(window.disableArtifactStats()).toMatch(/disabled/);
    expect(getStatsUiEnabled()).toBe(false);
    expect(window.localStorage.getItem('mindshub.artifact-stats.ui.v1')).toBeNull();
  });

  it('re-renders mounted consumers on a change', () => {
    const { result } = renderHook(() => useStatsUiEnabled());
    expect(result.current).toBe(false);

    act(() => window.enableArtifactStats());

    expect(result.current).toBe(true);
  });
});
