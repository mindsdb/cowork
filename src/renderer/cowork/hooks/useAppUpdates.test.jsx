import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Capture the callbacks the hook registers so tests can push events the way
// the main process would.
const hostMock = vi.hoisted(() => {
  const state = { onUpdateStatusCb: null, onShellAutoUpdateCb: null };
  return {
    state,
    host: {
      getShellAutoUpdate: vi.fn(async () => null),
      onShellAutoUpdate: vi.fn((cb) => { state.onShellAutoUpdateCb = cb; return vi.fn(); }),
      onUpdateStatus: vi.fn((cb) => { state.onUpdateStatusCb = cb; return vi.fn(); }),
      getShellUpdate: vi.fn(async () => null),
      applyUpdate: vi.fn(async () => ({ ok: true })),
      openExternal: vi.fn(),
      downloadShellAutoUpdate: vi.fn(async () => ({ phase: 'ready-to-install' })),
      installShellAutoUpdate: vi.fn(async () => true),
      checkShellAutoUpdate: vi.fn(async () => ({ phase: 'available' })),
    },
  };
});
vi.mock('../../platform/host', () => ({ host: hostMock.host }));

import { useAppUpdates } from './useAppUpdates';

const mountFlushed = async () => {
  let hook;
  await act(async () => { hook = renderHook(() => useAppUpdates()); });
  return hook;
};

beforeEach(() => {
  localStorage.clear();
  hostMock.state.onUpdateStatusCb = null;
  hostMock.state.onShellAutoUpdateCb = null;
  Object.values(hostMock.host).forEach((fn) => fn.mockClear?.());
  hostMock.host.getShellAutoUpdate.mockResolvedValue(null);
  hostMock.host.getShellUpdate.mockResolvedValue(null);
});

describe('useAppUpdates', () => {
  it('subscribes to update + shell-auto-update on mount and hydrates the snapshot', async () => {
    hostMock.host.getShellAutoUpdate.mockResolvedValue({ phase: 'available' });
    const { result } = await mountFlushed();
    expect(hostMock.host.onUpdateStatus).toHaveBeenCalledTimes(1);
    expect(hostMock.host.onShellAutoUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.shellAutoUpdate).toEqual({ phase: 'available' });
  });

  it('routes a shell-available push into shellUpdate, other phases into updateStatus', async () => {
    const { result } = await mountFlushed();
    act(() => hostMock.state.onUpdateStatusCb({ phase: 'shell-available', version: '2.0.0', currentVersion: '1.9.0', downloadUrl: 'https://x/y' }));
    expect(result.current.shellUpdate).toEqual({ version: '2.0.0', currentVersion: '1.9.0', downloadUrl: 'https://x/y' });
    act(() => hostMock.state.onUpdateStatusCb({ phase: 'available', version: '3.0.0' }));
    expect(result.current.updateStatus).toEqual({ phase: 'available', version: '3.0.0' });
  });

  it('handleApplyUpdate marks downloading then delegates to host.applyUpdate', async () => {
    const { result } = await mountFlushed();
    act(() => hostMock.state.onUpdateStatusCb({ phase: 'available', version: '3.0.0' }));
    await act(async () => { await result.current.handleApplyUpdate(); });
    expect(hostMock.host.applyUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.updateStatus).toEqual({ phase: 'downloading', version: '3.0.0' });
  });

  it('handleApplyUpdate surfaces an error phase when the apply throws', async () => {
    hostMock.host.applyUpdate.mockRejectedValueOnce(new Error('nope'));
    const { result } = await mountFlushed();
    act(() => hostMock.state.onUpdateStatusCb({ phase: 'available', version: '3.0.0' }));
    await act(async () => { await result.current.handleApplyUpdate(); });
    expect(result.current.updateStatus).toEqual({ phase: 'error', version: '3.0.0' });
  });

  it('dismissShellUpdate persists the dismissed version', async () => {
    const { result } = await mountFlushed();
    act(() => hostMock.state.onUpdateStatusCb({ phase: 'shell-available', version: '2.0.0', downloadUrl: 'https://x/y' }));
    act(() => result.current.dismissShellUpdate());
    expect(result.current.shellUpdateDismissed).toBe('2.0.0');
    expect(localStorage.getItem('shellUpdateDismissedVersion')).toBe('2.0.0');
  });

  it('handleShellAutoUpdateAction dispatches by phase', async () => {
    hostMock.host.getShellAutoUpdate.mockResolvedValue({ phase: 'available' });
    const { result } = await mountFlushed();
    await act(async () => { await result.current.handleShellAutoUpdateAction(); });
    expect(hostMock.host.downloadShellAutoUpdate).toHaveBeenCalledTimes(1);
    expect(result.current.shellAutoUpdate).toEqual({ phase: 'ready-to-install' });
  });

  it('handleDownloadShellUpdate falls back to the public download page', async () => {
    const { result } = await mountFlushed();
    act(() => result.current.handleDownloadShellUpdate());
    expect(hostMock.host.openExternal).toHaveBeenCalledWith('https://mindshub.ai/download');
  });
});
