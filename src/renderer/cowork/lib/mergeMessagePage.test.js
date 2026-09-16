import { describe, it, expect } from 'vitest';
import { mergeMessagePage, reconcilePaginationState, pageReplacesLocalHistory } from './mergeMessagePage';

const m = (id, content) => ({ id, role: 'user', content });

describe('mergeMessagePage', () => {
  // Hydration appends id-less error/provider_required cards after a failed
  // turn wherever it sits in history, and the optimistic user row never has
  // an id of its own until response.created lands. Anything that treats "the
  // first row without an id" as a structural boundary therefore breaks on
  // ordinary conversations, not just exotic ones.

  it('is idempotent when the failed turn is the newest one', () => {
    // The common shape: a card is appended the moment a turn fails, so it
    // trails the last id-bearing row in the page and in local state alike.
    // An earlier fix only covered the mid-history position.
    const errorCard = { role: 'error', content: 'boom' };
    const page = [m('u1', 'q1'), m('a1', 'a1'), m('u2', 'q2'), m('a2', 'a2'), errorCard];
    let state = [...page];
    for (let i = 0; i < 4; i++) state = mergeMessagePage(state, page);
    expect(state.filter((r) => r.role === 'error')).toHaveLength(1);
    expect(state).toEqual(page);
  });

  it('keeps a live stub and an optimistic send that trail the page\'s own card', () => {
    const errorCard = { role: 'error', content: 'boom' };
    const echo = { role: 'user', content: 'asked again' };
    const stub = { role: '_streaming', content: 'typing…' };
    const page = [m('u1', 'q1'), m('a1', 'a1'), errorCard];
    const existing = [...page, echo, stub];
    expect(mergeMessagePage(existing, page)).toEqual([...page, echo, stub]);
  });

  it('is idempotent when the fresh page carries a mid-history error card', () => {
    const errorCard = { role: 'error', content: 'boom' };
    const page = [m('u1', 'q1'), m('a1', 'a1'), errorCard, m('u2', 'q2'), m('a2', 'a2')];
    let state = [...page];
    for (let i = 0; i < 4; i++) state = mergeMessagePage(state, page);
    expect(state).toEqual(page);
  });

  it('keeps older history above the newest page when an error card sits mid-array', () => {
    const errorCard = { role: 'error', content: 'boom' };
    const existing = [m('o1', 'o1'), m('o2', 'o2'), errorCard, m('o3', 'o3'), m('n1', 'n1')];
    const fresh = [m('n1', 'n1')];
    expect(mergeMessagePage(existing, fresh)).toEqual(existing);
  });

  it('drops the optimistic user row once the page carries the server copy', () => {
    // After a stop or a stream error the refetch includes the question that
    // was only local a moment ago; keeping both renders it twice, and only
    // the server-backed copy carries a delete affordance.
    const echo = { role: 'user', content: 'the question I just sent' };
    const existing = [m('u1', 'q1'), m('a1', 'a1'), echo];
    const fresh = [m('u1', 'q1'), m('a1', 'a1'), m('u2', 'the question I just sent')];
    expect(mergeMessagePage(existing, fresh)).toEqual(fresh);
  });

  it('keeps an optimistic user row the page has not caught up with yet', () => {
    const echo = { role: 'user', content: 'just typed' };
    const existing = [m('u1', 'q1'), m('a1', 'a1'), echo];
    const fresh = [m('u1', 'q1'), m('a1', 'a1')];
    expect(mergeMessagePage(existing, fresh)).toEqual([...fresh, echo]);
  });

  it('falls back to the page alone when it shares no row with local state', () => {
    // Another device advanced the conversation past everything held here.
    // Splicing the two runs together would render a gap of unknown size as
    // though it were continuous history.
    const existing = [m('old-1', 'o1'), m('old-2', 'o2')];
    const fresh = [m('new-1', 'n1'), m('new-2', 'n2')];
    expect(mergeMessagePage(existing, fresh)).toEqual(fresh);
  });

  it('replaces empty/placeholder local state with the fresh page', () => {
    expect(mergeMessagePage([], [m('a', 'hi')])).toEqual([m('a', 'hi')]);
  });

  it('keeps an already-loaded older prefix (from "load earlier") intact', () => {
    const olderPage = [m('old-1', 'older 1'), m('old-2', 'older 2')];
    const existing = [...olderPage, m('a', 'a'), m('b', 'b')];
    const fresh = [m('a', 'a-updated'), m('b', 'b'), m('c', 'new from server')];
    expect(mergeMessagePage(existing, fresh)).toEqual([...olderPage, ...fresh]);
  });

  it('replaces the overlapping tail with the fresh copy (server wins)', () => {
    const existing = [m('a', 'stale')];
    const fresh = [m('a', 'fresh')];
    expect(mergeMessagePage(existing, fresh)).toEqual([m('a', 'fresh')]);
  });

  it('never drops the live _streaming stub trailing after the fetched content', () => {
    const streamingStub = { role: '_streaming', content: 'typing…' };
    const existing = [m('a', 'a'), streamingStub];
    const fresh = [m('a', 'a'), m('b', 'the reply that just finished')];
    expect(mergeMessagePage(existing, fresh)).toEqual([...fresh, streamingStub]);
  });

  it('never drops an id-less error/provider_required card', () => {
    const errorCard = { role: 'error', content: 'something went wrong' };
    const existing = [m('a', 'a'), errorCard];
    const fresh = [m('a', 'a')];
    expect(mergeMessagePage(existing, fresh)).toEqual([m('a', 'a'), errorCard]);
  });

  it('keeps a new turn that started streaming after the fetch was kicked off', () => {
    // A second, newer stream stub arriving after this fetch resolves --
    // must not be clobbered by the (now slightly stale) fresh page.
    const newStub = { role: '_streaming', content: 'new turn typing…' };
    const existing = [m('a', 'a'), m('b', 'b'), newStub];
    const fresh = [m('a', 'a'), m('b', 'b')]; // fetch kicked off before newStub appeared
    expect(mergeMessagePage(existing, fresh)).toEqual([...fresh, newStub]);
  });

  it('an empty fresh page is a no-op (keeps existing untouched)', () => {
    const existing = [m('a', 'a'), { role: '_streaming', content: '...' }];
    expect(mergeMessagePage(existing, [])).toBe(existing);
  });

  it('handles a completely fresh conversation (no overlap, no older prefix) by just appending', () => {
    const fresh = [m('a', 'a'), m('b', 'b')];
    expect(mergeMessagePage([], fresh)).toEqual(fresh);
  });
});

describe('reconcilePaginationState', () => {
  it('adopts the fresh page\'s values when the task has no established boundary yet', () => {
    // A task straight off the sidebar list, or a brand-new conversation --
    // hasMoreMessages/messagesCursor are simply absent until a real fetch
    // establishes them for the first time.
    const task = { id: 't1', messages: [] };
    const fresh = { hasMoreMessages: true, messagesCursor: 'cursor-a' };
    expect(reconcilePaginationState(task, fresh)).toEqual({ hasMoreMessages: true, messagesCursor: 'cursor-a' });
  });

  // The bug this exists to fix: warmTranscript loads the FULL history
  // (unbounded /items) and correctly stamps hasMoreMessages: false. Opening
  // that task then runs a BOUNDED page fetch through the exact same merge
  // path, which on its own would report hasMoreMessages: true (it only
  // knows about its own most-recent slice) and wrongly override the
  // established "this task is already fully loaded" state.
  it('keeps an existing false (fully loaded) rather than adopting a narrower fresh page\'s true', () => {
    const task = { id: 't1', hasMoreMessages: false, messagesCursor: null };
    const fresh = { hasMoreMessages: true, messagesCursor: 'cursor-mid' };
    expect(reconcilePaginationState(task, fresh)).toEqual({ hasMoreMessages: false, messagesCursor: null });
  });

  // The other concrete bug: the user has already clicked "load earlier"
  // twice, extending the array and its cursor further back than the first
  // page alone knows about. Navigating away and back re-fetches just the
  // tail; that refresh must not regress the cursor to the first page's own
  // (shallower) boundary, or the next "load earlier" click re-fetches and
  // re-prepends a page that's already loaded.
  it('keeps an existing deeper cursor rather than regressing to the fresh page\'s shallower one', () => {
    const task = { id: 't1', hasMoreMessages: true, messagesCursor: 'cursor-deep' };
    const fresh = { hasMoreMessages: true, messagesCursor: 'cursor-shallow' };
    expect(reconcilePaginationState(task, fresh)).toEqual({ hasMoreMessages: true, messagesCursor: 'cursor-deep' });
  });

  it('tolerates a missing task or fresh page', () => {
    expect(reconcilePaginationState(null, { hasMoreMessages: true, messagesCursor: 'c' }))
      .toEqual({ hasMoreMessages: true, messagesCursor: 'c' });
    expect(reconcilePaginationState({ hasMoreMessages: true, messagesCursor: 'c' }, null))
      .toEqual({ hasMoreMessages: true, messagesCursor: 'c' });
    expect(reconcilePaginationState(null, null)).toEqual({ hasMoreMessages: false, messagesCursor: null });
  });
});

describe('pageReplacesLocalHistory', () => {
  const m2 = (id) => ({ id, role: 'user', content: id });

  it('is true when the page shares no row with what is loaded', () => {
    expect(pageReplacesLocalHistory([m2('a')], [m2('x'), m2('y')])).toBe(true);
  });

  it('is false when the page overlaps what is loaded', () => {
    expect(pageReplacesLocalHistory([m2('a'), m2('b')], [m2('b'), m2('c')])).toBe(false);
  });

  it('adopts the page\'s own cursor when it replaced local history', () => {
    // Keeping the old boundary points "load earlier" at a cursor describing
    // the array that was just discarded, and that page comes back already on
    // screen — the same rows render twice.
    const task = { messages: [m2('old-1')], hasMoreMessages: true, messagesCursor: 'cursor-old' };
    const page = { messages: [m2('new-1')], hasMoreMessages: true, messagesCursor: 'cursor-new' };
    expect(reconcilePaginationState(task, page)).toEqual({
      hasMoreMessages: true, messagesCursor: 'cursor-new',
    });
  });

  it('still keeps an established boundary when the page merely refreshes the tail', () => {
    const task = { messages: [m2('a'), m2('b')], hasMoreMessages: true, messagesCursor: 'cursor-deep' };
    const page = { messages: [m2('b')], hasMoreMessages: false, messagesCursor: null };
    expect(reconcilePaginationState(task, page)).toEqual({
      hasMoreMessages: true, messagesCursor: 'cursor-deep',
    });
  });
});
