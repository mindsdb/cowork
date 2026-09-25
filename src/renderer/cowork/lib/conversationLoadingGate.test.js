import { describe, it, expect } from 'vitest';
import { resolveConversationLoadState } from './conversationLoadingGate';

describe('resolveConversationLoadState', () => {
  it('is loading when the task is not known locally at all', () => {
    // The cold deep-link / scheduled-run-open case.
    expect(resolveConversationLoadState({ resolvedTask: null, conversationErrorMatches: false }))
      .toBe('loading');
  });

  it('is loading when a sidebar-known task has not fetched its messages yet — the bug this exists to fix', () => {
    // Every sidebar-listed task is already in `tasks` before its messages
    // load; a gate keyed only on "task known" would say 'ready' here.
    const resolvedTask = { id: 't1', messages: [], messagesStatus: 'loading' };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: false }))
      .toBe('loading');
  });

  it('is ready once messagesStatus flips to loaded', () => {
    const resolvedTask = { id: 't1', messages: [{ role: 'user' }], messagesStatus: 'loaded' };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: false }))
      .toBe('ready');
  });

  it('is ready for a task with no messagesStatus at all (a locally-created optimistic task)', () => {
    const resolvedTask = { id: 'tmp-1', messages: [{ role: 'user', content: 'hi' }] };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: false }))
      .toBe('ready');
  });

  it('does not re-show loading for a task already loaded this session, even if reselected', () => {
    const resolvedTask = { id: 't1', messages: [{ role: 'user' }], messagesStatus: 'loaded' };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: false }))
      .toBe('ready');
  });

  it('is ready (not error) when a KNOWN task\'s message fetch failed — a known task keeps rendering through a blip', () => {
    const resolvedTask = { id: 't1', messages: [], messagesStatus: 'unavailable' };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: true }))
      .toBe('ready');
  });

  it('is error for an unresolved task whose loader reported unavailable', () => {
    expect(resolveConversationLoadState({ resolvedTask: null, conversationErrorMatches: true }))
      .toBe('error');
  });

  it('a stale conversationError match on an already-loaded task does not override ready', () => {
    // conversationError is cleared on a resolvable result, but guard the
    // gate itself against a stale match too.
    const resolvedTask = { id: 't1', messages: [{ role: 'user' }], messagesStatus: 'loaded' };
    expect(resolveConversationLoadState({ resolvedTask, conversationErrorMatches: true }))
      .toBe('ready');
  });
});
