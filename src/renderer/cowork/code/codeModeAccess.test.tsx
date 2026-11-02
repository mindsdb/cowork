import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostMock = vi.hoisted(() => ({ codeModeAvailable: true }));
vi.mock('../../platform/host', () => ({ host: hostMock }));
const deploymentMock = vi.hoisted(() => ({ PLATFORM_UI: true }));
vi.mock('../../lib/deployment', () => deploymentMock);

import {
  codeModeAvailable,
  deriveCodeModeAccess,
  getCodeModePreference,
  setCodeModePreference,
  useCodeModeAccess,
} from './codeModeAccess';

describe('Code Mode access', () => {
  beforeEach(() => {
    window.localStorage.clear();
    hostMock.codeModeAvailable = true;
    deploymentMock.PLATFORM_UI = true;
  });

  it('defaults to enabled on a capable desktop that never chose', () => {
    expect(getCodeModePreference()).toBe(true);
    expect(renderHook(() => useCodeModeAccess()).result.current.state).toBe('enabled');
  });

  it('keeps Code off for a device that turned it off', () => {
    window.localStorage.setItem('mindshub.code.enabled.v1', 'false');
    expect(getCodeModePreference()).toBe(false);
    expect(renderHook(() => useCodeModeAccess()).result.current.state).toBe('disabled');
  });

  it('stays off when storage cannot be read, since it cannot be turned off there', () => {
    const storage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      expect(getCodeModePreference()).toBe(false);
    } finally {
      storage.mockRestore();
    }
  });

  it('is disabled when the user preference is off', () => {
    expect(deriveCodeModeAccess(true, false)).toEqual({
      available: true,
      enabled: false,
      state: 'disabled',
    });
  });

  it('is unavailable on a self-hosted build even when the desktop shell allows Code', () => {
    deploymentMock.PLATFORM_UI = false;
    expect(codeModeAvailable()).toBe(false);
    expect(renderHook(() => useCodeModeAccess()).result.current.state).toBe('unavailable');
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
    setCodeModePreference(true);
    expect(getCodeModePreference()).toBe(true);
  });
});
