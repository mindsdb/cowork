// A doc's creation opens it beside the chat once: a replay of that event (the
// stream repeats recent events on every reconnect) does not bring it back
// after the person closed it or opened another doc.
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const stream = vi.hoisted(() => ({ handlers: null }));
vi.mock('./useConversationDocs', () => ({
  useConversationDocs: (_id, handlers) => { stream.handlers = handlers; },
}));
vi.mock('../../lib/docViewContext', () => ({
  askAgentAbout: vi.fn(),
  clearDocView: vi.fn(),
  setDocView: vi.fn(),
}));

import { useDocBesideChat } from './useDocBesideChat';

const created = (id, extra = {}) => ({ type: 'doc.created', artifactId: id, title: `Doc ${id}`, ...extra });

function setup() {
  return renderHook(() => useDocBesideChat({ taskId: 'c1', projectId: 'p1', streaming: true, onSend: vi.fn() }));
}

describe('useDocBesideChat', () => {
  it('opens a doc the agent creates', () => {
    const { result } = setup();
    act(() => stream.handlers.onCreated(created('a')));
    expect(result.current.doc?.artifactId).toBe('a');
  });

  it('does not reopen a closed doc when its creation is replayed', () => {
    const { result } = setup();
    act(() => stream.handlers.onCreated(created('a')));
    act(() => result.current.close());
    act(() => stream.handlers.onCreated(created('a', { replayed: true })));
    expect(result.current.doc).toBeNull();
  });

  it('keeps the doc on screen when an earlier creation is replayed', () => {
    const { result } = setup();
    act(() => stream.handlers.onCreated(created('a')));
    act(() => result.current.open({ id: 'b', title: 'Doc b' }));
    act(() => stream.handlers.onCreated(created('a', { replayed: true })));
    expect(result.current.doc?.artifactId).toBe('b');
  });

  it('opens a doc whose creation only reaches it as a replay', () => {
    const { result } = setup();
    act(() => stream.handlers.onCreated(created('a', { replayed: true })));
    expect(result.current.doc?.artifactId).toBe('a');
  });
});
