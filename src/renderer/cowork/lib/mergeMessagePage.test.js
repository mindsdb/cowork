import { describe, it, expect } from 'vitest';
import { mergeMessagePage, reconcilePaginationState } from './mergeMessagePage';

const m = (id, content) => ({ id, role: 'user', content });

describe('mergeMessagePage', () => {
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
