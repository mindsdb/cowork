// The voice call's flow with WebRTC stood in for: the offer goes to the server,
// GPT-Live's answer comes back, the task's context and a greeting go out once
// the session starts, and each client delegation sends what the person said
// to Anton and returns the answer to be said.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({ startVoiceSession: vi.fn() }));

import { startVoiceSession } from '../../api';
import {
  ANALYZE_MAX_MS, AWAY_MS, IDLE_MS, LINGER_MS, MAX_SPOKEN_CHARS, useVoiceCall, voiceCallRunning, voiceStartFailure,
} from './useVoiceCall';

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
    this.remote = null;
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
  globalThis.MediaStream = class {};
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) },
  });
  vi.spyOn(globalThis.HTMLMediaElement.prototype, 'play').mockResolvedValue();
  startVoiceSession.mockReset();
  startVoiceSession.mockResolvedValue({ session: { id: 'live_1' }, transport: { type: 'webrtc', sdp: 'answer-sdp' } });
  track.enabled = true;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function started(options) {
  const hook = renderHook(() => useVoiceCall(options));
  await act(() => hook.result.current.start());
  return hook;
}

describe('a voice call', () => {
  it('sends the offer through the server, applies the answer, and greets with the task context', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => 'The user is in a task called "Q3 sales".' });

    expect(peer.label).toBe('oai-events');
    expect(startVoiceSession).toHaveBeenCalledWith('offer-sdp', null);
    expect(peer.remote).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(result.current.phase).toBe('starting');

    act(() => peer.channel.emit({ type: 'session.started', session: { id: 'live_1' } }));

    expect(result.current.phase).toBe('live');
    // In a task it opens silent: the task's context only, no greeting.
    expect(peer.channel.sent).toEqual([
      expect.objectContaining({ type: 'session.thinking.append', delegation_id: null, content: 'The user is in a task called "Q3 sales".' }),
    ]);
  });

  it('says a short hi on a blank task', async () => {
    await started({ onAsk: vi.fn(), context: () => '' });
    act(() => peer.channel.emit({ type: 'session.started' }));
    const [greet] = peer.channel.sent;
    expect(greet).toMatchObject({ type: 'session.instructions.append', delegation_id: null });
    expect(greet.content).toMatch(/short hi/);
  });

  it('starts in the voice asked for, and a switch hangs up at once and starts again in the new one', async () => {
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => hook.result.current.start({ voice: 'willow' }));
    expect(startVoiceSession).toHaveBeenLastCalledWith('offer-sdp', 'willow');
    const first = peer;
    act(() => first.channel.emit({ type: 'session.started' }));

    await act(async () => { hook.result.current.switchVoice('cedar'); await vi.advanceTimersByTimeAsync(0); });
    expect(first.channel.sent.at(-1)).toEqual({ type: 'session.close' });
    expect(first.closed).toBe(true);
    expect(peer).not.toBe(first);
    expect(startVoiceSession).toHaveBeenLastCalledWith('offer-sdp', 'cedar');

    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(peer.channel.sent.at(-1).content).toMatch(/new voice/);
    expect(hook.result.current.voice).toBe('cedar');
  });

  it('signs off: the microphone goes off, Anton says goodbye, the card folds and the call ends', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    act(() => peer.channel.emit({ type: 'session.started' }));

    let done;
    act(() => { done = result.current.signOff(); });
    expect(track.enabled).toBe(false);
    expect(peer.channel.sent.at(-1).content).toMatch(/whenever you need me next/);
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Got it, ping me anytime.' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(result.current.closing).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); await done; });
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
  });

  it('previews a voice with no microphone, and hangs up after its line', async () => {
    peer = null;
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => 'ignored' }));
    peer = null;
    const addTransceiver = vi.fn();
    globalThis.RTCPeerConnection = class extends FakePeer { addTransceiver(...a) { addTransceiver(...a); } };
    await act(async () => { hook.result.current.preview('vesper'); await vi.advanceTimersByTimeAsync(0); });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(addTransceiver).toHaveBeenCalledWith('audio', { direction: 'recvonly' });
    expect(hook.result.current.previewing).toBe(true);

    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(peer.channel.sent.map((e) => e.type)).toEqual(['session.instructions.append']);
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: 'Hi, this is how I sound.' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2400); });
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
  });

  it('hands what the person said to Anton and returns the answer, without phone numbers', async () => {
    const onAsk = vi.fn(async () => 'Booked the Hilton. Their desk is 415-555-0134.');
    const { result } = await started({ onAsk, context: () => '' });
    act(() => {
      peer.channel.emit({ type: 'session.started' });
      peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Book a hotel ' });
      peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'in SF for Friday.' });
      peer.channel.emit({ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client' } });
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await waitFor(() => expect(peer.channel.sent.some((e) => e.delegation_id === 'item_1')).toBe(true));

    expect(onAsk).toHaveBeenCalledWith('Book a hotel in SF for Friday.');
    const result_ = peer.channel.sent.find((e) => e.delegation_id === 'item_1');
    expect(result_).toMatchObject({ type: 'session.commentary.append', content: 'Booked the Hilton. Their desk is [phone number].' });
    expect(result.current.working).toBe(false);
    expect(result.current.captions.user).toBe('Book a hotel in SF for Friday.');
  });

  it('keeps an answer within what GPT-Live takes, and says when Anton fails', async () => {
    const onAsk = vi.fn()
      .mockResolvedValueOnce('x'.repeat(MAX_SPOKEN_CHARS + 500))
      .mockRejectedValueOnce(new Error('The task was stopped.'));
    await started({ onAsk, context: () => '' });
    act(() => {
      peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Summarize it.' });
      peer.channel.emit({ type: 'session.delegation.created', delegation: { id: 'item_2', target: 'client' } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => {
      peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'And email it.' });
      peer.channel.emit({ type: 'session.delegation.created', delegation: { id: 'item_3', target: 'client' } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });

    await waitFor(() => expect(peer.channel.sent.filter((e) => e.type === 'session.commentary.append')).toHaveLength(2));
    const [long, failed] = peer.channel.sent.filter((e) => e.type === 'session.commentary.append');
    expect(long.content.length).toBeLessThan(MAX_SPOKEN_CHARS + 60);
    expect(failed.content).toBe("Anton couldn't finish it: The task was stopped.");
  });

  it('hangs up with session.close and closes quietly once the session confirms', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    act(() => peer.channel.emit({ type: 'session.started' }));

    await act(() => result.current.end());
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
    expect(result.current.phase).toBe('ending');

    act(() => peer.channel.emit({ type: 'session.closed', reason: 'client_requested', usage: { seconds: 30 } }));
    expect(result.current.phase).toBe('idle');
    expect(peer.closed).toBe(true);
    expect(track.stop).toHaveBeenCalled();
  });

  it('mutes by turning the microphone track off', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    act(() => result.current.toggleMic());
    expect(track.enabled).toBe(false);
    expect(result.current.micOn).toBe(false);
  });

  it('says why a call could not start', async () => {
    startVoiceSession.mockRejectedValueOnce(new Error("Voice calls aren't available on this deployment."));
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    expect(result.current.phase).toBe('ended');
    expect(result.current.notice).toBe("Voice calls aren't available on this deployment.");
    expect(voiceStartFailure(Object.assign(new Error('x'), { name: 'NotAllowedError' }))).toMatch(/Allow the microphone/);
  });
});

describe('a quiet call', () => {
  it('stops listening and folds away after a minute with nobody speaking', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    act(() => peer.channel.emit({ type: 'session.started' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_MS - 10_000); });
    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'hmm' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE_MS - 10_000); });
    expect(result.current.closing).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(track.enabled).toBe(false);
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
  });

  it('after handing Anton work, fades out after five quiet seconds, listens a moment, then hangs up away', async () => {
    const onAway = vi.fn();
    const { result } = await started({ onAsk: vi.fn(), context: () => '', busy: () => true, onAway });
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => result.current.armAway());
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + 1_000); });
    expect(result.current.lingering).toBe(true);
    expect(track.enabled).toBe(true);
    expect(onAway).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(LINGER_MS); });
    expect(onAway).toHaveBeenCalledTimes(1);
    expect(track.enabled).toBe(false);
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
  });

  it('comes back when the person speaks while it fades', async () => {
    const onAway = vi.fn();
    const { result } = await started({ onAsk: vi.fn(), context: () => '', busy: () => true, onAway });
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => result.current.armAway());
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + 1_000); });
    act(() => peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'wait, one more' }));
    expect(result.current.lingering).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(LINGER_MS + 500); });
    expect(onAway).not.toHaveBeenCalled();
    expect(peer.channel.sent.some((e) => e.type === 'session.close')).toBe(false);
  });

  it('the call button while it fades makes it an ordinary call again', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '', busy: () => true, onAway: vi.fn() });
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => result.current.armAway());
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + 1_000); });
    act(() => result.current.resume());
    expect(result.current.lingering).toBe(false);
    // The quick rule is gone: well past it, still on.
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS * 4); });
    expect(result.current.lingering).toBe(false);
    expect(peer.channel.sent.some((e) => e.type === 'session.close')).toBe(false);
  });

  it('a call-back analyzes with the microphone off, opens it once Anton speaks, and picks up from the last line', async () => {
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '', busy: () => true, onAway: vi.fn() }));
    await act(() => hook.result.current.start());
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => hook.result.current.armAway());
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: "On it. I'll get back to you when it's done." }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + LINGER_MS + 1_000); });
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
    act(() => peer.channel.emit({ type: 'session.closed', reason: 'client_requested' }));

    track.enabled = true;
    await act(() => hook.result.current.callBack('Flights from $212.'));
    expect(hook.result.current.analyzing).toBe(true);
    expect(track.enabled).toBe(false);
    expect(hook.result.current.micOn).toBe(false);
    act(() => peer.channel.emit({ type: 'session.started' }));
    const greet = peer.channel.sent.find((e) => e.type === 'session.instructions.append');
    expect(greet.content).toContain('The last thing you said before hanging up was: "On it. I\'ll get back to you when it\'s done."');
    expect(greet.content).toMatch(/ask whether they need anything else/);
    // Analyzing holds off the quiet rule.
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + LINGER_MS + 1_000); });
    expect(hook.result.current.lingering).toBe(false);
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: "Hey, it's done." }));
    expect(hook.result.current.analyzing).toBe(false);
    expect(track.enabled).toBe(true);
    expect(hook.result.current.micOn).toBe(true);
  });

  it('a call-back fades out soon after its news, with nothing left to call back about', async () => {
    const onAway = vi.fn();
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '', busy: () => false, onAway }));
    await act(() => hook.result.current.callBack('It is done.'));
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => peer.channel.emit({ type: 'session.output_transcript.delta', delta: "Hey, it's done." }));
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + LINGER_MS + 1_000); });
    expect(peer.channel.sent.at(-1)).toEqual({ type: 'session.close' });
    expect(onAway).not.toHaveBeenCalled();
  });

  it('calls back with the news as its opening line', async () => {
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => hook.result.current.callBack('Flights from $212 on Saturday.', 'vesper'));
    expect(startVoiceSession).toHaveBeenCalledWith('offer-sdp', 'vesper');
    act(() => peer.channel.emit({ type: 'session.started' }));
    const greet = peer.channel.sent.find((e) => e.type === 'session.instructions.append');
    expect(greet.content).toMatch(/calling the user back/);
    expect(greet.content).toMatch(/Flights from \$212 on Saturday\./);
    expect(hook.result.current.isOn()).toBe(true);
  });
});

describe('a call-back that hears nothing', () => {
  it('stops analyzing and opens the microphone after a while with GPT-Live silent', async () => {
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => hook.result.current.callBack('It is done.'));
    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(hook.result.current.analyzing).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(ANALYZE_MAX_MS + 100); });
    expect(hook.result.current.analyzing).toBe(false);
    expect(hook.result.current.micOn).toBe(true);
    expect(track.enabled).toBe(true);
  });

  it('stops analyzing on an error from GPT-Live', async () => {
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    await act(() => hook.result.current.callBack('It is done.'));
    act(() => peer.channel.emit({ type: 'session.started' }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => peer.channel.emit({ type: 'error', error: { message: 'boom' } }));
    expect(hook.result.current.analyzing).toBe(false);
    expect(hook.result.current.micOn).toBe(true);
  });
});

describe('news for the call', () => {
  it('is said on a live call, and wakes one fading out', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '', busy: () => true, onAway: vi.fn() });
    act(() => peer.channel.emit({ type: 'session.started' }));
    act(() => result.current.armAway());
    await act(async () => { await vi.advanceTimersByTimeAsync(AWAY_MS + 1_000); });
    expect(result.current.lingering).toBe(true);
    let taken;
    act(() => { taken = result.current.announce('Flights from $212.'); });
    expect(taken).toBe(true);
    expect(result.current.lingering).toBe(false);
    expect(peer.channel.sent.at(-1).content).toMatch(/Flights from \$212\./);
  });

  it('waits for a call still connecting, and is said once it is live', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    let taken;
    act(() => { taken = result.current.announce('Flights from $212.'); });
    expect(taken).toBe(true);
    expect(peer.channel.sent).toEqual([]);
    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(peer.channel.sent.at(-1).content).toMatch(/Flights from \$212\./);
  });

  it('is refused by a call hanging up, so the app calls back, which takes over from it', async () => {
    const { result } = await started({ onAsk: vi.fn(), context: () => '' });
    act(() => peer.channel.emit({ type: 'session.started' }));
    const first = peer;
    await act(() => result.current.end());
    expect(result.current.isOn()).toBe(false);
    expect(result.current.announce('Flights from $212.')).toBe(false);

    await act(() => result.current.callBack('Flights from $212.'));
    expect(first.closed).toBe(true);
    expect(peer).not.toBe(first);
    act(() => peer.channel.emit({ type: 'session.started' }));
    expect(peer.channel.sent.find((e) => e.type === 'session.instructions.append').content).toMatch(/calling the user back/);
  });

  it('is refused with no call', () => {
    const { result } = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    expect(result.current.announce('x')).toBe(false);
  });
});

describe('a call that changed under a pending step', () => {
  it("a preview's hang-up leaves alone the preview that replaced it", async () => {
    globalThis.RTCPeerConnection = class extends FakePeer { addTransceiver() {} };
    const hook = renderHook(() => useVoiceCall({ onAsk: vi.fn(), context: () => '' }));
    await act(async () => { hook.result.current.preview('vesper'); await vi.advanceTimersByTimeAsync(0); });
    act(() => peer.channel.emit({ type: 'session.started' }));
    const first = peer;
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    // Switched to another voice before the first preview's line is over.
    await act(async () => { hook.result.current.preview('cedar'); await vi.advanceTimersByTimeAsync(0); });
    const second = peer;
    expect(second).not.toBe(first);
    act(() => second.channel.emit({ type: 'session.started' }));
    // A long line: past the first preview's longest wait, within the second's.
    for (let i = 0; i < 11; i += 1) {
      act(() => second.channel.emit({ type: 'session.output_transcript.delta', delta: 'Hi, this is how I sound. ' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    expect(second.channel.sent.some((e) => e.type === 'session.close')).toBe(false);
    expect(hook.result.current.closing).toBe(false);
  });

  it("drops an answer for a call that is gone, rather than send it into a new one", async () => {
    let answer;
    const onAsk = vi.fn(() => new Promise((r) => { answer = r; }));
    const hook = renderHook(() => useVoiceCall({ onAsk, context: () => '' }));
    await act(() => hook.result.current.start());
    act(() => {
      peer.channel.emit({ type: 'session.started' });
      peer.channel.emit({ type: 'session.input_transcript.delta', delta: 'Book a hotel.' });
      peer.channel.emit({ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client' } });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(onAsk).toHaveBeenCalled();
    act(() => { hook.result.current.switchVoice('cedar'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const second = peer;
    act(() => second.channel.emit({ type: 'session.started' }));
    await act(async () => { answer('Booked.'); await vi.advanceTimersByTimeAsync(0); });
    expect(second.channel.sent.some((e) => e.type === 'session.commentary.append')).toBe(false);
  });
});

describe('whether a call holds the line', () => {
  it('counts an ended call as none, so a new one can start', () => {
    expect(voiceCallRunning('ended')).toBe(false);
    expect(voiceCallRunning('idle')).toBe(false);
    expect(voiceCallRunning('live')).toBe(true);
    expect(voiceCallRunning('starting')).toBe(true);
    expect(voiceCallRunning('ending')).toBe(true);
  });
});
