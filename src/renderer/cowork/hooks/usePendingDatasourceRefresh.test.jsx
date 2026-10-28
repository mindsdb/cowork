// A list holding a pending connection refreshes itself until the check lands.
//
// Without this the composer keeps a database out of every chat, and the
// connections page keeps showing "pending", until the page is reloaded.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { act } from 'react';

import {
  PENDING_POLL_ATTEMPTS,
  PENDING_POLL_INTERVAL_MS,
  usePendingDatasourceRefresh,
} from './usePendingDatasourceRefresh';

function Harness({ rows, refresh, enabled }) {
  usePendingDatasourceRefresh(rows, refresh, enabled);
  return null;
}

const pending = [{ status: 'pending', name: 'analytics' }];
const verified = [{ status: 'connected', name: 'analytics' }];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms) {
  act(() => { vi.advanceTimersByTime(ms); });
}

describe('refreshing while a connection is checked', () => {
  it('refreshes again while a row is pending', () => {
    const refresh = vi.fn();
    render(<Harness rows={pending} refresh={refresh} enabled />);

    expect(refresh).not.toHaveBeenCalled();
    advance(PENDING_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('stops once nothing is pending', () => {
    const refresh = vi.fn();
    const { rerender } = render(<Harness rows={pending} refresh={refresh} enabled />);
    advance(PENDING_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender(<Harness rows={verified} refresh={refresh} enabled />);
    advance(PENDING_POLL_INTERVAL_MS * 5);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('gives up rather than polling a stuck connection forever', () => {
    const refresh = vi.fn();
    const { rerender } = render(<Harness rows={pending} refresh={refresh} enabled />);

    // Each answer still says pending, which is what a connection nobody could
    // validate looks like.
    for (let i = 0; i < PENDING_POLL_ATTEMPTS + 3; i += 1) {
      advance(PENDING_POLL_INTERVAL_MS);
      rerender(<Harness rows={[{ status: 'pending', name: 'analytics' }]} refresh={refresh} enabled />);
    }

    expect(refresh).toHaveBeenCalledTimes(PENDING_POLL_ATTEMPTS);
  });

  it('polls again for the next connection once the list settles', () => {
    const refresh = vi.fn();
    const { rerender } = render(<Harness rows={pending} refresh={refresh} enabled />);
    for (let i = 0; i < PENDING_POLL_ATTEMPTS + 2; i += 1) {
      advance(PENDING_POLL_INTERVAL_MS);
      rerender(<Harness rows={[{ status: 'pending', name: 'analytics' }]} refresh={refresh} enabled />);
    }
    expect(refresh).toHaveBeenCalledTimes(PENDING_POLL_ATTEMPTS);

    rerender(<Harness rows={verified} refresh={refresh} enabled />);
    advance(PENDING_POLL_INTERVAL_MS);
    rerender(<Harness rows={[{ status: 'pending', name: 'sales' }]} refresh={refresh} enabled />);
    advance(PENDING_POLL_INTERVAL_MS);

    expect(refresh).toHaveBeenCalledTimes(PENDING_POLL_ATTEMPTS + 1);
  });

  it('does nothing on a shell that has no relay', () => {
    const refresh = vi.fn();
    render(<Harness rows={pending} refresh={refresh} enabled={false} />);

    advance(PENDING_POLL_INTERVAL_MS * 5);

    expect(refresh).not.toHaveBeenCalled();
  });
});
