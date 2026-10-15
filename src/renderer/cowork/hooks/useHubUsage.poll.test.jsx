import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// The poll only runs on the platform build; this file needs it on.
vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: true }));
const apiMock = vi.hoisted(() => ({ fetchHubUsage: vi.fn(async () => ({ reachable: false })) }));
vi.mock('../api', () => apiMock);
const visibility = vi.hoisted(() => ({ visible: true }));
vi.mock('../code/useAppVisible', () => ({ isAppVisible: () => visibility.visible }));

import { useHubUsage } from './useHubUsage';

afterEach(() => {
  visibility.visible = true;
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
});
