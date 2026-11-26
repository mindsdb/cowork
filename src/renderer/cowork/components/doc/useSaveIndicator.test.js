import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSaveIndicator } from './useSaveIndicator';

describe('useSaveIndicator', () => {
  it('says saving while any editable waits, or while a write is out', () => {
    const { result, rerender } = renderHook(({ writing }) => useSaveIndicator(writing), { initialProps: { writing: false } });
    expect(result.current.saving).toBe(false);
    act(() => { result.current.onPendingChange('a', true); });
    act(() => { result.current.onPendingChange('b', true); });
    act(() => { result.current.onPendingChange('a', false); });
    expect(result.current.saving).toBe(true);
    act(() => { result.current.onPendingChange('b', false); });
    expect(result.current.saving).toBe(false);
    rerender({ writing: true });
    expect(result.current.saving).toBe(true);
  });

  it('counts an editable once however often it reports', () => {
    const { result } = renderHook(() => useSaveIndicator(false));
    act(() => { result.current.onPendingChange('a', true); });
    act(() => { result.current.onPendingChange('a', true); });
    act(() => { result.current.onPendingChange('a', false); });
    expect(result.current.saving).toBe(false);
  });
});
