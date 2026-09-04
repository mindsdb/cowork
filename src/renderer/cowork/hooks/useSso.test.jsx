import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const hostMock = vi.hoisted(() => {
  const state = { onAuthChangedCb: null };
  return {
    state,
    getAccessToken: vi.fn(async () => null),
    host: {
      isElectron: true,
      onMindsHubAuthChanged: vi.fn((cb) => { state.onAuthChangedCb = cb; return vi.fn(); }),
      mindshubLogin: vi.fn(async () => ({ ok: true })),
      mindshubFinalize: vi.fn(async () => ({})),
    },
  };
});
vi.mock('../../platform/host', () => ({ host: hostMock.host, getAccessToken: hostMock.getAccessToken }));

const trackKeyProvisioningRefused = vi.hoisted(() => vi.fn());
vi.mock('../lib/analytics', () => ({ trackKeyProvisioningRefused }));

import { useSso } from './useSso';

const deps = () => ({
  settingsOpen: false,
  setSettingsSection: vi.fn(),
  setSettingsOpen: vi.fn(),
  refreshData: vi.fn(),
});

const mount = async (extra = {}) => {
  const d = { ...deps(), ...extra };
  let hook;
  await act(async () => { hook = renderHook((p) => useSso(p), { initialProps: d }); });
  return { ...hook, d };
};

beforeEach(() => {
  hostMock.state.onAuthChangedCb = null;
  hostMock.host.isElectron = true;
  hostMock.getAccessToken.mockResolvedValue(null);
  hostMock.host.mindshubLogin.mockResolvedValue({ ok: true });
  hostMock.host.mindshubFinalize.mockResolvedValue({});
  Object.values(hostMock.host).forEach((fn) => fn.mockClear?.());
  hostMock.getAccessToken.mockClear();
  trackKeyProvisioningRefused.mockClear();
});

describe('useSso', () => {
  it('subscribes to auth-changed and reflects pushed state', async () => {
    const { result } = await mount();
    expect(hostMock.host.onMindsHubAuthChanged).toHaveBeenCalledTimes(1);
    act(() => hostMock.state.onAuthChangedCb({ authenticated: true }));
    expect(result.current.ssoConnected).toBe(true);
    act(() => hostMock.state.onAuthChangedCb({ authenticated: false }));
    expect(result.current.ssoConnected).toBe(false);
  });

  it('probes the token when settings opens', async () => {
    hostMock.getAccessToken.mockResolvedValue('tok');
    const { result } = await mount({ settingsOpen: true });
    expect(hostMock.getAccessToken).toHaveBeenCalled();
    expect(result.current.ssoConnected).toBe(true);
  });

  it('does not probe the token while settings is closed', async () => {
    await mount({ settingsOpen: false });
    expect(hostMock.getAccessToken).not.toHaveBeenCalled();
  });

  it('successful sign-in flips connected, finalizes, and refreshes', async () => {
    const { result, d } = await mount();
    await act(async () => { await result.current.handleSsoSignIn(); });
    expect(result.current.ssoConnected).toBe(true);
    expect(hostMock.host.mindshubFinalize).toHaveBeenCalled();
    expect(d.refreshData).toHaveBeenCalled();
  });

  it('a failed login surfaces the error on the account card', async () => {
    hostMock.host.mindshubLogin.mockResolvedValue({ ok: false, reason: 'nope' });
    const { result, d } = await mount();
    await act(async () => { await result.current.handleSsoSignIn(); });
    expect(result.current.ssoError).toBe('nope');
    expect(d.setSettingsSection).toHaveBeenCalledWith('account');
    expect(d.setSettingsOpen).toHaveBeenCalledWith(true);
    expect(d.refreshData).not.toHaveBeenCalled();
  });

  it('counts a provisioning refusal (402/upgradeRequired) without blocking sign-in', async () => {
    hostMock.host.mindshubFinalize.mockResolvedValue({ upgradeRequired: true });
    const { result } = await mount();
    await act(async () => { await result.current.handleSsoSignIn(); });
    expect(trackKeyProvisioningRefused).toHaveBeenCalledWith('unhandled');
    expect(result.current.ssoConnected).toBe(true);
  });

  it('is a no-op outside Electron', async () => {
    hostMock.host.isElectron = false;
    const { result, d } = await mount();
    await act(async () => { await result.current.handleSsoSignIn(); });
    expect(hostMock.host.mindshubLogin).not.toHaveBeenCalled();
    expect(d.refreshData).not.toHaveBeenCalled();
  });
});
