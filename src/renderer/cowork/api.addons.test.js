// The two add-on calls (ENG-4194) never throw: every answer the app cannot use
// to add a message maps onto a status it queues on, including an older server
// that has no such route.
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

import { sendAddon, withdrawAddon, streamMessage, tailInFlight } from './api';
import { ADDON_REQUEST_TIMEOUT_MS } from './lib/addons';

let originalFetch;
const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe('sendAddon', () => {
  it('posts the conversation and text, and returns the verdict', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'added', addon_id: 'ad1', decided_by: 'jev' }));
    await expect(sendAddon('conv-1', 'also Q3')).resolves.toEqual({ status: 'added', addon_id: 'ad1', decided_by: 'jev' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/responses\/addon$/);
    expect(JSON.parse(opts.body)).toEqual({ conversation_id: 'conv-1', text: 'also Q3' });
  });

  it('sends force only for the person\'s own override', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'added', addon_id: 'ad1', decided_by: 'user' }));
    await sendAddon('conv-1', 'also Q3', { force: true });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ conversation_id: 'conv-1', text: 'also Q3', force: true });
  });

  it('names the running turn and the app\'s own key for the row', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'queued', reason: 'too_many' }));
    await sendAddon('conv-1', 'also Q3', { responseId: 'resp_1', localKey: 'a_k1-x' });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
      conversation_id: 'conv-1', text: 'also Q3', response_id: 'resp_1', local_key: 'a_k1-x',
    });
  });

  it('drops a local key the server would refuse', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'queued' }));
    await sendAddon('conv-1', 'also Q3', { localKey: 'has space' });
    await sendAddon('conv-1', 'also Q3', { localKey: 'x'.repeat(65) });
    for (const [, opts] of global.fetch.mock.calls) {
      expect(JSON.parse(opts.body)).toEqual({ conversation_id: 'conv-1', text: 'also Q3' });
    }
  });

  it('passes a queued verdict through with its reason', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'queued', reason: 'new_request' }));
    await expect(sendAddon('conv-1', 'email it')).resolves.toEqual({ status: 'queued', reason: 'new_request' });
  });

  it('tells no running turn apart from an older server without the route', async () => {
    global.fetch = vi.fn(async () => reply(404, { status: 'not_found' }));
    await expect(sendAddon('conv-1', 'x')).resolves.toEqual({ status: 'not_found' });
    global.fetch = vi.fn(async () => reply(404, { detail: 'Not Found' }));
    await expect(sendAddon('conv-1', 'x')).resolves.toEqual({ status: 'unsupported' });
    global.fetch = vi.fn(async () => reply(405, { detail: 'Method Not Allowed' }));
    await expect(sendAddon('conv-1', 'x')).resolves.toEqual({ status: 'unsupported' });
    global.fetch = vi.fn(async () => reply(500, { detail: 'boom' }));
    await expect(sendAddon('conv-1', 'x')).resolves.toEqual({ status: 'error' });
  });

  it('gives up after the add-on window and says timeout', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = sendAddon('conv-1', 'x');
    await vi.advanceTimersByTimeAsync(ADDON_REQUEST_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ status: 'timeout' });
  });

  it('does not call the server without a conversation', async () => {
    global.fetch = vi.fn();
    await expect(sendAddon(null, 'x')).resolves.toEqual({ status: 'not_found' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('withdrawAddon', () => {
  it('posts the add-on id and returns withdrawn', async () => {
    global.fetch = vi.fn(async () => reply(200, { status: 'withdrawn' }));
    await expect(withdrawAddon('conv-1', 'ad1')).resolves.toEqual({ status: 'withdrawn' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/responses\/addon\/withdraw$/);
    expect(JSON.parse(opts.body)).toEqual({ conversation_id: 'conv-1', addon_id: 'ad1' });
  });

  it('maps a 409 to already_read and a 404 to not_found', async () => {
    global.fetch = vi.fn(async () => reply(409, { status: 'already_read' }));
    await expect(withdrawAddon('conv-1', 'ad1')).resolves.toEqual({ status: 'already_read' });
    global.fetch = vi.fn(async () => reply(404, { status: 'not_found' }));
    await expect(withdrawAddon('conv-1', 'ad1')).resolves.toEqual({ status: 'not_found' });
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(withdrawAddon('conv-1', 'ad1')).resolves.toEqual({ status: 'error' });
  });
});

describe('a stream handle takes the app\'s own add-on rows', () => {
  it.each([
    ['streamMessage', (onEvent) => streamMessage('conv-1', 'hi', { onEvent })],
    ['tailInFlight', (onEvent) => tailInFlight('conv-1', { onEvent })],
  ])('%s: injectEvent reaches onEvent until the stream is aborted', async (_name, open) => {
    global.fetch = vi.fn(() => new Promise(() => {}));
    const onEvent = vi.fn();
    const ctrl = open(onEvent);
    const ev = { type: 'response.addon', state: 'sending', local_key: 'k1', text: 'also Q3' };
    ctrl.injectEvent(ev);
    expect(onEvent).toHaveBeenCalledWith(ev);
    ctrl.abort();
    ctrl.injectEvent(ev);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });
});

describe('a stream handle keeps its turn\'s response id', () => {
  const sse = (events) => new Response(new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      events.forEach((e) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)));
      c.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });

  it.each([
    ['streamMessage', (onEvent) => streamMessage('conv-1', 'hi', { onEvent })],
    ['tailInFlight', (onEvent) => tailInFlight('conv-1', { onEvent })],
  ])('%s: from response.created', async (_name, open) => {
    global.fetch = vi.fn(async () => sse([{ type: 'response.created', response: { id: 'resp_9' }, conversation_id: 'conv-1' }]));
    const onEvent = vi.fn();
    const ctrl = open(onEvent);
    expect(ctrl.responseId).toBeNull();
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalled());
    expect(ctrl.responseId).toBe('resp_9');
    ctrl.abort();
  });
});
