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

import { host } from '../platform/host';
import { continueComparisonSide, createComparison, fetchComparisonUsage, fetchComparisons } from './api';

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

describe('fetchComparisonUsage', () => {
  it('asks as the signed-in MindsHub user', async () => {
    host.getAccessToken.mockResolvedValueOnce('jwt-1');
    const fetchMock = vi.fn(async () => res(200, { sides: { a: { available: true } } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchComparisonUsage('c 1')).toEqual({ sides: { a: { available: true } } });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/comparisons\/c%201\/usage$/);
    expect(new Headers(options.headers).get('X-MindsHub-Authorization')).toBe('Bearer jwt-1');
  });

  it.each([
    ['a server that predates it', () => res(404, { detail: 'Not Found' })],
    ['a failure', () => res(500, { detail: 'boom' })],
    ['a body without sides', () => res(200, {})],
  ])('is null on %s, so no figure shows', async (_, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    expect(await fetchComparisonUsage('c1')).toBeNull();
  });
});

describe('continueComparisonSide', () => {
  it('sends the model name for the folder, and leaves it out when there is none', async () => {
    const fetchMock = vi.fn(async () => res(200, { conversationId: 'c', projectId: 'p' }));
    vi.stubGlobal('fetch', fetchMock);
    await continueComparisonSide('cmp 1', 'a', 'p1', 'Claude Opus 5.5');
    await continueComparisonSide('cmp 1', 'b', 'p1');
    const [url, first] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/v1\/comparisons\/cmp%201\/sides\/a\/continue$/);
    expect(JSON.parse(first.body)).toEqual({ projectId: 'p1', modelLabel: 'Claude Opus 5.5' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ projectId: 'p1' });
  });
});
