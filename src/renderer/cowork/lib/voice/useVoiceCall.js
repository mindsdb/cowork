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

  const call = useRef(null); // { peer, channel, microphone, audio }
  const heard = useRef({ pending: '', lastTurn: '' });
  const speakingTimer = useRef(null);
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
        const about = withoutPhoneNumbers(contextRef.current?.() || '').slice(0, 1800);
        if (about) send({ type: 'session.thinking.append', event_id: eventId('context'), delegation_id: null, content: about });
        send({
          type: 'session.instructions.append',
          event_id: eventId('greet'),
          delegation_id: null,
          content: about
            ? 'Greet the user in one short sentence, say you know what this task is about, and ask what they want to do next.'
            : 'Greet the user in one short sentence and ask what they would like to work on.',
        });
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
        cleanup();
        break;
      case 'error':
        console.warn('[voice-call] error', event.error);
        break;
      default:
    }
  }, [cleanup, handleDelegation, send]);

  const start = useCallback(async () => {
    if (call.current) return;
    setPhase('starting');
    setNotice('');
    setCaptions({ user: '', agent: '', last: null });
    setWorking(false);
    setMicOn(true);
    heard.current = { pending: '', lastTurn: '' };
    try {
      const peer = new RTCPeerConnection();
      const audio = new Audio();
      audio.autoplay = true;
      call.current = { peer, audio };
      peer.addEventListener('track', (e) => {
        audio.srcObject = new MediaStream([e.track]);
        audio.play().catch(() => {});
      });
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      call.current.microphone = microphone;
      microphone.getAudioTracks().forEach((t) => peer.addTrack(t, microphone));
      // The event channel exists before the offer, so it is negotiated with it.
      const channel = peer.createDataChannel(CHANNEL);
      call.current.channel = channel;
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
      const created = await startVoiceSession(peer.localDescription.sdp);
      if (!call.current) return; // hung up while it started
      await peer.setRemoteDescription({ type: 'answer', sdp: created.transport.sdp });
    } catch (err) {
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
    phase, notice, captions, agentSpeaking, working, micOn,
    start, end, toggleMic,
    dismiss: () => { setPhase('idle'); setNotice(''); },
  };
}
