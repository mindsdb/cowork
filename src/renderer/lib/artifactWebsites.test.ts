import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getArtifactWebsites, setArtifactWebsites, useArtifactWebsites } from './artifactWebsites';

describe('artifactWebsites store', () => {
  afterEach(() => setArtifactWebsites(false));

  it('reads false until boot stores the flag', () => {
    const { result } = renderHook(() => useArtifactWebsites());
    expect(getArtifactWebsites()).toBe(false);
    expect(result.current).toBe(false);
  });

  it('re-renders its readers when the flag changes', () => {
    const { result } = renderHook(() => useArtifactWebsites());
    act(() => setArtifactWebsites(true));
    expect(result.current).toBe(true);
    act(() => setArtifactWebsites(false));
    expect(result.current).toBe(false);
  });
});
