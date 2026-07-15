import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock the host facade so the hook is exercised without a real Electron bridge.
// Every hook interaction MUST route through the host.ts facade.
// vi.mock is hoisted, so build the mock via vi.hoisted to keep references valid.
const { stateListeners, mockHost } = vi.hoisted(() => {
  const listeners = [];
  const h = {
    browserControlStatus: vi.fn(async () => ({ available: false, state: 'disconnected' })),
    browserControlListTabs: vi.fn(async () => ({ ok: true, tabs: [] })),
    browserControlAttach: vi.fn(async () => ({ ok: true, state: 'awaiting-approval' })),
    browserControlApprove: vi.fn(async () => ({ ok: true, state: 'connected' })),
    browserControlCancelAttach: vi.fn(async () => ({ ok: true })),
    browserControlRevoke: vi.fn(async () => ({ ok: true })),
    browserControlTakeOver: vi.fn(async () => ({ ok: true })),
    onBrowserControlState: vi.fn((cb) => {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    }),
  };
  return { stateListeners: listeners, mockHost: h };
});

vi.mock('../../platform/host', () => ({
  host: mockHost,
  default: mockHost,
}));

function pushState(payload) {
  act(() => {
    stateListeners.forEach((cb) => cb(payload));
  });
}

// Imported after vi.mock so the mock is in place.
import { useBrowserControl } from './useBrowserControl';

beforeEach(() => {
  stateListeners.length = 0;
  vi.clearAllMocks();
  mockHost.browserControlStatus.mockResolvedValue({ available: false, state: 'disconnected' });
});

describe('useBrowserControl', () => {
  it('reads status on mount and subscribes to state pushes', async () => {
    mockHost.browserControlStatus.mockResolvedValue({
      available: true,
      state: 'connected',
      domain: 'example.com',
      tabTitle: 'Example',
    });

    const { result } = renderHook(() => useBrowserControl());

    await waitFor(() => expect(result.current.state).toBe('connected'));
    expect(result.current.available).toBe(true);
    expect(result.current.domain).toBe('example.com');
    expect(result.current.tabTitle).toBe('Example');
    expect(mockHost.browserControlStatus).toHaveBeenCalled();
    expect(mockHost.onBrowserControlState).toHaveBeenCalled();
  });

  it('derives available from state === connected, ignoring a stale status.available flag', async () => {
    // The mount read and the live-push path must compute `available` the same
    // way: purely from `state === 'connected'`. A server payload whose
    // `available` flag disagrees with its state must not leak through.
    mockHost.browserControlStatus.mockResolvedValue({
      available: true,
      state: 'awaiting-approval',
      domain: 'example.com',
    });
    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('awaiting-approval'));
    expect(result.current.available).toBe(false);

    // And the inverse: a connected state with a falsy available flag is still available.
    pushState({ state: 'connected', available: false, domain: 'example.com' });
    expect(result.current.state).toBe('connected');
    expect(result.current.available).toBe(true);
  });

  it('updates state from a live push (awaiting-approval -> connected -> lost)', async () => {
    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('disconnected'));

    pushState({ state: 'awaiting-approval' });
    expect(result.current.state).toBe('awaiting-approval');
    expect(result.current.available).toBe(false);

    pushState({ state: 'connected', domain: 'shop.example.com', tabTitle: 'Shop' });
    expect(result.current.state).toBe('connected');
    expect(result.current.available).toBe(true);
    expect(result.current.domain).toBe('shop.example.com');

    pushState({ state: 'lost', reason: 'tab closed' });
    expect(result.current.state).toBe('lost');
    expect(result.current.available).toBe(false);
  });

  it('exposes listTabs/attach that proxy the host facade (attach = attach + approve)', async () => {
    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('disconnected'));

    await act(async () => {
      await result.current.listTabs();
      await result.current.attach('T1');
    });
    expect(mockHost.browserControlListTabs).toHaveBeenCalled();
    expect(mockHost.browserControlAttach).toHaveBeenCalledWith('T1');
    expect(mockHost.browserControlApprove).toHaveBeenCalled();
  });

  it('attach does NOT approve when attach fails', async () => {
    mockHost.browserControlAttach.mockResolvedValueOnce({ ok: false, reason: 'nope' });
    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('disconnected'));

    await act(async () => {
      await result.current.attach('T1');
    });
    expect(mockHost.browserControlApprove).not.toHaveBeenCalled();
  });

  it('revoke calls the host then re-syncs status', async () => {
    mockHost.browserControlStatus
      .mockResolvedValueOnce({ available: true, state: 'connected', domain: 'example.com' })
      .mockResolvedValue({ available: false, state: 'disconnected' });

    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('connected'));

    await act(async () => {
      await result.current.revoke();
    });
    expect(mockHost.browserControlRevoke).toHaveBeenCalled();
    await waitFor(() => expect(result.current.state).toBe('disconnected'));
  });

  it('takeOver calls the host then re-syncs status', async () => {
    const { result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('disconnected'));

    await act(async () => {
      await result.current.takeOver();
    });
    expect(mockHost.browserControlTakeOver).toHaveBeenCalled();
  });

  it('unsubscribes on unmount', async () => {
    const { unmount, result } = renderHook(() => useBrowserControl());
    await waitFor(() => expect(result.current.state).toBe('disconnected'));
    expect(stateListeners.length).toBe(1);
    unmount();
    expect(stateListeners.length).toBe(0);
  });
});
