import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Regression: on web, host.logout() (keycloak.logout) navigates to the
// end-session endpoint via window.location.replace(). If the hook ALSO calls
// window.location.reload() on success, the reload runs first and cancels that
// redirect — the SSO cookie survives, login-required silently re-auths, and
// sign-out has no visible effect. Success must reload on neither platform; only
// a REJECTION reloads (the platform threw before its own navigation).

const hostMock = vi.hoisted(() => ({
  host: { isWeb: true, isElectron: false, logout: vi.fn(async () => {}) },
}));
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));

import { useLogout } from './useLogout';
import { resetDeviceIdentity } from '../lib/analytics';

let reloadSpy;

beforeEach(() => {
  hostMock.host.logout.mockReset().mockResolvedValue(undefined);
  resetDeviceIdentity.mockReset();
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
});

describe('useLogout — web', () => {
  it('lets keycloak drive the redirect on success — does NOT reload', async () => {
    const { result } = renderHook(() => useLogout());
    await act(() => result.current.logout());

    expect(hostMock.host.logout).toHaveBeenCalledTimes(1);
    expect(resetDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads only when logout rejects (redirect never fired)', async () => {
    hostMock.host.logout.mockRejectedValue(new Error('keycloak logout failed'));

    const { result } = renderHook(() => useLogout());
    await act(() => result.current.logout());

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // A failed attempt must not rotate the analytics identity (ENG-537).
    expect(resetDeviceIdentity).not.toHaveBeenCalled();
  });
});
