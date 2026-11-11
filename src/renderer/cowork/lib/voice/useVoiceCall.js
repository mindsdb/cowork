// A voice call with Anton (ENG-4138, prototype): OpenAI GPT-Live through
// MindsHub Inference, the voice-only sibling of the video call
// (lib/facetime/useFacetimeCall.js).
//
// - The browser makes a WebRTC offer with the microphone and an `oai-events`
//   data channel; the server sends it to MindsHub, which starts the session on
//   OpenAI and answers. Audio then flows straight to and from OpenAI.
// - GPT-Live talks; each request for work is handed back here (client
//   delegation). The delegation carries no task text, so the request is what
//   the person said since the last one, from their live transcript.
// - `onAsk(request)` sends it to Anton the way a typed message goes and
//   resolves with Anton's answer, which goes back as `session.commentary.append`
//   for GPT-Live to say (its 500-token limit: forTheAvatar trims it).
// - Hang-up sends `session.close` and waits briefly for `session.closed`, so
//   the session ends and its usage is final.
// - `meters` holds an AnalyserNode for each voice ({agent, user}), for the
//   card's sound waves. Listening only: the audio element plays the voice.
// - A session's voice is fixed when it starts, so `switchVoice` hangs up at
//   once and starts again in the new voice, which says a short line; a switch
//   while one is still starting drops that one. `preview` is the same with no
//   microphone, and hangs up after its line.
// - `signOff` (the card's Mute) has Anton say a short goodbye, then folds the
//   card away (`closing`) and hangs up.

import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceSession } from '../../api';
import { forTheAvatar, withoutPhoneNumbers } from '../facetime/forTheAvatar';

const CHANNEL = 'oai-events';
const CAPTION_CHARS = 180;
// GPT-Live takes up to 500 tokens per append.
export const MAX_SPOKEN_CHARS = 1500;
// Transcript deltas can land just after the delegation that they explain.
const TRANSCRIPT_SETTLE_MS = 700;
const CLOSE_WAIT_MS = 8000;
// A goodbye or a preview line: how long to wait for it to start, the quiet
// that means it's over (the audio trails the transcript), and the most it
// may take.
const LINE_START_MS = 5000;
const LINE_QUIET_MS = 1500;
const LINE_MAX_MS = 12000;
// The card's fold (voice-call.css .is-closing).
export const FOLD_MS = 360;

const OPENINGS = {
  task: 'Open casually in a few words, like "Hey, let me see what we got in this task", then say in one or two short sentences what this task is about and ask what they want to do next.',
  fresh: 'Greet the user in one short sentence and ask what they would like to work on.',
  switch: 'The user just switched you to a new voice. Say one short, playful line in it, like "How\'s this voice?", and nothing else.',
  preview: 'The user is trying out your voice. Say one short, friendly line so they can hear it, like "Hi, this is how I sound", and nothing else.',
  signOff: 'The user muted you to end the call. Say one short goodbye in your own words, a variation of "Got it, just click the call button whenever you need me next." Say nothing else.',
};

function tail(text) {
  return text.length > CAPTION_CHARS ? `…${text.slice(-CAPTION_CHARS)}` : text;
}

export function voiceStartFailure(err) {
  if (err?.name === 'NotAllowedError') return 'Allow the microphone in your browser to start a voice call.';
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return err?.message || 'Couldn\'t start the voice call.';
}

let eventSeq = 0;
const eventId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(eventSeq += 1)}`;

/**
 * `onAsk(request)` resolves with Anton's answer, or rejects. `context()`
 * returns background about the task, or ''.
 */
export function useVoiceCall({ onAsk, context }) {
  // idle | starting | live | ending | ended
  const [phase, setPhase] = useState('idle');
  const [notice, setNotice] = useState('');
  const [captions, setCaptions] = useState({ user: '', agent: '', last: null });
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [working, setWorking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [closing, setClosing] = useState(false);
  const [voice, setVoice] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const call = useRef(null); // { peer, channel, microphone, audio, listening }
  const meters = useRef({ agent: null, user: null });
  const heard = useRef({ pending: '', lastTurn: '' });
  const speakingTimer = useRef(null);
  // When Anton last said something, and the session's opening.
  const spoke = useRef(0);
  const opening = useRef('call');
  const onAskRef = useRef(onAsk);
  const contextRef = useRef(context);
  onAskRef.current = onAsk;
  contextRef.current = context;

  const cleanup = useCallback(() => {
    const current = call.current;
    call.current = null;
    clearTimeout(speakingTimer.current);
    if (!current) return;
    current.microphone?.getTracks().forEach((t) => t.stop());
    try { current.channel?.close(); } catch { /* already closed */ }
    try { current.peer?.close(); } catch { /* already closed */ }
    if (current.audio) current.audio.srcObject = null;
    meters.current = { agent: null, user: null };
    current.listening?.close?.().catch?.(() => {});
  }, []);

  const send = useCallback((event) => {
    const channel = call.current?.channel;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);

  const handleDelegation = useCallback(async (delegationId) => {
    await new Promise((r) => { setTimeout(r, TRANSCRIPT_SETTLE_MS); });
    const request = (heard.current.pending.trim() || heard.current.lastTurn).trim();
    heard.current.lastTurn = request || heard.current.lastTurn;
    heard.current.pending = '';
    if (!request) {
      send({ type: 'session.commentary.append', event_id: eventId('nothing'), delegation_id: delegationId, content: 'I didn\'t catch the request. Ask the user to say it again.' });
      return;
    }
    setWorking(true);
    let content;
    try {
      content = forTheAvatar(await onAskRef.current(request), { maxChars: MAX_SPOKEN_CHARS });
    } catch (err) {
      content = `Anton couldn't finish it: ${withoutPhoneNumbers(err?.message || 'something went wrong').slice(0, 300)}`;
    } finally {
      setWorking(false);
    }
    send({ type: 'session.commentary.append', event_id: eventId('result'), delegation_id: delegationId, content });
  }, [send]);

  const onEvent = useCallback((event) => {
    switch (event.type) {
      case 'session.started': {
        setPhase('live');
        const kind = opening.current;
        const about = kind === 'preview' ? '' : withoutPhoneNumbers(contextRef.current?.() || '').slice(0, 1800);
        if (about) send({ type: 'session.thinking.append', event_id: eventId('context'), delegation_id: null, content: about });
        const line = kind === 'call' ? (about ? OPENINGS.task : OPENINGS.fresh) : OPENINGS[kind];
        send({ type: 'session.instructions.append', event_id: eventId('greet'), delegation_id: null, content: line });
        if (kind === 'preview') void afterLine().then(() => foldAndEnd());
        break;
      }
      case 'session.input_transcript.delta': {
        const delta = String(event.delta || '');
        heard.current.pending += delta;
        setCaptions((c) => ({ ...c, user: tail(c.last === 'user' ? c.user + delta : delta.trimStart()), last: 'user' }));
        break;
      }
      case 'session.output_transcript.delta': {
        const delta = String(event.delta || '');
        setCaptions((c) => ({ ...c, agent: tail(c.last === 'agent' ? c.agent + delta : delta.trimStart()), last: 'agent' }));
        setAgentSpeaking(true);
        spoke.current = Date.now();
        clearTimeout(speakingTimer.current);
        speakingTimer.current = setTimeout(() => setAgentSpeaking(false), 1200);
        break;
      }
      case 'session.delegation.created':
        if (event.delegation?.target === 'client' && event.delegation?.id) void handleDelegation(event.delegation.id);
        break;
      case 'session.closed':
        setNotice(event.reason && event.reason !== 'client_requested' ? `The call ended (${event.reason}).` : '');
        // Hung up here: just close. Ended on the other side: say so.
        setPhase((p) => (p === 'ending' ? 'idle' : 'ended'));
        setWorking(false);
        setClosing(false);
        cleanup();
        break;
      case 'error':
        console.warn('[voice-call] error', event.error);
        break;
      default:
    }
  }, [cleanup, handleDelegation, send]);

  // Resolves once Anton has said the line just asked for (or it never came).
  const afterLine = useCallback(() => new Promise((resolve) => {
    const asked = Date.now();
    spoke.current = 0;
    const tick = () => {
      const now = Date.now();
      const started = spoke.current > 0;
      if (!call.current || now - asked > LINE_MAX_MS
        || (!started && now - asked > LINE_START_MS)
        || (started && now - spoke.current > LINE_QUIET_MS)) { resolve(); return; }
      setTimeout(tick, 150);
    };
    setTimeout(tick, 150);
  }), []);

  const startRef = useRef(null);
  const endRef = useRef(null);
  // Folds the card, then hangs up.
  const foldAndEnd = useCallback(async () => {
    if (!call.current) return;
    setClosing(true);
    await new Promise((r) => { setTimeout(r, FOLD_MS); });
    await endRef.current?.();
  }, []);

  const start = useCallback(async ({ voice: asked = null, kind = 'call' } = {}) => {
    if (call.current) return;
    opening.current = kind;
    setPhase('starting');
    setNotice('');
    setClosing(false);
    setVoice(asked);
    setPreviewing(kind === 'preview');
    setCaptions({ user: '', agent: '', last: null });
    setWorking(false);
    setMicOn(kind !== 'preview');
    heard.current = { pending: '', lastTurn: '' };
    let mine = null;
    try {
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      // Started by the click that started the call, so the browser lets it run.
      const listening = typeof AudioContext === 'function' ? new AudioContext() : null;
      mine = { peer, audio, listening };
      call.current = mine;
      const meter = (stream) => {
        if (!listening) return null;
        try {
          const analyser = listening.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.78;
          listening.createMediaStreamSource(stream).connect(analyser);
          return analyser;
        } catch {
          return null;
        }
      };
      peer.addEventListener('track', (e) => {
        const voice = new MediaStream([e.track]);
        audio.srcObject = voice;
        audio.play().catch(() => {});
        meters.current = { ...meters.current, agent: meter(voice) };
      });
      if (kind === 'preview') {
        // Only listening: no microphone to ask for.
        peer.addTransceiver('audio', { direction: 'recvonly' });
      } else {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (call.current !== mine) { microphone.getTracks().forEach((t) => t.stop()); return; }
        mine.microphone = microphone;
        meters.current = { ...meters.current, user: meter(microphone) };
        microphone.getAudioTracks().forEach((t) => peer.addTrack(t, microphone));
      }
      // The event channel exists before the offer, so it is negotiated with it.
      const channel = peer.createDataChannel(CHANNEL);
      mine.channel = channel;
      channel.addEventListener('message', ({ data }) => {
        try { onEvent(JSON.parse(data)); } catch { /* not an event */ }
      });
      channel.addEventListener('close', () => {
        if (call.current?.channel !== channel) return;
        setPhase((p) => (p === 'ended' || p === 'idle' ? p : 'ended'));
        cleanup();
      });

      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          const done = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
          peer.addEventListener('icegatheringstatechange', done);
          setTimeout(resolve, 5000);
        });
      }
      if (call.current !== mine) return; // hung up, or switched, while it started
      const created = await startVoiceSession(peer.localDescription.sdp, asked);
      if (call.current !== mine) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: created.transport.sdp });
    } catch (err) {
      if (mine && call.current !== mine) return;
      cleanup();
      setNotice(voiceStartFailure(err));
      setPhase('ended');
    }
  }, [cleanup, onEvent]);

  const end = useCallback(async () => {
    if (!call.current) { setPhase('idle'); return; }
    setPhase('ending');
    if (send({ type: 'session.close' })) {
      // session.closed cleans up; this is the backstop.
      setTimeout(() => { if (call.current) { cleanup(); setPhase('idle'); } }, CLOSE_WAIT_MS);
    } else {
      cleanup();
      setPhase('idle');
    }
  }, [cleanup, send]);
  startRef.current = start;
  endRef.current = end;

  // Hangs up at once and starts again in `voice`, which says a short line
  // (`kind` 'switch' on a call, 'preview' with no call).
  const restart = useCallback((asked, kind) => {
    if (call.current) {
      send({ type: 'session.close' });
      cleanup();
    }
    setPhase('idle');
    void startRef.current?.({ voice: asked, kind });
  }, [cleanup, send]);
  const switchVoice = useCallback((asked) => restart(asked, opening.current === 'preview' || !call.current ? 'preview' : 'switch'), [restart]);
  const preview = useCallback((asked) => restart(asked, 'preview'), [restart]);

  // The card's Mute: the microphone goes off, Anton says goodbye, the card
  // folds away and the call ends.
  const signOff = useCallback(async () => {
    if (!call.current || closing) return;
    call.current.microphone?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setMicOn(false);
    if (send({ type: 'session.instructions.append', event_id: eventId('bye'), delegation_id: null, content: OPENINGS.signOff })) {
      await afterLine();
    }
    await foldAndEnd();
  }, [afterLine, closing, foldAndEnd, send]);

  // Something to tell the person unasked (queued work finished): GPT-Live
  // says it in its own words when it can.
  const announce = useCallback((text) => send({
    type: 'session.instructions.append',
    event_id: eventId('announce'),
    delegation_id: null,
    content: `Tell the user now, in one or two short sentences: ${withoutPhoneNumbers(String(text)).slice(0, MAX_SPOKEN_CHARS)}`,
  }), [send]);

  const toggleMic = useCallback(() => {
    const tracks = call.current?.microphone?.getAudioTracks() || [];
    if (!tracks.length) return;
    const on = !tracks[0].enabled;
    tracks.forEach((t) => { t.enabled = on; });
    setMicOn(on);
  }, []);

  // Leaving the app hangs up.
  useEffect(() => {
    const leave = () => { send({ type: 'session.close' }); cleanup(); };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, [cleanup, send]);

  return {
    phase, notice, captions, agentSpeaking, working, micOn, meters, closing, voice, previewing,
    start, end, toggleMic, announce, switchVoice, preview, signOff,
    dismiss: () => { setPhase('idle'); setNotice(''); },
  };
}
