import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchBrowseStatus = vi.fn();
vi.mock('../api', () => ({ fetchBrowseStatus: (...args) => fetchBrowseStatus(...args) }));

import { READ_TIMEOUT_MS, readBrowseStatus } from './browseStatus';

const AVAILABLE = { enabled: true, available: true, status: 'running' };

function refusal(status) {
  return Object.assign(new Error(`API /browse/status returned ${status}`), { status });
}

describe('readBrowseStatus', () => {
  beforeEach(() => {
    fetchBrowseStatus.mockReset();
  });

  it("answers with the server's answer", async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    await expect(readBrowseStatus()).resolves.toEqual(AVAILABLE);
  });

  it('answers a 404 as a server without the browser does', async () => {
    fetchBrowseStatus.mockRejectedValue(refusal(404));
    await expect(readBrowseStatus()).resolves.toEqual({ enabled: true, available: false, status: 'unavailable' });
  });

  it.each([
    ['an offline read', () => new Error('offline')],
    ['a server that could not confirm the browser', () => refusal(424)],
    ['a MindsHub outage', () => refusal(503)],
    ['a read aborted at the time limit', () => new DOMException('The operation was aborted.', 'AbortError')],
  ])('rejects %s with its error', async (_name, failure) => {
    const error = failure();
    fetchBrowseStatus.mockRejectedValue(error);
    await expect(readBrowseStatus()).rejects.toBe(error);
  });

  it('asks api.js to abort a read with no answer at the time limit', async () => {
    fetchBrowseStatus.mockResolvedValue(AVAILABLE);
    await readBrowseStatus();
    expect(fetchBrowseStatus).toHaveBeenCalledWith({ timeoutMs: READ_TIMEOUT_MS });
  });

  it('waits longer than the server waits on the browser router', () => {
    // cowork-server's services/browser.py waits up to 15 s on the router, so the limit must be longer.
    expect(READ_TIMEOUT_MS).toBe(20_000);
  });
});
