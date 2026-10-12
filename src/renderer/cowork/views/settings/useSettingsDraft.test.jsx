import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettingsDraft } from './useSettingsDraft';

describe('useSettingsDraft', () => {
  it('keeps server metadata live without replacing a local edit', () => {
    const { result, rerender } = renderHook(({ committed }) => useSettingsDraft(committed), {
      initialProps: { committed: { maxContinuations: '5', modelEnabled: { opus: false } } },
    });
    act(() => result.current.setSetting('maxContinuations', '9'));
    rerender({ committed: { maxContinuations: '6', modelEnabled: { opus: true } } });
    expect(result.current.settings).toEqual({ maxContinuations: '9', modelEnabled: { opus: true } });
    expect(result.current.capture().patch).toEqual({ maxContinuations: '9' });
  });

  it('preserves restoring the old value while an earlier save is running', () => {
    const { result, rerender } = renderHook(({ committed }) => useSettingsDraft(committed), {
      initialProps: { committed: { maxContinuations: '5' } },
    });
    act(() => result.current.setSetting('maxContinuations', '9'));
    const submitted = result.current.capture();
    act(() => result.current.setSetting('maxContinuations', '5'));
    rerender({ committed: { maxContinuations: '9' } });
    act(() => result.current.acknowledge(submitted.entries));
    expect(result.current.settings.maxContinuations).toBe('5');
    expect(result.current.dirty).toBe(true);
  });

  it('keeps appearance previews and provider test status out of manual writes', () => {
    const { result } = renderHook(() => useSettingsDraft({ greeting: 'Hello', maxContinuations: '5' }));
    act(() => {
      result.current.setSetting('greeting', 'Hi', { autoSave: true });
      result.current.setSetting('providerStatus', { anthropic: null });
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.capture().patch).toEqual({});
    expect(result.current.settings.greeting).toBe('Hi');
  });
});
