import { describe, expect, it, vi } from 'vitest';
import { checkOriginChat, originChatGate } from './originChat';

const ORIGIN = '3f6a1c8e-6b1d-4a2f-9a1e-2c7d5b0e4a11';
const artifact = (over = {}) => ({ id: 'a1', originConversationId: ORIGIN, ...over });

describe('originChatGate', () => {
  it('shows no button with no artifact or no way to open a chat', () => {
    expect(originChatGate({ artifact: null })).toEqual({ kind: 'hidden' });
    expect(originChatGate({ artifact: artifact(), canOpen: false })).toEqual({ kind: 'hidden' });
  });

  it('shows no button inside the origin chat itself', () => {
    expect(originChatGate({ artifact: artifact(), conversationId: ORIGIN })).toEqual({ kind: 'hidden' });
  });

  it('asks about the origin chat when it is not the one on screen', () => {
    expect(originChatGate({ artifact: artifact() })).toEqual({ kind: 'check', id: ORIGIN });
    expect(originChatGate({ artifact: artifact(), conversationId: 'another-chat' })).toEqual({ kind: 'check', id: ORIGIN });
  });

  it('is disabled with no origin chat, in a chat or not', () => {
    const none = { kind: 'unavailable', reason: 'noOrigin' };
    expect(originChatGate({ artifact: artifact({ originConversationId: '' }) })).toEqual(none);
    expect(originChatGate({ artifact: artifact({ originConversationId: undefined }), conversationId: ORIGIN })).toEqual(none);
  });

  it("is disabled for a colleague's artifact in org mode, without a check", () => {
    const colleague = { kind: 'unavailable', reason: 'colleague' };
    expect(originChatGate({ artifact: artifact({ capabilities: { role: 'reviewer' } }), orgMode: true })).toEqual(colleague);
    expect(originChatGate({ artifact: artifact({ capabilities: { role: 'reviewer', ownerUnknown: true } }), orgMode: true }))
      .toEqual(colleague);
  });

  it("is disabled for a copy of a member's shared live app, whose chat is theirs", () => {
    expect(originChatGate({ artifact: artifact({ receivedFrom: { email: 'a@example.com' } }) }))
      .toEqual({ kind: 'unavailable', reason: 'colleague' });
  });

  it('asks about the person\'s own artifact in org mode, and any artifact on desktop', () => {
    expect(originChatGate({ artifact: artifact({ capabilities: { role: 'owner' } }), orgMode: true }))
      .toEqual({ kind: 'check', id: ORIGIN });
    // No capabilities is no evidence either way.
    expect(originChatGate({ artifact: artifact(), orgMode: true })).toEqual({ kind: 'check', id: ORIGIN });
    expect(originChatGate({ artifact: artifact({ capabilities: { role: 'reviewer' } }), orgMode: false }))
      .toEqual({ kind: 'check', id: ORIGIN });
  });
});

describe('checkOriginChat', () => {
  it('answers from the chat list without a request', async () => {
    const fetchStatus = vi.fn();
    await expect(checkOriginChat(ORIGIN, { tasks: [{ id: 'x' }, { id: ORIGIN }], fetchStatus })).resolves.toBe('ok');
    await expect(checkOriginChat(ORIGIN, { tasks: [{ id: ORIGIN }], deletedIds: new Set([ORIGIN]), fetchStatus }))
      .resolves.toBe('not_found');
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it('asks the server about a chat missing from the capped list', async () => {
    const fetchStatus = vi.fn().mockResolvedValue('not_found');
    await expect(checkOriginChat(ORIGIN, { tasks: [{ id: 'x' }], fetchStatus })).resolves.toBe('not_found');
    expect(fetchStatus).toHaveBeenCalledWith(ORIGIN);
  });
});
