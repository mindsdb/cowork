import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./server-process', () => ({ getServerPort: () => 4000 }));
vi.mock('./server-auth', () => ({ authHeader: () => ({ Authorization: 'Bearer bearer' }) }));
vi.mock('./app-secret', () => ({ appSecretHeader: () => ({ 'X-Cowork-App-Secret': 'secret' }) }));

import { deleteRecord, listRecordIds, putHeld } from './custom-mcp-routes';

const ID = `cm-${'a'.repeat(32)}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A server that never answers; a request ends only when its signal aborts. */
function stuckServer(): void {
  vi.stubGlobal('fetch', vi.fn((_input: unknown, init: RequestInit = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
  })));
}

describe('calls to the local server', () => {
  it.each([
    ['the held hand-over', () => putHeld(ID, { access_token: 'AT' })],
    ['the record delete', () => deleteRecord(ID)],
    ['the record list', () => listRecordIds()],
  ])('give up on %s after a minute, so a stuck server never holds a connection\'s lock', async (_name, call) => {
    const timeout = new AbortController();
    const asked: number[] = [];
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      asked.push(ms);
      return timeout.signal;
    });
    stuckServer();

    const pending = call();
    expect(asked).toEqual([60_000]);
    timeout.abort();

    await expect(pending).rejects.toThrow();
  });
});
