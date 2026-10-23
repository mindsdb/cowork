// useDoc against a fake transport: the write queue, rebasing other writers'
// changes under queued edits, and what happens when answers come back late.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AGENT_ACTIVE_MS, useDoc } from './useDoc';

const doc = (id, rev, blocks = [{ id: 'b_1', type: 'paragraph', text: 'One' }]) => ({
  schema: 'cowork.doc/1', id, title: id, rev, tabs: [{ id: 't_1', title: id, blocks }],
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Each fetch/post waits until the test answers it; the stream is driven by hand. */
function fakeTransport() {
  const t = {
    fetches: [],
    posts: [],
    streams: [],
    fetchDoc: vi.fn((_p, artifactId) => {
      const d = deferred();
      t.fetches.push({ artifactId, ...d });
      return d.promise;
    }),
    postDocOps: vi.fn((_p, artifactId, body) => {
      const d = deferred();
      t.posts.push({ artifactId, body, ...d });
      return d.promise;
    }),
    followDoc: vi.fn((_p, artifactId, handlers) => {
      t.streams.push({ artifactId, ...handlers });
      return () => {};
    }),
  };
  return t;
}

const texts = (d) => d?.tabs[0].blocks.map((b) => b.text);
const edit = (id, text) => [{ op: 'update', id, set: { text } }];

async function opened(t, id = 'a', rev = 1) {
  const hook = renderHook(({ artifactId }) => useDoc({ projectRef: 'p', artifactId, transport: t }), {
    initialProps: { artifactId: id },
  });
  await act(async () => { t.fetches.at(-1).resolve({ doc: doc(id, rev), capabilities: { canEdit: true } }); });
  return hook;
}

afterEach(() => { vi.useRealTimers(); });

describe('useDoc writes', () => {
  it('shows an edit at once and sends queued edits one at a time, in order', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    act(() => { result.current.apply(edit('b_1', 'Three'), { tab: 't_1' }); });
    expect(texts(result.current.doc)).toEqual(['Three']);
    expect(result.current.saving).toBe(true);
    expect(t.posts).toHaveLength(1);
    expect(t.posts[0].body).toMatchObject({ ops: edit('b_1', 'Two'), tab: 't_1' });

    await act(async () => { t.posts[0].resolve({ doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'Two' }]) }); });
    expect(t.posts).toHaveLength(2);
    expect(texts(result.current.doc)).toEqual(['Three']);
    await act(async () => { t.posts[1].resolve({ doc: doc('a', 3, [{ id: 'b_1', type: 'paragraph', text: 'Three' }]) }); });
    expect(result.current.doc.rev).toBe(3);
    expect(result.current.saving).toBe(false);
  });

  it('keeps an edit still waiting on top of a change from someone else', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Mine'), { tab: 't_1' }); });
    act(() => {
      t.streams[0].onEvent({
        type: 'doc.updated', by: 'agent', touched: { t_1: ['b_2'] },
        doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'One' }, { id: 'b_2', type: 'paragraph', text: 'Agent' }]),
      });
    });
    expect(texts(result.current.doc)).toEqual(['Mine', 'Agent']);
    expect(result.current.flash).toHaveProperty('b_2');
  });

  it('ignores the stream echo of its own write, not anyone else\'s', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Mine'), { tab: 't_1' }); });
    const { clientId } = t.posts[0].body;
    expect(clientId).toMatch(/^client_/);
    act(() => {
      t.streams[0].onEvent({ type: 'doc.updated', by: 'user', clientId, doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'Echo' }]) });
    });
    expect(texts(result.current.doc)).toEqual(['Mine']);
    act(() => {
      t.streams[0].onEvent({ type: 'doc.updated', by: 'user', clientId: 'client_other', doc: doc('a', 2, [{ id: 'b_9', type: 'paragraph', text: 'Theirs' }]) });
    });
    expect(texts(result.current.doc)).toEqual(['Theirs']);
  });

  it('shows a block once when a copy from the stream already holds the insert still waiting', async () => {
    // Found in review: on the shared page the copy carrying a person's own
    // edit comes back with no client id, before the edit's answer, so the
    // insert was replayed onto a copy that held it (every Enter showed twice).
    const t = fakeTransport();
    const { result } = await opened(t);
    const block = { id: 'b_new', type: 'paragraph', text: '' };
    act(() => { result.current.apply([{ op: 'insert', position: { after: 'b_1' }, blocks: [block] }], { tab: 't_1' }); });
    const ids = () => result.current.doc.tabs[0].blocks.map((b) => b.id);
    expect(ids()).toEqual(['b_1', 'b_new']);
    const holding = doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'One' }, block]);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'user', doc: holding }); });
    expect(ids()).toEqual(['b_1', 'b_new']);
    await act(async () => { t.posts[0].resolve({ doc: holding }); });
    expect(ids()).toEqual(['b_1', 'b_new']);
  });

  it('keeps a newer copy from the stream over a read that answers late', async () => {
    // Found in review: the read and the stream start together, and an agent
    // section that arrived first vanished under the older read.
    const t = fakeTransport();
    const { result } = renderHook(() => useDoc({ projectRef: 'p', artifactId: 'a', transport: t }));
    const agent = [{ id: 'b_1', type: 'paragraph', text: 'One' }, { id: 'b_2', type: 'paragraph', text: 'Agent' }];
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: { t_1: ['b_2'] }, doc: doc('a', 2, agent) }); });
    await act(async () => { t.fetches[0].resolve({ doc: doc('a', 1), capabilities: { canEdit: true } }); });
    expect(result.current.doc.rev).toBe(2);
    expect(texts(result.current.doc)).toEqual(['One', 'Agent']);
    expect(result.current.status).toBe('ready');
    expect(result.current.capabilities).toEqual({ canEdit: true });
  });

  it('rereads the doc when the stream skipped revisions', async () => {
    const t = fakeTransport();
    await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', gap: true, doc: doc('a', 5) }); });
    expect(t.fetchDoc).toHaveBeenCalledTimes(2);
  });

  it('rereads the doc when it is ready at a newer revision, and only then', async () => {
    const t = fakeTransport();
    renderHook(() => useDoc({ projectRef: 'p', artifactId: 'a', transport: t }));
    // Nothing to compare with yet: the first read is still out.
    act(() => { t.streams[0].onEvent({ type: 'doc.ready', rev: 4 }); });
    expect(t.fetchDoc).toHaveBeenCalledTimes(1);
    await act(async () => { t.fetches[0].resolve({ doc: doc('a', 2) }); });
    act(() => { t.streams[0].onEvent({ type: 'doc.ready', rev: 2 }); });
    expect(t.fetchDoc).toHaveBeenCalledTimes(1);
    act(() => { t.streams[0].onEvent({ type: 'doc.ready', rev: 3 }); });
    expect(t.fetchDoc).toHaveBeenCalledTimes(2);
  });

  it('ignores a stream event that carries no doc', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', rev: 9 }); });
    act(() => { t.streams[0].onEvent({ type: 'doc.deleted', rev: 9 }); });
    expect(result.current.doc.rev).toBe(1);
  });

  it('keeps a newer copy from the stream over a write answer that is older', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Mine'), { tab: 't_1' }); });
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: {}, doc: doc('a', 3, [{ id: 'b_1', type: 'paragraph', text: 'Agent' }]) }); });
    await act(async () => { t.posts[0].resolve({ doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'Mine' }]) }); });
    expect(result.current.doc.rev).toBe(3);
  });

  it('sends nothing for no ops, or before the doc has loaded', async () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useDoc({ projectRef: 'p', artifactId: 'a', transport: t }));
    await expect(result.current.apply(edit('b_1', 'Early'))).resolves.toBeNull();
    await act(async () => { t.fetches[0].resolve({ doc: doc('a', 1) }); });
    await expect(result.current.apply([])).resolves.toBeNull();
    expect(t.posts).toHaveLength(0);
  });

  it('opens nothing without a doc', () => {
    const t = fakeTransport();
    const { result } = renderHook(() => useDoc({ projectRef: 'p', artifactId: null, transport: t }));
    expect(result.current.doc).toBeNull();
    expect(t.fetchDoc).not.toHaveBeenCalled();
    expect(t.followDoc).not.toHaveBeenCalled();
  });

  it('drops only a refused write, and sends what was queued behind it on the doc as it now stands', async () => {
    // Found in review: one refusal dropped every edit queued behind it, so
    // whatever was typed while the refused edit was out was lost too.
    const t = fakeTransport();
    const lead = { id: 'b_1', type: 'paragraph', text: 'One' };
    const { result } = renderHook(() => useDoc({ projectRef: 'p', artifactId: 'a', transport: t }));
    await act(async () => { t.fetches[0].resolve({ doc: doc('a', 1, [lead, { id: 'b_2', type: 'paragraph', text: 'Two' }]) }); });
    let refused;
    let kept;
    let orphaned;
    act(() => { refused = result.current.apply(edit('b_1', 'Refused'), { tab: 't_1' }); });
    act(() => { kept = result.current.apply(edit('b_1', 'Kept'), { tab: 't_1' }); });
    act(() => { orphaned = result.current.apply(edit('b_2', 'Orphaned'), { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(Object.assign(new Error('no such block'), { status: 422 })); });
    expect(result.current.writeError.message).toBe('no such block');
    await expect(refused).resolves.toBeNull();
    // The rest waits for the reread, and is checked against it.
    expect(t.fetches).toHaveLength(2);
    expect(t.posts).toHaveLength(1);

    // Someone deleted b_2 meanwhile: the edit to it no longer applies.
    await act(async () => { t.fetches[1].resolve({ doc: doc('a', 2, [lead]) }); });
    await expect(orphaned).resolves.toBeNull();
    expect(texts(result.current.doc)).toEqual(['Kept']);
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].body.ops).toEqual(edit('b_1', 'Kept'));
    await act(async () => { t.posts[1].resolve({ doc: doc('a', 3, [{ ...lead, text: 'Kept' }]) }); });
    await expect(kept).resolves.toMatchObject({ doc: { rev: 3 } });
    expect(t.posts).toHaveLength(2);
    expect(result.current.saving).toBe(false);
    act(() => { result.current.clearWriteError(); });
    expect(result.current.writeError).toBeNull();
  });

  it('keeps an edit only the server can work out behind a refused one', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Refused'), { tab: 't_1' }); });
    act(() => { result.current.apply([{ op: 'insert', position: { after: 'b_1' }, markdown: '- a\n- b' }], { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(Object.assign(new Error('stale'), { status: 409 })); });
    await act(async () => { t.fetches[1].resolve({ doc: doc('a', 2) }); });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].body.ops[0]).toMatchObject({ op: 'insert', markdown: '- a\n- b' });
  });
});

describe('useDoc while the server is unreachable', () => {
  it('waits out each retry, however much is typed meanwhile', async () => {
    // Found in review: each commit while offline (one every 450 ms of typing)
    // was sent at once, skipping the wait, and each failure left the previous
    // retry timer running where a reconnect could not cancel it.
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(new TypeError('Failed to fetch')); });
    act(() => { result.current.apply(edit('b_1', 'Three'), { tab: 't_1' }); });
    act(() => { result.current.apply(edit('b_1', 'Four'), { tab: 't_1' }); });
    expect(t.posts).toHaveLength(1);
    expect(texts(result.current.doc)).toEqual(['Four']);
    expect(result.current.writeError).toMatchObject({ code: 'offline' });

    // The stream coming back sends at once, the oldest edit first, and one
    // failure more waits the next, longer, step.
    act(() => { t.streams[0].onReconnect(); });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].body.ops).toEqual(edit('b_1', 'Two'));
    await act(async () => { t.posts[1].reject(new TypeError('Failed to fetch')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(t.posts).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(t.posts).toHaveLength(3);
    await act(async () => { t.posts[2].resolve({ doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'Two' }]) }); });
    expect(t.posts.map((p) => p.body.ops)).toEqual([edit('b_1', 'Two'), edit('b_1', 'Two'), edit('b_1', 'Two'), edit('b_1', 'Three')]);
    expect(result.current.writeError).toBeNull();
  });

  it('sends nothing more when the stream comes back with no retry waiting', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    act(() => { t.streams[0].onReconnect(); });
    expect(t.posts).toHaveLength(1);
    expect(t.fetchDoc).toHaveBeenCalledTimes(2);
  });
});

describe('useDoc when the server fails, or answers too late', () => {
  // Found in review: a 5xx was taken for "nothing reached the doc" and the
  // edit sent again, but the server gives an id it already holds a new one,
  // so an insert it had applied before failing landed twice, and again every
  // 8 s for as long as the failure lasted.
  const failed = (status) => Object.assign(new Error(`Doc request failed (${status})`), { status });
  const lead = { id: 'b_1', type: 'paragraph', text: 'One' };
  const added = { id: 'b_new', type: 'paragraph', text: '' };
  const insert = [{ op: 'insert', position: { after: 'b_1' }, blocks: [added] }];

  it.each([
    ['a 5xx', failed(500)],
    ['a timeout', Object.assign(new Error('took too long'), { code: 'timeout' })],
  ])('does not send an insert again after %s, and shows it once when the reread holds it', async (_, error) => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(insert, { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(error); });
    expect(t.fetches).toHaveLength(2);
    await act(async () => { t.fetches[1].resolve({ doc: doc('a', 2, [lead, added]) }); });
    expect(result.current.doc.tabs[0].blocks.map((b) => b.id)).toEqual(['b_1', 'b_new']);
    expect(result.current.writeError).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(t.posts).toHaveLength(1);
    expect(result.current.saving).toBe(false);
  });

  it('says an edit the server failed on was not saved when the reread does not hold it', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result } = await opened(t);
    let sent;
    act(() => { sent = result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    const error = failed(502);
    await act(async () => { t.posts[0].reject(error); });
    // Not "offline": something answered, and nothing will be retried.
    expect(result.current.writeError).toBeNull();
    await act(async () => { t.fetches[1].resolve({ doc: doc('a', 1) }); });
    expect(result.current.writeError).toBe(error);
    expect(texts(result.current.doc)).toEqual(['One']);
    await expect(sent).resolves.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(t.posts).toHaveLength(1);
  });

  it('counts an edit that inserts nothing as landed when the reread already reads as it', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(failed(500)); });
    await act(async () => { t.fetches[1].resolve({ doc: doc('a', 2, [{ ...lead, text: 'Two', by: 'user' }]) }); });
    expect(result.current.writeError).toBeNull();
    expect(texts(result.current.doc)).toEqual(['Two']);
  });

  it('says it was not saved when the reread fails too, and carries on with the rest', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { result.current.apply(insert, { tab: 't_1' }); });
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    const error = failed(503);
    await act(async () => { t.posts[0].reject(error); });
    await act(async () => { t.fetches[1].reject(failed(503)); });
    expect(result.current.writeError).toBe(error);
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1].body.ops).toEqual(edit('b_1', 'Two'));
  });
});

describe('useDoc flashing what the agent wrote', () => {
  const withBlocks = (rev, ...ids) => doc('a', rev, ids.map((id) => ({ id, type: 'paragraph', text: id })));

  it('lights each block for a while from when the agent wrote it', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: { t_1: ['b_2'] }, doc: withBlocks(2, 'b_1', 'b_2') }); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: { t_1: ['b_3'] }, doc: withBlocks(3, 'b_1', 'b_2', 'b_3') }); });
    expect(Object.keys(result.current.flash).sort()).toEqual(['b_2', 'b_3']);
    act(() => { vi.advanceTimersByTime(800); });
    expect(Object.keys(result.current.flash)).toEqual(['b_3']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.flash).toEqual({});
  });

  it('leaves the next doc alone when the light on the previous one goes out', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result, rerender } = await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: { t_1: ['b_2'] }, doc: withBlocks(2, 'b_1', 'b_2') }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches.at(-1).resolve({ doc: doc('b', 1) }); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { t.streams.at(-1).onEvent({ type: 'doc.updated', by: 'agent', touched: { t_1: ['b_9'] }, doc: doc('b', 2, [{ id: 'b_9', type: 'paragraph', text: 'x' }]) }); });
    act(() => { vi.advanceTimersByTime(900); }); // the previous doc's light goes out
    expect(Object.keys(result.current.flash)).toEqual(['b_9']);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.flash).toEqual({});
  });

  it('lights nothing for a write that touched nothing, or that was not the agent\'s', async () => {
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', doc: withBlocks(2, 'b_1') }); });
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'user', touched: { t_1: ['b_1'] }, doc: withBlocks(3, 'b_1') }); });
    expect(result.current.flash).toEqual({});
  });
});

describe('useDoc "Agent is writing"', () => {
  it('turns itself off once the agent stops', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result } = await opened(t);
    act(() => { t.streams[0].onEvent({ type: 'doc.updated', by: 'agent', touched: {}, doc: doc('a', 2) }); });
    expect(result.current.agentActive).toBe(true);
    act(() => { vi.advanceTimersByTime(AGENT_ACTIVE_MS - 100); });
    expect(result.current.agentActive).toBe(true);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.agentActive).toBe(false);
  });
});

describe('useDoc switching docs', () => {
  it('does not let a slow read of the previous doc replace the next one', async () => {
    const t = fakeTransport();
    const { result, rerender } = renderHook(({ artifactId }) => useDoc({ projectRef: 'p', artifactId, transport: t }), {
      initialProps: { artifactId: 'a' },
    });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches[1].resolve({ doc: doc('b', 7) }); });
    await act(async () => { t.fetches[0].resolve({ doc: doc('a', 9) }); });
    expect(result.current.doc.id).toBe('b');
  });

  it('shows a read that failed, but not one that failed for the doc open before', async () => {
    const t = fakeTransport();
    const { result, rerender } = renderHook(({ artifactId }) => useDoc({ projectRef: 'p', artifactId, transport: t }), {
      initialProps: { artifactId: 'a' },
    });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches[0].reject(new Error('gone')); });
    expect(result.current.status).toBe('loading');
    await act(async () => { t.fetches[1].reject(new Error('Not found')); });
    expect(result.current.status).toBe('error');
    expect(result.current.error.message).toBe('Not found');
  });

  it('drops a refused write to the doc open before without touching the one open now', async () => {
    const t = fakeTransport();
    const { result, rerender } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches.at(-1).resolve({ doc: doc('b', 4) }); });
    await act(async () => { t.posts[0].reject(Object.assign(new Error('stale'), { status: 409 })); });
    expect(result.current.writeError).toBeNull();
    expect(result.current.doc.id).toBe('b');
    expect(t.fetches).toHaveLength(2); // no resync of a doc that is closed
  });

  it('says nothing on the next doc when the previous one\'s server could not be reached', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result, rerender } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches.at(-1).resolve({ doc: doc('b', 4) }); });
    await act(async () => { t.posts[0].reject(new TypeError('Failed to fetch')); });
    expect(result.current.writeError).toBeNull();
    expect(result.current.doc.id).toBe('b');
  });

  it('rereads only the doc open now when the previous one\'s write ended unknown', async () => {
    const t = fakeTransport();
    const { result, rerender } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches.at(-1).resolve({ doc: doc('b', 4) }); });
    await act(async () => { t.posts[0].reject(Object.assign(new Error('Doc request failed (502)'), { status: 502 })); });
    await act(async () => { t.fetches.at(-1).resolve({ doc: doc('b', 4) }); });
    expect(result.current.writeError).toBeNull();
    expect(result.current.doc).toMatchObject({ id: 'b', rev: 4 });
  });

  it('reads nothing when the stream reconnects after the doc closed', async () => {
    const t = fakeTransport();
    const { unmount } = await opened(t, 'a', 1);
    const stream = t.streams[0];
    unmount();
    act(() => { stream.onReconnect?.(); });
    expect(t.fetches).toHaveLength(1);
  });

  it('does not let a slow write to the previous doc land on the next one', async () => {
    const t = fakeTransport();
    const { result, rerender } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'For a'), { tab: 't_1' }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches[1].resolve({ doc: doc('b', 4) }); });
    act(() => { result.current.apply(edit('b_1', 'For b'), { tab: 't_1' }); });
    await waitFor(() => expect(t.posts).toHaveLength(2));
    expect(t.posts[1]).toMatchObject({ artifactId: 'b', body: { ops: edit('b_1', 'For b') } });

    await act(async () => { t.posts[0].resolve({ doc: doc('a', 50, [{ id: 'b_1', type: 'paragraph', text: 'For a' }]) }); });
    expect(result.current.doc.id).toBe('b');
    expect(texts(result.current.doc)).toEqual(['For b']);
    expect(result.current.saving).toBe(true);

    await act(async () => { t.posts[1].resolve({ doc: doc('b', 5, [{ id: 'b_1', type: 'paragraph', text: 'For b' }]) }); });
    expect(result.current.doc).toMatchObject({ id: 'b', rev: 5 });
    expect(result.current.saving).toBe(false);
  });

  it('still sends what was queued for the previous doc, to that doc', async () => {
    // Found by the editor engineer: edits queued behind one in flight were
    // dropped when another doc opened.
    const t = fakeTransport();
    const { result, rerender } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    act(() => { result.current.apply(edit('b_1', 'Three'), { tab: 't_1' }); });
    rerender({ artifactId: 'b' });
    await act(async () => { t.fetches[1].resolve({ doc: doc('b', 4) }); });

    await act(async () => { t.posts[0].resolve({ doc: doc('a', 2, [{ id: 'b_1', type: 'paragraph', text: 'Two' }]) }); });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1]).toMatchObject({ artifactId: 'a', body: { ops: edit('b_1', 'Three') } });
    await act(async () => { t.posts[1].resolve({ doc: doc('a', 3, [{ id: 'b_1', type: 'paragraph', text: 'Three' }]) }); });
    // None of it reaches the doc now open.
    expect(result.current.doc).toMatchObject({ id: 'b', rev: 4 });
    expect(texts(result.current.doc)).toEqual(['One']);
    expect(result.current.saving).toBe(false);
  });

  it('keeps retrying a closed doc\'s edit until its server answers', async () => {
    vi.useFakeTimers();
    const t = fakeTransport();
    const { result, unmount } = await opened(t, 'a', 1);
    act(() => { result.current.apply(edit('b_1', 'Two'), { tab: 't_1' }); });
    await act(async () => { t.posts[0].reject(new TypeError('Failed to fetch')); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(t.posts).toHaveLength(2);
    expect(t.posts[1]).toMatchObject({ artifactId: 'a', body: { ops: edit('b_1', 'Two') } });
    await act(async () => { t.posts[1].resolve({ doc: doc('a', 2) }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(t.posts).toHaveLength(2);
  });
});
