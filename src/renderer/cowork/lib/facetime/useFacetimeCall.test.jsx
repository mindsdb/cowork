// The video call's flow with Nuance's SDK stood in for: the avatar is told
// what the task is about once it can hear and is in view, and each ask_cowork
// call goes to Anton and back without phone numbers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fake = vi.hoisted(() => ({ conversation: null }));

vi.mock('@nuancelabs/js-sdk', () => {
  class MediaAccessError extends Error {
    constructor(reason, device) {
      super(reason);
      this.reason = reason;
      this.device = device;
    }
  }
  class ActiveSessionError extends Error {}
  return {
    ActiveSessionError,
    MediaAccessError,
    createNuanceConversation: vi.fn((options) => {
      const handlers = { change: [], event: [], tool: [] };
      fake.conversation = {
        options,
        handlers,
        sent: [],
        appended: [],
        results: [],
        avatar: { videoTrack: null, audioTrack: null },
        user: { videoTrack: null, isMuted: false, isVideoEnabled: true, muteAudio: vi.fn(), unmuteAudio: vi.fn() },
        onChange: (h) => handlers.change.push(h),
        onInterfaceEvent: (h) => handlers.event.push(h),
        onToolCall: (h) => handlers.tool.push(h),
        append: vi.fn(async (kind, content) => { fake.conversation.appended.push([kind, content]); }),
        sendInterfaceEvent: vi.fn(async (event) => { fake.conversation.sent.push(event); }),
        sendToolResult: vi.fn(async (callId, output) => { fake.conversation.results.push([callId, output]); }),
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {}),
      };
      return fake.conversation;
    }),
  };
});

vi.mock('../../api', () => ({ mintFacetimeToken: vi.fn(async () => 'st_test') }));

import { ActiveSessionError } from '@nuancelabs/js-sdk';
import { startFailure, useFacetimeCall } from './useFacetimeCall';

const change = (event) => fake.conversation.handlers.change.forEach((h) => h(event));
const live = (event) => fake.conversation.handlers.event.forEach((h) => h(event));

afterEach(() => { fake.conversation = null; });

describe('a video call', () => {
  it('tells the avatar about the task once it hears and is in view, then asks it to say hello', async () => {
    const { result } = renderHook(() => useFacetimeCall({ onAsk: vi.fn(), context: () => 'The user is in a task called "Q3 sales".' }));
    await act(() => result.current.start());
    expect(result.current.phase).toBe('starting');

    act(() => change({ type: 'avatar-presented' }));
    expect(fake.conversation.sent).toEqual([]);
    act(() => live({ type: 'session.started' }));

    await waitFor(() => expect(fake.conversation.sent).toHaveLength(1));
    expect(fake.conversation.appended).toEqual([['thinking', 'The user is in a task called "Q3 sales".']]);
    expect(fake.conversation.sent[0]).toMatchObject({ type: 'response.create' });
    expect(result.current.phase).toBe('live');
  });

  it('hands a request to Anton and gives the avatar the answer without phone numbers', async () => {
    const onAsk = vi.fn(async () => 'Booked the Hilton for Friday. Their desk is +1 (415) 555-0134.');
    const { result } = renderHook(() => useFacetimeCall({ onAsk, context: () => '' }));
    await act(() => result.current.start());

    await act(() => fake.conversation.handlers.tool[0]({ callId: 'c1', name: 'ask_cowork', arguments: { request: ' Book a hotel in SF for Friday ' } }));

    expect(onAsk).toHaveBeenCalledWith('Book a hotel in SF for Friday');
    expect(fake.conversation.results).toEqual([['c1', 'Booked the Hilton for Friday. Their desk is [phone number].']]);
    expect(result.current.working).toBe(false);
  });

  it('answers a failed request with an error the avatar can tell the user', async () => {
    const onAsk = vi.fn(async () => { throw new Error('The task was stopped.'); });
    const { result } = renderHook(() => useFacetimeCall({ onAsk, context: () => '' }));
    await act(() => result.current.start());

    await act(() => fake.conversation.handlers.tool[0]({ callId: 'c2', name: 'ask_cowork', arguments: { request: 'Email Ana' } }));
    await act(() => fake.conversation.handlers.tool[0]({ callId: 'c3', name: 'ask_cowork', arguments: {} }));

    expect(fake.conversation.results).toEqual([
      ['c2', { error: { message: 'The task was stopped.' } }],
      ['c3', { error: { message: "Can't run ask_cowork with these arguments" } }],
    ]);
  });

  it('attaching and the buttons are safe before the room is joined, where the SDK throws', async () => {
    const { result } = renderHook(() => useFacetimeCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => result.current.start());
    const notConnected = () => { throw new Error('Not connected — call connect() first'); };
    Object.defineProperty(fake.conversation, 'avatar', { get: notConnected });
    Object.defineProperty(fake.conversation, 'user', { get: notConnected });
    result.current.avatarVideoRef.current = document.createElement('video');

    expect(() => result.current.attach()).not.toThrow();
    await act(() => result.current.toggleMic());
    await act(() => result.current.toggleCamera());
  });

  it('shows why a call ended, and hanging up disconnects', async () => {
    const { result } = renderHook(() => useFacetimeCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => result.current.start());
    act(() => change({ type: 'session-ended', reason: 'time-limit' }));
    expect(result.current.phase).toBe('ended');
    expect(result.current.notice).toMatch(/time limit/);

    act(() => result.current.dismiss());
    await act(() => result.current.start());
    const conversation = fake.conversation;
    await act(() => result.current.end());
    expect(conversation.disconnect).toHaveBeenCalled();
    expect(result.current.phase).toBe('idle');
  });
});

describe('why a call could not start', () => {
  it('says another call is running in plain words', () => {
    expect(startFailure(new ActiveSessionError('an active conversation session already exists'))).toBe(
      'Another video call is still running. Try again in a minute.',
    );
  });
});
