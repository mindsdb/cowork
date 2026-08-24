import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Regression: on web, host.logout() (keycloak.logout) navigates to the
// end-session endpoint via window.location.replace(). If the hook ALSO calls
// window.location.reload() on success, the reload runs first and cancels that
// redirect — the SSO cookie survives, login-required silently re-auths, and
// sign-out has no visible effect. Web success must reload on neither path; only
// a REJECTION reloads immediately (the platform threw before its own
// navigation).
//
// Electron regression (stuck "Signing out…"): on Electron the ONLY thing that
// clears the modal is main's single deferred webContents.reload(). If that one
// reload is dropped (intermittently on Windows) the renderer hangs on
// "Signing out…" forever even though the account is already signed out. The
// hook now arms a delayed self-heal reload on Electron success.

const hostMock = vi.hoisted(() => ({
  host: { isWeb: true, isElectron: false, logout: vi.fn(async () => {}) },
}));
vi.mock('../../platform/host', () => hostMock);
vi.mock('../lib/analytics', () => ({ resetDeviceIdentity: vi.fn() }));

import { useLogout, LOGOUT_RELOAD_FALLBACK_MS } from './useLogout';
import { resetDeviceIdentity } from '../lib/analytics';

let reloadSpy;

beforeEach(() => {
  hostMock.host.logout.mockReset().mockResolvedValue(undefined);
  resetDeviceIdentity.mockReset();
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', { configurable: true, value: reloadSpy });
});

describe('useLogout — web', () => {
  beforeEach(() => {
    hostMock.host.isWeb = true;
    hostMock.host.isElectron = false;
  });

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

describe('useLogout — electron', () => {
  beforeEach(() => {
    hostMock.host.isWeb = false;
    hostMock.host.isElectron = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT reload immediately on success — lets main drive webContents.reload()', async () => {
    const { result } = renderHook(() => useLogout());
    await act(() => result.current.logout());

    // Main owns the reload; the renderer must not race it with an immediate one.
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(resetDeviceIdentity).toHaveBeenCalledTimes(1);
  });

  it('self-heals with a delayed reload if main never reloads (stuck "Signing out…")', async () => {
    const { result } = renderHook(() => useLogout());
    await act(() => result.current.logout());

    // Watchdog is armed but silent until the grace window elapses — a healthy
    // main reload would tear the page (and this timer) down first.
    expect(reloadSpy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(LOGOUT_RELOAD_FALLBACK_MS));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('reloads immediately on rejection and does NOT double-reload via the watchdog', async () => {
    hostMock.host.logout.mockRejectedValue(new Error('main threw'));

    const { result } = renderHook(() => useLogout());
    await act(() => result.current.logout());

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // The delayed watchdog must not fire on the rejection path (early return).
    act(() => vi.advanceTimersByTime(LOGOUT_RELOAD_FALLBACK_MS));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(resetDeviceIdentity).not.toHaveBeenCalled();
  });
});
