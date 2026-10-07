import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The Server and Agent rows read /health once on mount. On 6 October that one
// read hung behind a full connection pool and the rows showed a dash for the
// whole session (ENG-3291). They now say when the read is unavailable and keep
// retrying while the panel is open.

const healthMock = vi.hoisted(() => ({ impl: null }));
vi.mock('../../api', () => ({
  fetchHealth: vi.fn((...args) => healthMock.impl(...args)),
}));
vi.mock('../../../platform/host', () => ({
  host: {
    isElectron: true,
    getPlatform: () => 'darwin',
    checkForUpdates: vi.fn(),
    applyUpdate: vi.fn(),
  },
  getVersionInfo: vi.fn(async () => ({ app: '2.26.10.4.1', ui: null, source: 'bundled', buildKind: 'prod' })),
  isElectron: true,
}));
vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));

import UpdatesSection, { BACKEND_VERSION_RETRY_MS, BACKEND_VERSION_TIMEOUT_MS } from './UpdatesSection';
import { copyText } from '../../lib/clipboard';

function neverSettles() { return new Promise(() => {}); }

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

async function openDetails() {
  fireEvent.click(screen.getByRole('button', { name: /^Details$/ }));
}

describe('UpdatesSection backend versions (ENG-3291)', () => {
  it('shows Unavailable when /health gives no answer within the bound, then the versions once it does', async () => {
    let calls = 0;
    healthMock.impl = vi.fn(() => {
      calls += 1;
      // First read hangs for good; the retry answers.
      if (calls === 1) return neverSettles();
      return Promise.resolve({ status: 'ok', server_version: '0.26.10.5.2', anton_version: '2.26.10.5.1' });
    });
    render(<UpdatesSection serverOnline footer={null} />);
    await act(async () => {});
    await openDetails();
    expect(screen.getAllByText("Loading…")).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(BACKEND_VERSION_TIMEOUT_MS + 10); });
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(BACKEND_VERSION_RETRY_MS + 10); });
    expect(screen.getByText('0.26.10.5.2')).toBeInTheDocument();
    expect(screen.getByText('2.26.10.5.1')).toBeInTheDocument();
    expect(screen.queryByText('Unavailable')).toBeNull();
  });

  it('marks a failed read unavailable and retries it', async () => {
    let calls = 0;
    healthMock.impl = vi.fn(() => {
      calls += 1;
      return Promise.resolve(calls === 1
        ? { status: 'offline', anton_available: false }
        : { status: 'ok', server_version: '0.26.10.5.2', anton_version: '2.26.10.5.1' });
    });
    render(<UpdatesSection serverOnline footer={null} />);
    await act(async () => {});
    await openDetails();
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKEND_VERSION_RETRY_MS + 10); });
    expect(screen.getByText('0.26.10.5.2')).toBeInTheDocument();
    expect(healthMock.impl).toHaveBeenCalledTimes(2);
  });

  it('copies the explicit state into the details, not a dash', async () => {
    healthMock.impl = vi.fn(() => Promise.resolve({ status: 'offline' }));
    render(<UpdatesSection serverOnline footer={null} />);
    await act(async () => {});
    await openDetails();
    fireEvent.click(screen.getByRole('button', { name: /^Copy$/ }));
    await act(async () => {});
    const copied = copyText.mock.calls[0][0];
    expect(copied).toMatch(/Server: Unavailable/);
    expect(copied).toMatch(/Agent: Unavailable/);
    expect(copied).not.toMatch(/Server: —/);
  });

  it('passes the bound to fetchHealth and stops retrying once answered', async () => {
    healthMock.impl = vi.fn(() => Promise.resolve({ status: 'ok', server_version: '0.26.10.5.2', anton_version: '2.26.10.5.1' }));
    render(<UpdatesSection serverOnline footer={null} />);
    await act(async () => {});
    expect(healthMock.impl).toHaveBeenCalledWith({ timeoutMs: BACKEND_VERSION_TIMEOUT_MS });
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKEND_VERSION_RETRY_MS * 3); });
    expect(healthMock.impl).toHaveBeenCalledTimes(1);
  });
});
