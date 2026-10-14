import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkspaceAttribute } from './useWorkspaceAttribute';

describe('useWorkspaceAttribute', () => {
  afterEach(() => { delete document.documentElement.dataset.workspace; });

  it('sets html[data-workspace] to the active workspace', () => {
    renderHook(() => useWorkspaceAttribute('code'));
    expect(document.documentElement.dataset.workspace).toBe('code');
  });

  it('follows a switch between Code and Cowork', () => {
    const { rerender } = renderHook(({ mode }) => useWorkspaceAttribute(mode), {
      initialProps: { mode: 'code' },
    });
    rerender({ mode: 'cowork' });
    expect(document.documentElement.dataset.workspace).toBe('cowork');
    rerender({ mode: 'code' });
    expect(document.documentElement.dataset.workspace).toBe('code');
  });

  it('removes the attribute on unmount', () => {
    const { unmount } = renderHook(() => useWorkspaceAttribute('code'));
    unmount();
    expect(document.documentElement.hasAttribute('data-workspace')).toBe(false);
  });
});
