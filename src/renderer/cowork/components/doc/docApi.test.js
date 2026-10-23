// The doc event follower: reconnects a stream that dropped, but gives up on
// one that never opened, so no retry loop outlives an unreachable route.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({ authFetch: vi.fn() }));
vi.mock('../../api', () => ({ BASE: '/api/v1', authFetch: (...a) => api.authFetch(...a) }));

const { fetchDoc, followConversationDocs, postDocOps } = await import('./docApi');

beforeEach(() => { vi.useFakeTimers(); api.authFetch.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('follow', () => {
  it('stops trying a stream that never opened', async () => {
    api.authFetch.mockRejectedValue(new TypeError('network down'));
    const stop = followConversationDocs('conv-1', { onEvent: () => {} });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.authFetch).toHaveBeenCalledTimes(3);
    expect(api.authFetch.mock.calls[0][0]).toBe('/api/v1/docs/events?conversation_id=conv-1');
    stop();
  });

  it('keeps reconnecting a stream that opened and dropped', async () => {
    const opened = { ok: true, status: 200, body: new ReadableStream({ start: (c) => c.close() }) };
    api.authFetch.mockResolvedValueOnce(opened).mockRejectedValue(new TypeError('network down'));
    const onReconnect = vi.fn();
    const stop = followConversationDocs('conv-1', { onEvent: () => {}, onReconnect });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.authFetch.mock.calls.length).toBeGreaterThan(3);
    stop();
  });

  it.each([400, 404, 422])('does not retry a request the server refuses (%i)', async (status) => {
    api.authFetch.mockResolvedValue({ ok: false, status });
    followConversationDocs('conv-1', {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.authFetch).toHaveBeenCalledTimes(1);
  });

  it('asks again after a rate limit', async () => {
    api.authFetch.mockResolvedValue({ ok: false, status: 429 });
    const stop = followConversationDocs('conv-1', {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.authFetch).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe('a request\'s answer', () => {
  const refusal = (status, body) => ({ ok: false, status, json: async () => body });

  it('is the doc it read, asked for as JSON', async () => {
    api.authFetch.mockResolvedValue({ ok: true, json: async () => ({ doc: { rev: 5 } }) });
    await expect(fetchDoc(null, 'a 1')).resolves.toEqual({ doc: { rev: 5 } });
    const [url, init] = api.authFetch.mock.calls[0];
    expect(url).toBe('/api/v1/docs/local/a%201');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('carries a refusal\'s message, status and code', async () => {
    const detail = { message: 'no such block', code: 'no_block' };
    api.authFetch.mockResolvedValue(refusal(422, { detail }));
    await expect(fetchDoc('p1', 'a1')).rejects.toMatchObject({ message: 'no such block', status: 422, code: 'no_block', detail });
  });

  it('reads a refusal given as plain words', async () => {
    api.authFetch.mockResolvedValue(refusal(404, { detail: 'Doc not found' }));
    await expect(fetchDoc('p1', 'a1')).rejects.toMatchObject({ message: 'Doc not found', status: 404, code: undefined });
  });

  it('names the status when the server says nothing readable', async () => {
    api.authFetch.mockResolvedValue(refusal(409, { detail: { code: 'stale' } }));
    await expect(fetchDoc('p1', 'a1')).rejects.toMatchObject({ message: 'Doc request failed (409)', status: 409, code: 'stale' });
    api.authFetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('not JSON'); } });
    await expect(fetchDoc('p1', 'a1')).rejects.toMatchObject({ message: 'Doc request failed (502)', status: 502, detail: null });
  });

  it('is a network error as fetch gives it', async () => {
    api.authFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchDoc('p1', 'a1')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('postDocOps', () => {
  it('sends the body the local server reads', async () => {
    api.authFetch.mockResolvedValue({ ok: true, json: async () => ({ doc: { rev: 5 } }) });
    const ops = [{ op: 'delete', target: ['b_1'] }];
    await postDocOps('p1', 'a1', { ops, tab: 't_1', clientId: 'client_1' });
    const [url, init] = api.authFetch.mock.calls[0];
    expect(url).toBe('/api/v1/docs/p1/a1/ops');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ ops, tab: 't_1', clientId: 'client_1' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on an edit not answered in 30 s, as one whose outcome is unknown', async () => {
    // Found in review: an edit the server never answered held the queue, and
    // everything typed after it, for as long as the request hung.
    let signal;
    api.authFetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init.signal;
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const sent = postDocOps('p1', 'a1', { ops: [], clientId: 'client_1' });
    const settled = expect(sent).rejects.toMatchObject({ code: 'timeout', message: 'The server took too long to answer.' });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    await expect(sent).rejects.not.toHaveProperty('status');
  });

  it('keeps an answer that came in time as it was', async () => {
    api.authFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(postDocOps('p1', 'a1', { ops: [], clientId: 'client_1' })).rejects.toMatchObject({ status: 500, message: 'Doc request failed (500)' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useConversationDocs', () => {
  it('waits for the real id before following a new chat', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useConversationDocs } = await import('./useConversationDocs');
    api.authFetch.mockResolvedValue({ ok: false, status: 404 });
    const { rerender, unmount } = renderHook(({ id }) => useConversationDocs(id, {}), { initialProps: { id: 'tmp-1729' } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.authFetch).not.toHaveBeenCalled();
    rerender({ id: '5b0c2f4e-1d7a-4c39-9a51-0e2f6f1d3b8a' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.authFetch).toHaveBeenCalledTimes(1);
    expect(api.authFetch.mock.calls[0][0]).toContain('conversation_id=5b0c2f4e-1d7a-4c39-9a51-0e2f6f1d3b8a');
    unmount();
  });
});
