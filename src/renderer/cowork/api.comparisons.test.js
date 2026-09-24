import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: {
    isWeb: false,
    isElectron: true,
    getApiOrigin: () => 'http://127.0.0.1:26866',
    getAccessToken: vi.fn(async () => null),
  },
}));

import { createComparison, fetchComparisons } from './api';

const res = (status, body = {}) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

afterEach(() => vi.unstubAllGlobals());

// The renderer bundle updates over the air ahead of the sidecar, so the
// Compare screen must tell "this server has no comparisons" apart from "none
// yet" and from a real failure.
describe('fetchComparisons', () => {
  it('returns the list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { comparisons: [{ id: 'c1' }] })));
    expect(await fetchComparisons()).toEqual([{ id: 'c1' }]);
  });

  it('is null on a server that predates comparisons', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(404, { detail: 'Not Found' })));
    expect(await fetchComparisons()).toBeNull();
  });

  it('still fails on a real error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(500, { detail: 'boom' })));
    await expect(fetchComparisons()).rejects.toThrow('boom');
  });
});

describe('createComparison', () => {
  it('omits an effort nobody picked and an empty start', async () => {
    const fetchMock = vi.fn(async () => res(201, { id: 'c1' }));
    vi.stubGlobal('fetch', fetchMock);
    await createComparison({ title: 't', sides: [{ model: 'kimi', reasoningEffort: null }, { model: 'qwen', reasoningEffort: 'xhigh' }] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/comparisons\/$/);
    expect(JSON.parse(options.body)).toEqual({
      title: 't',
      sides: [{ model: 'kimi' }, { model: 'qwen', reasoningEffort: 'xhigh' }],
    });
  });
});
