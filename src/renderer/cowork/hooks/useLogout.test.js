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

import { useLogout, LOGOUT_BUSY_LOCK_MS, LOGOUT_RELOAD_FALLBACK_MS, LOGOUT_WAIT_NOTE } from './useLogout';
import { resetDeviceIdentity } from '../lib/analytics';
import { SERVER_START_CAP_MS } from '../../../shared/server-status';

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

/*
 * The lock on the confirm dialog used to last exactly as long as
 * `host.logout()`, and nothing ever cleared it: `setLoggingOut` was called in
 * one place, with `true`. When the reply took minutes (main awaited a sidecar
 * restart capped at 180s) the dialog was the app's only exit and Escape,
 * Cancel and the backdrop were all disabled.
 */
describe('useLogout — the confirm lock', () => {
  // The sign-out state is a module store shared by both entry points, so a
  // test that leaves an invoke pending would hold the single-flight guard for
  // the next one. `pending()` hands back the resolver and afterEach settles it.
  let settlePending;

  const pending = () => {
    hostMock.host.logout.mockReturnValue(new Promise((resolve) => { settlePending = resolve; }));
  };

  beforeEach(() => {
    hostMock.host.isWeb = false;
    hostMock.host.isElectron = true;
    settlePending = null;
    vi.useFakeTimers();
  });

  afterEach(async () => {
    if (settlePending) {
      await act(async () => { settlePending(); });
      settlePending = null;
    }
    vi.useRealTimers();
  });

  it('hands the dialog back when the platform never replies', async () => {
    pending();
    const { result } = renderHook(() => useLogout());

    await act(async () => { result.current.logout(); });
    expect(result.current.locked).toBe(true);
    expect(result.current.loggingOut).toBe(true);

    act(() => vi.advanceTimersByTime(LOGOUT_BUSY_LOCK_MS));

    // Dismissable, and still honest about the work continuing. No page reload
    // was needed to get here, which is the whole defect.
    expect(result.current.locked).toBe(false);
    expect(result.current.loggingOut).toBe(true);
    expect(result.current.waitNote).toBe(LOGOUT_WAIT_NOTE);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('leaves nothing set once the reply lands', async () => {
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    expect(result.current.locked).toBe(false);
    expect(result.current.loggingOut).toBe(false);
    expect(result.current.waitNote).toBe('');
  });

  it('unlocks on a rejection too, before it reloads', async () => {
    hostMock.host.logout.mockRejectedValue(new Error('main threw'));
    const { result } = renderHook(() => useLogout());

    await act(async () => { await result.current.logout(); });

    expect(result.current.locked).toBe(false);
    expect(result.current.loggingOut).toBe(false);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * A reply at the sidecar start cap, the case the ticket's step 8 forces by
   * hand. The lock still releases on time, and the navigation contract is
   * unchanged: no reload of our own, one watchdog reload if main's never
   * arrives, one identity rotation.
   */
  it('still releases the lock when the reply arrives at the 180 second cap', async () => {
    pending();
    const { result } = renderHook(() => useLogout());

    await act(async () => { result.current.logout(); });
    act(() => vi.advanceTimersByTime(LOGOUT_BUSY_LOCK_MS));
    expect(result.current.locked).toBe(false);

    act(() => vi.advanceTimersByTime(SERVER_START_CAP_MS - LOGOUT_BUSY_LOCK_MS));
    await act(async () => { settlePending(); });
    settlePending = null;

    expect(resetDeviceIdentity).toHaveBeenCalledTimes(1);
    expect(reloadSpy).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(LOGOUT_RELOAD_FALLBACK_MS));
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('locks for less than the ten seconds the dialog is allowed to trap someone', () => {
    expect(LOGOUT_BUSY_LOCK_MS).toBeLessThan(10_000);
  });

  /*
   * Two components mount this hook (the settings Account section and the
   * sidebar user menu). Now that the dialog can be dismissed mid-flight, the
   * other entry point is reachable while a sign-out is still running.
   */
  it('runs one sign-out even when both entry points ask', async () => {
    pending();
    const account = renderHook(() => useLogout());
    const userMenu = renderHook(() => useLogout());

    await act(async () => { account.result.current.logout(); });
    await act(async () => { userMenu.result.current.logout(); });

    expect(hostMock.host.logout).toHaveBeenCalledTimes(1);
    // Both see the same state, so one dialog cannot look idle while the other spins.
    expect(userMenu.result.current.loggingOut).toBe(true);
    expect(account.result.current.loggingOut).toBe(true);
  });
});
