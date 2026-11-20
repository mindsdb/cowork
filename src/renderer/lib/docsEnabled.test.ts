import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  getDocsEnabled, resolveDocsEnabled, setDocsEnabled, subscribeDocsEnabled, useDocsEnabled,
} from './docsEnabled';

describe('docsEnabled store', () => {
  afterEach(() => setDocsEnabled(true));

  it('reads true before boot stores anything', () => {
    // The desktop value: the code-fixture route renders the app without boot.
    expect(getDocsEnabled()).toBe(true);
  });

  it('returns what boot stored', () => {
    setDocsEnabled(false);
    expect(getDocsEnabled()).toBe(false);
    setDocsEnabled(true);
    expect(getDocsEnabled()).toBe(true);
  });

  it('notifies subscribers only on a real change', () => {
    let seen = 0;
    const unsubscribe = subscribeDocsEnabled(() => { seen += 1; });
    setDocsEnabled(false);
    setDocsEnabled(false);
    unsubscribe();
    setDocsEnabled(true);
    expect(seen).toBe(1);
  });

  it('re-renders a component when the value changes', () => {
    const { result } = renderHook(() => useDocsEnabled());
    expect(result.current).toBe(true);
    act(() => setDocsEnabled(false));
    expect(result.current).toBe(false);
  });
});

describe('resolveDocsEnabled', () => {
  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, false],
    [false, false, false],
  ])('keeps what the server reported (%s, org=%s)', (reported, orgMode, expected) => {
    expect(resolveDocsEnabled(reported, orgMode)).toBe(expected);
  });

  it('reads an old server as on outside org mode and off in org mode', () => {
    expect(resolveDocsEnabled(undefined, false)).toBe(true);
    expect(resolveDocsEnabled(undefined, true)).toBe(false);
  });
});
