import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({ codeModeAvailable: true }));
vi.mock('../../platform/host', () => ({ host: hostMock }));

import {
  deriveCodeModeAccess,
  getCodeModePreference,
  setCodeModePreference,
  useCodeModeAccess,
} from './codeModeAccess';

describe('Code Mode access', () => {
  beforeEach(() => {
    window.localStorage.clear();
    hostMock.codeModeAvailable = true;
  });

  it('defaults to enabled on a capable desktop', () => {
    expect(getCodeModePreference()).toBe(true);
    expect(deriveCodeModeAccess(true, true)).toEqual({
      available: true,
      enabled: true,
      state: 'enabled',
    });
  });

  it('keeps Code off once the user has turned it off', () => {
    window.localStorage.setItem('mindshub.code.enabled.v1', 'false');
    expect(getCodeModePreference()).toBe(false);
    expect(deriveCodeModeAccess(true, false)).toEqual({
      available: true,
      enabled: false,
      state: 'disabled',
    });
  });

  it('stays off when local storage is unreadable', () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(getCodeModePreference()).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });

  it('never enables when the deployment capability is unavailable', () => {
    expect(deriveCodeModeAccess(false, true)).toEqual({
      available: false,
      enabled: false,
      state: 'unavailable',
    });
  });

  it('persists a device-local preference and updates every mounted consumer', () => {
    const first = renderHook(() => useCodeModeAccess());
    const second = renderHook(() => useCodeModeAccess());

    expect(first.result.current.state).toBe('enabled');
    act(() => first.result.current.setEnabled(false));

    expect(window.localStorage.getItem('mindshub.code.enabled.v1')).toBe('false');
    expect(first.result.current.state).toBe('disabled');
    expect(second.result.current.state).toBe('disabled');
  });

  it('reacts to preference changes from another window', () => {
    const view = renderHook(() => useCodeModeAccess());
    window.localStorage.setItem('mindshub.code.enabled.v1', 'false');
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'mindshub.code.enabled.v1',
      newValue: 'false',
    })));
    expect(view.result.current.enabled).toBe(false);
  });

  it('exposes a single setter for callers that do not mount the hook', () => {
    setCodeModePreference(false);
    expect(getCodeModePreference()).toBe(false);
  });
});
