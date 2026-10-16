import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The poll only runs on the platform build; this file needs it on.
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));
const apiMock = vi.hoisted(() => ({ fetchHubUsage: vi.fn(async () => ({ reachable: false })) }));
vi.mock('../api', () => apiMock);
const visibility = vi.hoisted(() => ({ visible: true, listeners: new Set() }));
vi.mock('../code/useAppVisible', () => ({
  isAppVisible: () => visibility.visible,
  subscribeAppVisibility: (listener) => {
    visibility.listeners.add(listener);
    return () => { visibility.listeners.delete(listener); };
  },
}));

import { useHubUsage } from './useHubUsage';

afterEach(() => {
  visibility.visible = true;
  visibility.listeners.clear();
  apiMock.fetchHubUsage.mockClear();
  vi.useRealTimers();
});

describe('useHubUsage poll', () => {
  // On macOS Electron the document still reads visible while the window is
  // minimized, so the gate has to be the app-level visibility signal.
  it('skips the poll while the app window is hidden', async () => {
    vi.useFakeTimers();
    renderHook(() => useHubUsage({ sub: 'user-1' }, { pollMs: 1_000 }));
    await act(async () => { await Promise.resolve(); });
    expect(apiMock.fetchHubUsage).toHaveBeenCalledTimes(1);

    visibility.visible = false;
    await act(async () => { vi.advanceTimersByTime(3_000); });
    expect(apiMock.fetchHubUsage).toHaveBeenCalledTimes(1);

    visibility.visible = true;
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(apiMock.fetchHubUsage).toHaveBeenCalledTimes(2);
  });

  // The window signal only starts once something subscribes, and outside
  // Code Mode this hook is the only subscriber.
  it('subscribes to app visibility and refreshes on restore', async () => {
    const { unmount } = renderHook(() => useHubUsage({ sub: 'user-1' }, { pollMs: 0 }));
    await act(async () => { await Promise.resolve(); });
    expect(visibility.listeners.size).toBe(1);
    expect(apiMock.fetchHubUsage).toHaveBeenCalledTimes(1);

    await act(async () => { visibility.listeners.forEach((listener) => listener()); });
    expect(apiMock.fetchHubUsage).toHaveBeenCalledTimes(2);

    unmount();
    expect(visibility.listeners.size).toBe(0);
  });
});
