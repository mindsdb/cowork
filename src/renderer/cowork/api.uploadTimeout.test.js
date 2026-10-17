// An attachment upload had no timeout. A send holds the app-wide stream slot
// while its files upload, so one that never answered blocked every send in the
// app until a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hostMock = vi.hoisted(() => ({
  isWeb: true,
  isElectron: false,
  getApiOrigin: () => 'http://127.0.0.1:26866',
  getAccessToken: vi.fn(async () => null),
}));
vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: hostMock,
}));

vi.mock('./lib/analytics', () => ({ setAntonInstallId: vi.fn() }));

import { uploadAttachments, uploadTimeoutMs } from './api';

let originalFetch;

beforeEach(() => {
  vi.useFakeTimers();
  originalFetch = global.fetch;
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

const hangingFetch = () => vi.fn((_url, opts) => new Promise((_resolve, reject) => {
  opts.signal.addEventListener('abort', () => {
    reject(new DOMException('The operation was aborted.', 'AbortError'));
  });
}));

describe('uploadTimeoutMs', () => {
  it('allows a minute plus time for the payload at about 1 Mbit/s', () => {
    expect(uploadTimeoutMs(0)).toBe(60_000);
    expect(uploadTimeoutMs(128 * 1000)).toBe(61_000);
    expect(uploadTimeoutMs(100 * 1024 * 1024)).toBeGreaterThan(14 * 60_000);
  });
});

describe('uploadAttachments', () => {
  it('gives up on an upload that never answers, and says so', async () => {
    global.fetch = hangingFetch();
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    const pending = uploadAttachments([file], { projectName: 'general', sessionId: 'conv-a' });
    const settled = expect(pending).rejects.toThrow(/stopped responding/i);
    await vi.advanceTimersByTimeAsync(uploadTimeoutMs(file.size));
    await settled;
  });

  it('passes a network error through untouched rather than calling it a timeout', async () => {
    const boom = new TypeError('Failed to fetch');
    global.fetch = vi.fn(async () => { throw boom; });

    await expect(uploadAttachments([new File(['x'], 'a.txt')], { projectName: 'general', sessionId: 'conv-a' }))
      .rejects.toBe(boom);
  });
});
