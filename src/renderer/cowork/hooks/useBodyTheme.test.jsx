import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readBodyTheme, useBodyTheme } from './useBodyTheme';

afterEach(() => { delete document.body.dataset.theme; });

describe('useBodyTheme', () => {
  it('reads light unless the body says dark', () => {
    expect(readBodyTheme()).toBe('light');
    document.body.dataset.theme = 'dark';
    expect(readBodyTheme()).toBe('dark');
  });

  it('follows a theme switch', async () => {
    const { result } = renderHook(() => useBodyTheme());
    expect(result.current).toBe('light');
    await act(async () => { document.body.dataset.theme = 'dark'; });
    expect(result.current).toBe('dark');
  });
});
