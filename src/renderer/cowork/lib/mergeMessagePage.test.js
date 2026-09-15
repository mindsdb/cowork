import { describe, it, expect } from 'vitest';
import { mergeMessagePage } from './mergeMessagePage';

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
