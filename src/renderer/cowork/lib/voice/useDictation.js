// Dictation in the composer (ENG-4630): the mic between the model picker and
// Send fills the message box with what the person says. Not a conversation:
// nothing is said back and nothing is sent.
//
// It is the voice call's lane (GPT-Live through MindsHub Inference), started
// with `mode: 'dictation'`, which the server gives a prompt that keeps it
// silent. The app reads only the person's live transcript
// (`session.input_transcript.delta`) and never plays the session's audio.
//
// - `start()` asks for the microphone and opens the session.
// - `stop()` mutes the microphone at once, then closes the session; words still
//   on their way (the transcript trails the audio) land until it confirms the
//   close, or FINISH_WAIT_MS.
// - `onText(delta, fresh)` gets each piece of transcript; `fresh` is true for
//   the first piece after a pause, so the composer can start a new sentence.

import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceSession } from '../../api';
import { closeAbandoned, voiceStartFailure } from './useVoiceCall';

const CHANNEL = 'oai-events';
// How long after the last word a new one starts a new utterance.
export const UTTERANCE_GAP_MS = 1200;
// How long a stop waits for the last words and the session's close.
export const FINISH_WAIT_MS = 3000;

/* `text` with the dictated `delta` added. A fresh utterance drops the delta's
   leading space and is set off from what is there by one space; within one,
   deltas join as they come. */
export function joinDictated(text, delta, fresh) {
  const current = String(text ?? '');
  let piece = String(delta ?? '');
  if (!fresh) return current + piece;
  piece = piece.trimStart();
  if (!piece) return current;
  if (!current || /\s$/.test(current)) return current + piece;
  return `${current} ${piece}`;
}

// idle | starting | listening | finishing
export function useDictation({ onText }) {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const session = useRef(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const cleanup = useCallback((owner) => {
    const current = owner || session.current;
    if (!current) return;
    clearTimeout(current.finishTimer);
    current.microphone?.getTracks().forEach((t) => t.stop());
    try { current.channel?.close(); } catch { /* already closed */ }
    try { current.peer?.close(); } catch { /* already closed */ }
    if (session.current === current) {
      session.current = null;
      setPhase('idle');
    }
  }, []);

  const onEvent = useCallback((owner, event) => {
    switch (event?.type) {
      case 'session.started':
        if (session.current === owner && !owner.finishing) setPhase('listening');
        break;
      case 'session.input_transcript.delta': {
        const delta = String(event.delta || '');
        if (!delta) break;
        const now = Date.now();
        const fresh = !owner.lastWordAt || now - owner.lastWordAt > UTTERANCE_GAP_MS;
        owner.lastWordAt = now;
        onTextRef.current?.(delta, fresh);
        break;
      }
      case 'session.closed':
        cleanup(owner);
        break;
      case 'error':
        console.warn('[dictation] error', event.error);
        break;
      default:
    }
  }, [cleanup]);

  const start = useCallback(async () => {
    if (session.current) return;
    setError('');
    setPhase('starting');
    const mine = { peer: new RTCPeerConnection(), lastWordAt: 0 };
    session.current = mine;
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      mine.microphone = microphone;
      if (session.current !== mine) { cleanup(mine); return; }
      microphone.getAudioTracks().forEach((t) => mine.peer.addTrack(t, microphone));
      // The event channel exists before the offer, so it is negotiated with it.
      const channel = mine.peer.createDataChannel(CHANNEL);
      mine.channel = channel;
      channel.addEventListener('message', ({ data }) => {
        let event;
        try { event = JSON.parse(data); } catch { return; }
        onEvent(mine, event);
      });
      channel.addEventListener('close', () => cleanup(mine));
      await mine.peer.setLocalDescription(await mine.peer.createOffer());
      if (mine.peer.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          const done = () => { if (mine.peer.iceGatheringState === 'complete') { mine.peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
          mine.peer.addEventListener('icegatheringstatechange', done);
          setTimeout(resolve, 5000);
        });
      }
      if (session.current !== mine) { cleanup(mine); return; }
      const created = await startVoiceSession(mine.peer.localDescription.sdp, undefined, 'dictation');
      if (session.current !== mine) {
        // Stopped while the session was made: it holds one of the person's
        // open sessions at inference until it is closed.
        mine.microphone?.getTracks().forEach((t) => t.stop());
        void closeAbandoned(mine, created?.transport?.sdp);
        return;
      }
      await mine.peer.setRemoteDescription({ type: 'answer', sdp: created.transport.sdp });
    } catch (err) {
      const stillMine = session.current === mine;
      cleanup(mine);
      if (stillMine) setError(voiceStartFailure(err));
    }
  }, [cleanup, onEvent]);

  const stop = useCallback(() => {
    const current = session.current;
    if (!current || current.finishing) return;
    current.finishing = true;
    current.microphone?.getAudioTracks().forEach((t) => { t.enabled = false; });
    if (!current.channel || current.channel.readyState !== 'open') {
      // Still starting: forget it here; start() closes what the server made.
      session.current = null;
      setPhase('idle');
      current.microphone?.getTracks().forEach((t) => t.stop());
      return;
    }
    setPhase('finishing');
    try { current.channel.send(JSON.stringify({ type: 'session.close' })); } catch { cleanup(current); return; }
    current.finishTimer = setTimeout(() => cleanup(current), FINISH_WAIT_MS);
  }, [cleanup]);

  const toggle = useCallback(() => {
    if (session.current && !session.current.finishing) stop();
    else if (!session.current) void start();
  }, [start, stop]);

  // Leaving the composer ends dictation and frees the microphone.
  useEffect(() => () => {
    const current = session.current;
    if (!current) return;
    session.current = null;
    if (current.channel?.readyState === 'open') {
      try { current.channel.send(JSON.stringify({ type: 'session.close' })); } catch { /* closing anyway */ }
    }
    current.microphone?.getTracks().forEach((t) => t.stop());
    setTimeout(() => {
      try { current.channel?.close(); } catch { /* already closed */ }
      try { current.peer?.close(); } catch { /* already closed */ }
    }, 500);
  }, []);

  return { phase, error, start, stop, toggle, active: phase !== 'idle' };
}
