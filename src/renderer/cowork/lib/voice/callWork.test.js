import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportTurnEnd } from './turnEnds';
import { OWN_TURN_WAIT_MS, createCallWork, createQueueWatch, sendForOwnTurn } from './callWork';

// Stands in for the app's queue: a send into a busy task queues an item, the
// drain later runs it (watch.ran) and a Stop or removal drops it (sweep).
function fakeQueue(watch) {
  let queues = {};
  let seq = 0;
  return {
    send: (taskId, busy) => async (onQueued) => {
      if (!busy) return true;
      seq += 1;
      const id = `q_${seq}`;
      queues = { ...queues, [taskId]: [...(queues[taskId] || []), { id }] };
      onQueued(id);
      return true;
    },
    run(taskId) {
      const [head, ...rest] = queues[taskId];
      watch.ran(head.id, taskId);
      queues = { ...queues, [taskId]: rest };
      watch.sweep(queues);
    },
    drop(taskId) {
      queues = { ...queues, [taskId]: [] };
      watch.sweep(queues);
    },
  };
}

const settled = async (promise) => {
  let out = 'pending';
  promise.then((v) => { out = v; });
  await new Promise((r) => { setTimeout(r, 0); });
  return out;
};

afterEach(() => { vi.useRealTimers(); });

describe("the call's work", () => {
  it('is busy until each entry settles, and each entry has its own done', async () => {
    const list = createCallWork();
    const a = list.add({ request: 'A', taskId: 't1' });
    const b = list.add({ request: 'B', taskId: 't2' });
    expect(list.first()).toBe(a);
    expect(list.last()).toBe(b);
    expect(list.inTask('t2')).toEqual([b]);
    expect(b.settle()).toBe(true);
    expect(await settled(b.done)).toBeUndefined();
    expect(await settled(a.done)).toBe('pending');
    expect(list.busy()).toBe(true);
    list.clear();
    expect(list.busy()).toBe(false);
    expect(await settled(a.done)).toBeUndefined();
    // Cleared: settling again says it was no longer there.
    expect(a.settle()).toBe(false);
  });
});

describe('a request sent for its own turn', () => {
  it('sent at once, ends with the next turn in its task', async () => {
    const watch = createQueueWatch();
    const queue = fakeQueue(watch);
    const { sent, turn } = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: queue.send('t1', false) });
    expect(sent).toBe(true);
    reportTurnEnd(['t1'], { content: 'Done.' });
    await expect(turn).resolves.toEqual({ content: 'Done.', error: '' });
  });

  it('queued behind other work, waits for the turn its own item runs, not the one ahead', async () => {
    const watch = createQueueWatch();
    const queue = fakeQueue(watch);
    const x = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: queue.send('t1', true) });
    const y = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: queue.send('t1', true) });
    // The work ahead (Z) ends: neither queued request's turn yet.
    reportTurnEnd(['t1'], { content: 'Z' });
    expect(await settled(x.turn)).toBe('pending');
    queue.run('t1');
    reportTurnEnd(['t1'], { content: 'X' });
    await expect(x.turn).resolves.toEqual({ content: 'X', error: '' });
    expect(await settled(y.turn)).toBe('pending');
    queue.run('t1');
    reportTurnEnd(['t1'], { content: 'Y' });
    await expect(y.turn).resolves.toEqual({ content: 'Y', error: '' });
  });

  it('settles when its queue item is dropped before it runs (a Stop)', async () => {
    const watch = createQueueWatch();
    const queue = fakeQueue(watch);
    const { turn } = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: queue.send('t1', true) });
    queue.drop('t1');
    await expect(turn).resolves.toMatchObject({ error: expect.stringMatching(/taken off the queue/) });
  });

  it('gives up after a long while', async () => {
    vi.useFakeTimers();
    const watch = createQueueWatch();
    const queue = fakeQueue(watch);
    const { turn } = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: queue.send('t1', true) });
    await vi.advanceTimersByTimeAsync(OWN_TURN_WAIT_MS + 1);
    await expect(turn).resolves.toEqual({ timedOut: true });
  });

  it("says when the task couldn't take it", async () => {
    const watch = createQueueWatch();
    const { sent } = await sendForOwnTurn({ taskId: 't1', queueWatch: watch, send: async () => false });
    expect(sent).toBe(false);
  });
});
