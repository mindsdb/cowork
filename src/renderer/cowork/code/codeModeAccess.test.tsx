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

  it('defaults to disabled on a capable desktop', () => {
    expect(getCodeModePreference()).toBe(false);
    expect(deriveCodeModeAccess(true, false)).toEqual({
      available: true,
      enabled: false,
      state: 'disabled',
    });
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

    expect(first.result.current.state).toBe('disabled');
    act(() => first.result.current.setEnabled(true));

    expect(window.localStorage.getItem('mindshub.code.enabled.v1')).toBe('true');
    expect(first.result.current.state).toBe('enabled');
    expect(second.result.current.state).toBe('enabled');
  });

  it('reacts to preference changes from another window', () => {
    const view = renderHook(() => useCodeModeAccess());
    window.localStorage.setItem('mindshub.code.enabled.v1', 'true');
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: 'mindshub.code.enabled.v1',
      newValue: 'true',
    })));
    expect(view.result.current.enabled).toBe(true);
  });

  it('exposes a single setter for callers that do not mount the hook', () => {
    setCodeModePreference(true);
    expect(getCodeModePreference()).toBe(true);
  });
});
