// Dictation (ENG-4630): the composer's mic opens a listen-only session on the
// voice call's lane and types the person's live transcript into the box.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('../../api', () => ({ startVoiceSession: vi.fn() }));

import { startVoiceSession } from '../../api';
import { FINISH_WAIT_MS, UTTERANCE_GAP_MS, joinDictated, useDictation } from './useDictation';

class FakeChannel {
  constructor() {
    this.readyState = 'open';
    this.sent = [];
    this.listeners = {};
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 'closed'; }
  emit(event) { (this.listeners.message || []).forEach((fn) => fn({ data: JSON.stringify(event) })); }
}

let peer;
class FakePeer {
  constructor() {
    peer = this;
    this.iceGatheringState = 'complete';
    this.tracks = [];
    this.closed = false;
  }
  addEventListener() {}
  removeEventListener() {}
  addTrack(track) { this.tracks.push(track); }
  createDataChannel(label) { this.label = label; this.channel = new FakeChannel(); return this.channel; }
  async createOffer() { return { type: 'offer', sdp: 'offer-sdp' }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) { this.remote = d; }
  close() { this.closed = true; }
}

const track = { enabled: true, stop: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  globalThis.RTCPeerConnection = FakePeer;
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) },
  });
  startVoiceSession.mockReset();
  startVoiceSession.mockResolvedValue({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer-sdp' } });
  track.enabled = true;
  track.stop.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('joinDictated', () => {
  it('joins pieces of one utterance as they come', () => {
    expect(joinDictated('Send the', ' report', false)).toBe('Send the report');
  });

  it('sets a fresh utterance off from what is typed by one space', () => {
    expect(joinDictated('Hello', ' world', true)).toBe('Hello world');
    expect(joinDictated('Hello', 'world', true)).toBe('Hello world');
    expect(joinDictated('Hello ', ' world', true)).toBe('Hello world');
    expect(joinDictated('Line\n', 'next', true)).toBe('Line\nnext');
  });

  it('starts an empty box without a leading space', () => {
    expect(joinDictated('', '  Draft an email', true)).toBe('Draft an email');
    expect(joinDictated(undefined, 'Hi', true)).toBe('Hi');
  });

  it('leaves the text alone for a blank fresh piece', () => {
    expect(joinDictated('Hello', '   ', true)).toBe('Hello');
  });
});

describe('useDictation', () => {
  async function started(onText = vi.fn()) {
    const hook = renderHook(() => useDictation({ onText }));
    await act(() => hook.result.current.start());
    return { ...hook, onText };
  }

  it('opens a dictation session on the call lane, with the microphone and no voice', async () => {
    const { result } = await started();

    expect(peer.label).toBe('oai-events');
    expect(peer.tracks).toEqual([track]);
    expect(startVoiceSession).toHaveBeenCalledWith('offer-sdp', undefined, 'dictation');
    expect(peer.remote).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(result.current.phase).toBe('starting');

    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(result.current.phase).toBe('listening');
    expect(result.current.active).toBe(true);
    // Listen-only: nothing is ever sent to the session while it listens.
    expect(peer.channel.sent).toEqual([]);
  });

  it('hands over the person\'s transcript, marking each pause as a fresh utterance', async () => {
    const { onText } = await started();
    act(() => peer.channel.emit({ type: 'session.started' }));

    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Draft a' }));
    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: ' memo' }));
    await act(() => vi.advanceTimersByTimeAsync(UTTERANCE_GAP_MS + 100));
    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: ' for Friday' }));
    // What the session would say is ignored.
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Sure!' }));

    expect(onText.mock.calls).toEqual([['Draft a', true], [' memo', false], [' for Friday', true]]);
  });

  it('stops by muting at once, closing the session, and still taking the last words', async () => {
    const { result, onText } = await started();
    act(() => peer.channel.emit({ type: 'session.started' }));

    act(() => result.current.stop());
    expect(track.enabled).toBe(false);
    expect(peer.channel.sent).toEqual([{ type: 'session.close' }]);
    expect(result.current.phase).toBe('finishing');

    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'last words' }));
    expect(onText).toHaveBeenCalledWith('last words', true);

    act(() => peer.channel.emit({ type: 'session.closed' }));
    expect(result.current.phase).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
    expect(peer.closed).toBe(true);
  });

  it('lets go of the session when it never confirms the close', async () => {
    const { result } = await started();
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => result.current.stop());

    await act(() => vi.advanceTimersByTimeAsync(FINISH_WAIT_MS + 10));
    expect(result.current.phase).toBe('idle');
    expect(peer.closed).toBe(true);
  });

  it('toggles: a click starts, the next one stops', async () => {
    const { result } = renderHook(() => useDictation({ onText: vi.fn() }));
    await act(async () => { result.current.toggle(); await vi.advanceTimersByTimeAsync(0); });
    expect(startVoiceSession).toHaveBeenCalledTimes(1);
    act(() => peer.channel.emit({ type: 'session.started' }));

    act(() => result.current.toggle());
    expect(peer.channel.sent).toEqual([{ type: 'session.close' }]);
  });

  it('says why when the microphone is blocked, and is idle again', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const { result } = await started();

    expect(result.current.phase).toBe('idle');
    expect(result.current.error).toMatch(/microphone/i);
    expect(startVoiceSession).not.toHaveBeenCalled();
  });

  it('frees the microphone when the composer goes away', async () => {
    const { unmount } = await started();
    act(() => peer.channel.emit({ type: 'session.started' }));
    unmount();

    expect(track.stop).toHaveBeenCalled();
    expect(peer.channel.sent).toEqual([{ type: 'session.close' }]);
  });
});
