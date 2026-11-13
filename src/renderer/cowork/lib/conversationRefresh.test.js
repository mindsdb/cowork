import { describe, expect, it, vi } from 'vitest';
import { onConversationRefresh, requestConversationRefresh } from './conversationRefresh';

describe('conversation refresh requests', () => {
  it('reach every listener until it unsubscribes, and skip an empty id', () => {
    const listener = vi.fn();
    const off = onConversationRefresh(listener);
    requestConversationRefresh('conv-1');
    requestConversationRefresh('');
    off();
    requestConversationRefresh('conv-2');
    expect(listener.mock.calls).toEqual([['conv-1']]);
  });

  it("keeps going past a listener that throws", () => {
    const after = vi.fn();
    const offA = onConversationRefresh(() => { throw new Error('boom'); });
    const offB = onConversationRefresh(after);
    requestConversationRefresh('conv-3');
    offA(); offB();
    expect(after).toHaveBeenCalledWith('conv-3');
  });
});
