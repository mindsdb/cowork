import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { coordinateUpdates } from '../../../shared/update-coordinator';

// Capture the subscriber the hook registers so tests can push states the way
// host.watchUpdateState would.
const hostMock = vi.hoisted(() => {
  const state = { subscriber: null };
  return {
    state,
    host: {
      watchUpdateState: vi.fn((cb) => { state.subscriber = cb; return vi.fn(); }),
      applyUpdates: vi.fn(async () => true),
      openExternal: vi.fn(),
      getPlatform: vi.fn(() => 'darwin'),
    },
  };
});
vi.mock('../../platform/host', () => ({ host: hostMock.host }));

import { useAppUpdates } from './useAppUpdates';

const stateFor = (input) => coordinateUpdates({ shell: null, ota: null, server: null, shellManual: null, ...input });
const shell = (phase, over = {}) => ({ phase, mode: 'auto', channel: 'prod', currentVersion: '1.0.0', ...over });

const mountFlushed = async () => {
  let hook;
  await act(async () => { hook = renderHook(() => useAppUpdates()); });
  return hook;
};
const push = (input) => act(() => hostMock.state.subscriber(stateFor(input)));

beforeEach(() => {
  localStorage.clear();
  hostMock.state.subscriber = null;
  Object.values(hostMock.host).forEach((fn) => fn.mockClear?.());
  hostMock.host.applyUpdates.mockResolvedValue(true);
  hostMock.host.getPlatform.mockReturnValue('darwin');
});

describe('useAppUpdates', () => {
  it('subscribes to the one update state on mount and derives the one banner from it', async () => {
    const { result } = await mountFlushed();
    expect(hostMock.host.watchUpdateState).toHaveBeenCalledTimes(1);
    expect(result.current.updateBanner).toBeNull();
    push({ shell: shell('ready-to-install', { targetVersion: '2.0.0' }) });
    expect(result.current.updateState.action).toBe('relaunch');
    expect(result.current.updateBanner).toMatchObject({ title: 'Update ready', actionLabel: 'Restart now', action: 'relaunch' });
  });

  it('routes every main-side action through the one apply, with the proceed hook', async () => {
    const { result } = await mountFlushed();
    push({ ota: { phase: 'available', version: '3.0.0' } });
    const onProceed = vi.fn();
    let outcome;
    await act(async () => { outcome = await result.current.handleUpdateAction('reload', { onProceed }); });
    expect(hostMock.host.applyUpdates).toHaveBeenCalledWith({ onProceed });
    expect(outcome).toBe(true);
    await act(async () => { await result.current.handleUpdateAction('relaunch'); });
    await act(async () => { await result.current.handleUpdateAction('retry'); });
    expect(hostMock.host.applyUpdates).toHaveBeenCalledTimes(3);
  });

  it('sends one apply at a time: a second click while the first is out is a no-op', async () => {
    const { result } = await mountFlushed();
    let settle;
    hostMock.host.applyUpdates.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    let first;
    act(() => { first = result.current.handleUpdateAction('reload'); });
    let second;
    await act(async () => { second = await result.current.handleUpdateAction('reload'); });
    expect(second).toBe(false);
    expect(hostMock.host.applyUpdates).toHaveBeenCalledTimes(1);
    await act(async () => { settle(true); expect(await first).toBe(true); });
    await act(async () => { await result.current.handleUpdateAction('reload'); });
    expect(hostMock.host.applyUpdates).toHaveBeenCalledTimes(2);
  });

  it('passes a cancel through unchanged and turns a throw into false', async () => {
    const { result } = await mountFlushed();
    hostMock.host.applyUpdates.mockResolvedValueOnce('cancelled');
    let outcome;
    await act(async () => { outcome = await result.current.handleUpdateAction('reload'); });
    expect(outcome).toBe('cancelled');
    hostMock.host.applyUpdates.mockRejectedValueOnce(new Error('nope'));
    await act(async () => { outcome = await result.current.handleUpdateAction('reload'); });
    expect(outcome).toBe(false);
  });

  it('opens the installer page itself: the offered URL, an explicit one, or the public download page', async () => {
    const { result } = await mountFlushed();
    await act(async () => { await result.current.handleUpdateAction('open-download-page'); });
    expect(hostMock.host.openExternal).toHaveBeenLastCalledWith('https://mindshub.ai/download');
    push({ shellManual: { version: '2.0.0', downloadUrl: 'https://x/y.pkg' } });
    await act(async () => { await result.current.handleUpdateAction('open-download-page'); });
    expect(hostMock.host.openExternal).toHaveBeenLastCalledWith('https://x/y.pkg');
    await act(async () => { await result.current.handleUpdateAction('open-download-page', { url: 'https://x/z.deb' }); });
    expect(hostMock.host.openExternal).toHaveBeenLastCalledWith('https://x/z.deb');
    expect(hostMock.host.applyUpdates).not.toHaveBeenCalled();
  });

  it('dismisses the manual notice per version, and only the manual notice', async () => {
    const { result } = await mountFlushed();
    push({ shellManual: { version: '2.0.0', downloadUrl: 'https://x/y' } });
    expect(result.current.updateBanner?.kind).toBe('shell-manual');
    act(() => result.current.dismissShellUpdate());
    expect(result.current.shellUpdateDismissed).toBe('2.0.0');
    expect(localStorage.getItem('shellUpdateDismissedVersion')).toBe('2.0.0');
    expect(result.current.updateBanner).toBeNull();
    // A newer notice comes back.
    push({ shellManual: { version: '2.0.1' } });
    expect(result.current.updateBanner?.version).toBe('2.0.1');
    // A ready shell download is never dismissable.
    push({ shell: shell('ready-to-install', { targetVersion: '2.0.1' }) });
    act(() => result.current.dismissShellUpdate());
    expect(result.current.updateBanner?.action).toBe('relaunch');
  });

  it('names the .deb install step on linux', async () => {
    hostMock.host.getPlatform.mockReturnValue('linux');
    const { result } = await mountFlushed();
    push({ shellManual: { version: '2.0.0' } });
    expect(result.current.updateBanner?.debInstaller).toBe(true);
  });
});
