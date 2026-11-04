// The shared page's transport: reads the owner's live copy, sends an edit, and
// resolves it when the desktop reports back over the stream (or a poll).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCloudTransport } from './cloudTransport';

const API = '/v1/viewer/artifact-docs/215f76ea7/4bbd890f';
const doc = (rev) => ({ schema: 'cowork.doc/1', id: 'a1', title: 'Plan', rev, tabs: [{ id: 't_1', title: 'Plan', blocks: [] }] });

function json(body, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

class FakeSource {
  static last = null;
  static CLOSED = 2;
  constructor(url, opts) { this.url = url; this.opts = opts; this.handlers = {}; this.closed = false; this.readyState = 0; FakeSource.last = this; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { this.handlers[type]?.({ data: JSON.stringify(data) }); }
  /** As a browser does with a stream answered other than 200: closed for good. */
  refuse() { this.readyState = FakeSource.CLOSED; this.onerror?.(new Event('error')); }
  close() { this.closed = true; }
}

const LAPSED = { error: 'artifact access required' };

afterEach(() => { vi.useRealTimers(); });

describe('cloud transport', () => {
  it('reads the live copy and says whether the desktop is there', async () => {
    const onPresence = vi.fn();
    const fetchImpl = vi.fn(async () => json({ doc: doc(3), rev: 3, ownerOnline: true, capabilities: { canEdit: true } }));
    const t = createCloudTransport(API, { onPresence, fetchImpl });
    const res = await t.fetchDoc();
    expect(res.doc.rev).toBe(3);
    expect(res.capabilities).toEqual({ canEdit: true });
    expect(onPresence).toHaveBeenCalledWith(true);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/state`);
    expect(fetchImpl.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it('takes a copy that says nothing about editing as not editable, as boot() does', async () => {
    const fetchImpl = vi.fn(async () => json({ doc: doc(3), rev: 3, ownerOnline: true }));
    const res = await createCloudTransport(API, { fetchImpl }).fetchDoc();
    expect(res.capabilities).toEqual({ canEdit: false });
  });

  it('skips a stream frame that is not JSON and keeps listening', () => {
    const onPresence = vi.fn();
    const events = [];
    const t = createCloudTransport(API, { onPresence, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', { onEvent: (ev) => events.push(ev) });
    expect(() => FakeSource.last.handlers['doc.state']({ data: '<html>' })).not.toThrow();
    expect(() => FakeSource.last.handlers['doc.edit.result']({ data: '' })).not.toThrow();
    expect(onPresence).not.toHaveBeenCalled();
    FakeSource.last.emit('doc.state', { rev: 4, doc: doc(4) });
    expect(events).toEqual([{ type: 'doc.updated', rev: 4, doc: doc(4), by: 'user' }]);
  });

  it('sends an edit and resolves with the new copy once the desktop has applied it', async () => {
    const fetchImpl = vi.fn(async (url, opts) => (url.endsWith('/edits') ? json({ id: 'e1', status: 'pending', ownerOnline: true }, 202) : json({})));
    const t = createCloudTransport(API, { fetchImpl, EventSourceImpl: FakeSource });
    const events = [];
    t.followDoc('shared', 'shared', { onEvent: (ev) => events.push(ev) });
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }], tab: 't_1', clientId: 'c1', baseRev: 3 });
    await Promise.resolve();
    const [, opts] = fetchImpl.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ ops: [{ op: 'delete', target: 'b_1' }], tab: 't_1', clientId: 'c1', baseRev: 3 });
    // The desktop mirrors first, then reports.
    FakeSource.last.emit('doc.state', { rev: 4, doc: doc(4) });
    FakeSource.last.emit('doc.edit.result', { id: 'e1', status: 'applied', rev: 4 });
    const res = await pending;
    expect(res.doc.rev).toBe(4);
    expect(events).toEqual([{ type: 'doc.updated', rev: 4, doc: doc(4), by: 'user' }]);
    expect(FakeSource.last.url).toBe(`${API}/stream`);
  });

  it('turns a refusal from the desktop into an error useDoc can show', async () => {
    const fetchImpl = vi.fn(async () => json({ id: 'e2', status: 'pending', ownerOnline: true }, 202));
    const t = createCloudTransport(API, { fetchImpl, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] });
    await Promise.resolve();
    FakeSource.last.emit('doc.edit.result', { id: 'e2', status: 'rejected', error: { code: 'stale', message: 'changed first' } });
    await expect(pending).rejects.toMatchObject({ code: 'stale', message: 'changed first' });
  });

  it('polls when the stream misses the answer', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/edits')) return json({ id: 'e3', status: 'pending', ownerOnline: true }, 202);
      if (url.endsWith('/edits/e3')) return json({ id: 'e3', status: 'applied', rev: 5 });
      return json({ doc: doc(5), rev: 5, ownerOnline: true });
    });
    const t = createCloudTransport(API, { fetchImpl });
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] });
    await vi.advanceTimersByTimeAsync(1600);
    const res = await pending;
    expect(res.doc.rev).toBe(5);
  });

  it('defers an edit a desktop does not answer, says it is away, and answers once it is back', async () => {
    // Found in review: the wait ended as a refusal, and the page threw away
    // everything typed after the edit, which MindsHub was still holding.
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const onDeferred = vi.fn();
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/edits')
      ? json({ id: 'e4', status: 'pending', ownerOnline: true }, 202)
      : json({ id: 'e4', status: 'pending' })));
    const t = createCloudTransport(API, { fetchImpl, onPresence, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const settled = vi.fn();
    t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred }).then(settled, settled);
    // Not a long "Saving…": a desktop that is there answers within seconds.
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onDeferred).toHaveBeenCalledTimes(1);
    expect(onDeferred.mock.calls[0][0]).toMatchObject({ code: 'owner_offline' });
    expect(onPresence).toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(settled).not.toHaveBeenCalled();

    FakeSource.last.emit('doc.state', { rev: 2, doc: doc(2) });
    FakeSource.last.emit('doc.edit.result', { id: 'e4', status: 'applied', rev: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledWith({ doc: doc(2), rev: 2 });
    expect(onDeferred).toHaveBeenCalledTimes(1);
  });

  it('polls for a deferred edit\'s answer slowly, in case the stream misses it', async () => {
    vi.useFakeTimers();
    let answered = false;
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/edits')) return json({ id: 'e8', status: 'pending', ownerOnline: true }, 202);
      if (url.endsWith('/edits/e8')) return json({ id: 'e8', status: answered ? 'applied' : 'pending', rev: 3 });
      return json({ doc: doc(3), rev: 3, ownerOnline: true });
    });
    const t = createCloudTransport(API, { fetchImpl });
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred: () => {} });
    await vi.advanceTimersByTimeAsync(12_000);
    const polls = () => fetchImpl.mock.calls.filter(([url]) => url.endsWith('/edits/e8')).length;
    const before = polls();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(polls() - before).toBeLessThanOrEqual(6);
    answered = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(pending).resolves.toMatchObject({ rev: 3 });
  });

  it('keeps the desktop away after an unanswered edit until the desktop itself is heard from', async () => {
    // An app that crashed or quit stays "online" at the relay until its
    // presence lapses; useDoc rereads the doc straight after the timeout.
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/edits')) return json({ id: 'e6', status: 'pending', ownerOnline: true }, 202);
      if (url.endsWith('/edits/e6')) return json({ id: 'e6', status: 'pending' });
      return json({ doc: doc(1), rev: 1, ownerOnline: true });
    });
    const t = createCloudTransport(API, { fetchImpl, onPresence, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const onDeferred = vi.fn();
    t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onDeferred).toHaveBeenCalled();

    onPresence.mockClear();
    await t.fetchDoc();
    expect(onPresence).toHaveBeenLastCalledWith(false);

    // Back: it applies the queued edit and mirrors the new copy.
    FakeSource.last.emit('doc.state', { rev: 2, doc: doc(2) });
    expect(onPresence).toHaveBeenLastCalledWith(true);
    await t.fetchDoc();
    expect(onPresence).toHaveBeenLastCalledWith(true);
  });

  it('hears the desktop again from a late edit result', async () => {
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/edits')) return json({ id: 'e7', status: 'pending', ownerOnline: true }, 202);
      if (url.endsWith('/edits/e7')) return json({ id: 'e7', status: 'pending' });
      return json({ doc: doc(2), rev: 2, ownerOnline: true });
    });
    const t = createCloudTransport(API, { fetchImpl, onPresence, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred: () => {} });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onPresence).toHaveBeenLastCalledWith(false);
    // No copy on the stream first: the new one is read.
    FakeSource.last.emit('doc.edit.result', { id: 'e7', status: 'applied', rev: 2 });
    expect(onPresence).toHaveBeenLastCalledWith(true);
    await expect(pending).resolves.toMatchObject({ rev: 2 });
  });

  it('says at once that the edit waits when the desktop is known to be away, and still answers it', async () => {
    vi.useFakeTimers();
    const onPresence = vi.fn();
    const onDeferred = vi.fn();
    const fetchImpl = vi.fn(async () => json({ id: 'e5', status: 'pending', ownerOnline: false }, 202));
    const t = createCloudTransport(API, { fetchImpl, onPresence, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred });
    await vi.advanceTimersByTimeAsync(0);
    expect(onDeferred.mock.calls[0][0]).toMatchObject({ code: 'owner_offline' });
    expect(onPresence).toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no quick polling for an answer that can't come yet

    FakeSource.last.emit('doc.state', { rev: 6, doc: doc(6) });
    FakeSource.last.emit('doc.edit.result', { id: 'e5', status: 'applied', rev: 6 });
    await expect(pending).resolves.toMatchObject({ rev: 6 });
  });

  it('stops at a lapsed grant: says so, closes the stream, polls no more, and keeps the edit waiting', async () => {
    // The door's grant lapses (a laptop asleep past its ten minutes, say), and
    // every call through it is then refused until the page loads again.
    vi.useFakeTimers();
    const onLapsed = vi.fn();
    const fetchImpl = vi.fn(async (url) => (url.endsWith('/edits')
      ? json({ id: 'e9', status: 'pending', ownerOnline: true }, 202)
      : json(LAPSED, 403)));
    const t = createCloudTransport(API, { fetchImpl, onLapsed, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const settled = vi.fn();
    t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }, { onDeferred: () => {} }).then(settled, settled);
    await vi.advanceTimersByTimeAsync(1600);
    expect(onLapsed).toHaveBeenCalledTimes(1);
    expect(FakeSource.last.closed).toBe(true);
    const calls = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    expect(settled).not.toHaveBeenCalled();
    await expect(t.fetchDoc()).rejects.toMatchObject({ code: 'grant_lapsed' });
    expect(fetchImpl).toHaveBeenCalledTimes(calls);
    expect(onLapsed).toHaveBeenCalledTimes(1);
  });

  it('keeps an edit the door turned away for a lapsed grant waiting, not refused', async () => {
    const onLapsed = vi.fn();
    const fetchImpl = vi.fn(async () => json(LAPSED, 403));
    const t = createCloudTransport(API, { fetchImpl, onLapsed });
    const settled = vi.fn();
    t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] }).then(settled, settled);
    await vi.waitFor(() => expect(onLapsed).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
  });

  it('asks the door why when the stream is refused, and hears a lapsed grant', async () => {
    const onLapsed = vi.fn();
    const fetchImpl = vi.fn(async () => json(LAPSED, 403));
    const t = createCloudTransport(API, { fetchImpl, onLapsed, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    FakeSource.last.onerror(new Event('error')); // reconnecting on its own: nothing to ask
    expect(fetchImpl).not.toHaveBeenCalled();
    FakeSource.last.refuse();
    await vi.waitFor(() => expect(onLapsed).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][0]).toBe(`${API}/state`);
  });

  it('opens a stream the server refused again, waiting longer each time, and rereads once it is back', async () => {
    vi.useFakeTimers();
    const onReconnect = vi.fn();
    const fetchImpl = vi.fn(async () => json({ doc: doc(3), rev: 3, ownerOnline: true }));
    const t = createCloudTransport(API, { fetchImpl, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', { onReconnect });
    const first = FakeSource.last;
    first.onopen();
    first.refuse(); // a 5xx while MindsHub rolls out
    await vi.advanceTimersByTimeAsync(1_999);
    expect(FakeSource.last).toBe(first);
    await vi.advanceTimersByTimeAsync(1);
    const second = FakeSource.last;
    expect(second).not.toBe(first);
    second.refuse();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeSource.last).toBe(second); // the second wait is longer
    await vi.advanceTimersByTimeAsync(3_000);
    FakeSource.last.onopen();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('opens no stream again after the grant lapsed, sharing stopped, or the page stopped following', async () => {
    vi.useFakeTimers();
    const lapsedT = createCloudTransport(API, { fetchImpl: async () => json(LAPSED, 403), EventSourceImpl: FakeSource });
    lapsedT.followDoc('shared', 'shared', {});
    const refusedForGood = FakeSource.last;
    refusedForGood.refuse();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSource.last).toBe(refusedForGood);

    const fine = async () => json({ doc: doc(3), rev: 3, ownerOnline: true });
    const removedT = createCloudTransport(API, { fetchImpl: fine, EventSourceImpl: FakeSource });
    removedT.followDoc('shared', 'shared', {});
    const removed = FakeSource.last;
    removed.emit('doc.removed', {});
    removed.refuse();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSource.last).toBe(removed);

    const stoppedT = createCloudTransport(API, { fetchImpl: fine, EventSourceImpl: FakeSource });
    const stop = stoppedT.followDoc('shared', 'shared', {});
    const left = FakeSource.last;
    left.refuse();
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(FakeSource.last).toBe(left);
  });

  it('takes a 401 for the session, not the grant, and any other 403 as an error', async () => {
    const onLapsed = vi.fn();
    const signedOut = createCloudTransport(API, { onLapsed, fetchImpl: async () => json({ error: 'view session required' }, 401) });
    await expect(signedOut.fetchDoc()).rejects.toMatchObject({ status: 401, message: 'Request failed (401)' });
    const refused = createCloudTransport(API, { onLapsed, fetchImpl: async () => json({ detail: { code: 'not_owner', message: 'Only the owner can edit this doc' } }, 403) });
    await expect(refused.fetchDoc()).rejects.toMatchObject({ status: 403, code: 'not_owner', message: 'Only the owner can edit this doc' });
    const plain = createCloudTransport(API, { onLapsed, fetchImpl: async () => json({ detail: 'Not mirrored' }, 404) });
    await expect(plain.fetchDoc()).rejects.toMatchObject({ status: 404, message: 'Not mirrored' });
    expect(onLapsed).not.toHaveBeenCalled();
  });

  it('rereads after the stream reconnects, not when it first opens', () => {
    const onReconnect = vi.fn();
    const t = createCloudTransport(API, { EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', { onReconnect });
    FakeSource.last.onopen();
    expect(onReconnect).not.toHaveBeenCalled();
    FakeSource.last.onopen();
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('follows nothing where the browser has no event streams', () => {
    vi.stubGlobal('EventSource', undefined);
    try {
      const stop = createCloudTransport(API).followDoc('shared', 'shared', {});
      expect(() => stop()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps an answer that comes over the stream before the edit is acknowledged', async () => {
    let acknowledge;
    const fetchImpl = vi.fn((url) => (url.endsWith('/edits')
      ? new Promise((resolve) => { acknowledge = () => resolve(json({ id: 'e10', status: 'pending', ownerOnline: true }, 202)); })
      : Promise.resolve(json({}))));
    const t = createCloudTransport(API, { fetchImpl, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] });
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'));
    FakeSource.last.emit('doc.state', { rev: 8, doc: doc(8) });
    FakeSource.last.emit('doc.edit.result', { id: 'e10', status: 'applied', rev: 8 });
    acknowledge();
    await expect(pending).resolves.toMatchObject({ rev: 8 });
  });

  it('words a refusal the desktop gave no reason for', async () => {
    const fetchImpl = vi.fn(async () => json({ id: 'e11', status: 'pending', ownerOnline: true }, 202));
    const t = createCloudTransport(API, { fetchImpl, EventSourceImpl: FakeSource });
    t.followDoc('shared', 'shared', {});
    const pending = t.postDocOps('shared', 'shared', { ops: [{ op: 'delete', target: 'b_1' }] });
    await Promise.resolve();
    FakeSource.last.emit('doc.edit.result', { id: 'e11', status: 'rejected' });
    await expect(pending).rejects.toMatchObject({ message: 'That edit was not saved.' });
  });

  it('says so when sharing stops', () => {
    const onRemoved = vi.fn();
    const t = createCloudTransport(API, { EventSourceImpl: FakeSource, onRemoved });
    t.followDoc('shared', 'shared', {});
    FakeSource.last.emit('doc.removed', {});
    expect(onRemoved).toHaveBeenCalled();
    expect(FakeSource.last.closed).toBe(true);
  });
});
