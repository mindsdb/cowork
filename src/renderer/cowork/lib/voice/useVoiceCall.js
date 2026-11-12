// A voice call with Anton (ENG-4138, prototype): OpenAI GPT-Live through
// MindsHub Inference.
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
// - `end` sends `session.close` and waits briefly for `session.closed`, so the
//   session ends and its usage is final; the microphone stops with the call.
//   The person's own hang-up (`hangUp`: the card's X, or asking the call to
//   hang up, `hangUpAfterAnswer`) stops the microphone at once first. A call
//   that fades out keeps listening until it really ends.
// - `meters` holds an AnalyserNode for each voice ({agent, user}), for the
//   card's sound waves. Listening only: the audio element plays the voice.
// - A session's voice is fixed when it starts, so `switchVoice` hangs up at
//   once and starts again in the new voice, which says a short line; a switch
//   while one is still starting drops that one. `preview` is the same with no
//   microphone, and hangs up after its line.
// - `signOff` (the card's Mute) has Anton say a short goodbye, then folds the
//   card away (`closing`) and hangs up.
// - A call that goes quiet (nobody speaks and Anton has no work running) for
//   IDLE_MS stops listening: the card folds away and the call ends.
// - Right after the call hands Anton work (`armAway`), and after a call-back
//   says its news, a quiet AWAY_MS is enough. Either way the card first fades
//   out while the call still listens for LINGER_MS (`lingering`): speech
//   brings it back, and so does the call button (`resume`), which also drops
//   the quick rule. Then it hangs up; with work still running (`busy`) it
//   calls `onAway`, and the app calls back (`callBack`) when the work is done.

import { useCallback, useEffect, useRef, useState } from 'react';
import { startVoiceSession } from '../../api';
import { forTheAvatar, withoutPhoneNumbers } from './forTheAvatar';

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
// A call this long with nobody speaking and no work running ends by itself.
export const IDLE_MS = 60_000;
// Quiet this long after handing Anton work, or after a call-back's news: fade out.
export const AWAY_MS = 5_000;
// How long a faded call still listens before it hangs up.
export const LINGER_MS = 3_500;
const IDLE_CHECK_MS = 1_000;
// A call-back that hears nothing from GPT-Live this long after it starts stops
// analyzing and opens the microphone, so the person can speak.
export const ANALYZE_MAX_MS = 20_000;

const OPENINGS = {
  // Mid-task the call opens silent: Anton has the task's context and waits
  // for the person to ask for something.
  task: null,
  fresh: 'Say a short hi, a casual variation of "hi" in a few words, and nothing else. Then wait for the user.',
  switch: 'The user just switched you to a new voice. Say one short, playful line in it, like "How\'s this voice?", and nothing else.',
  preview: 'The user is trying out your voice. Say one short, friendly line so they can hear it, like "Hi, this is how I sound", and nothing else.',
  callBack: (news, lastSaid) => [
    'You hung up while Anton worked and are calling the user back with the result.',
    lastSaid ? `The last thing you said before hanging up was: "${lastSaid}". Pick up from there.` : '',
    'Tell them the result now, in two or three short spoken sentences, starting with something like "Hey, it\'s done".',
    'Then ask whether they need anything else, suggesting one fitting next step if one stands out.',
    'If they say no, say only something like "OK, just ping me if you need me."',
    `The result: ${news}`,
  ].filter(Boolean).join(' '),
  signOff: 'The user muted you to end the call. Say one short goodbye in your own words, a variation of "Got it, just click the call button whenever you need me next." Say nothing else.',
};

function tail(text) {
  return text.length > CAPTION_CHARS ? `…${text.slice(-CAPTION_CHARS)}` : text;
}

// Whether a call in `phase` still holds the line: an ended one only shows its card.
export const voiceCallRunning = (phase) => phase !== 'idle' && phase !== 'ended';

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
export function useVoiceCall({ onAsk, context, busy, onAway }) {
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
  // Faded out, still listening for a moment before it hangs up.
  const [lingering, setLingering] = useState(false);
  const lingeringRef = useRef(false);
  const lingerTimer = useRef(null);
  // The quick rule (AWAY_MS): after handing Anton work, and on a call-back.
  const awayArmed = useRef(false);

  // { peer, channel, microphone, audio, listening, live, ending, pending }:
  // `live` once the session started, `ending` once it is hanging up, and
  // `pending` what to announce once it is live.
  const call = useRef(null);
  const meters = useRef({ agent: null, user: null });
  const heard = useRef({ pending: '', lastTurn: '' });
  const speakingTimer = useRef(null);
  // When Anton last said something, and the session's opening.
  const spoke = useRef(0);
  // When anyone last spoke or Anton last had work, for the idle stop.
  const lastActive = useRef(0);
  const workingRef = useRef(false);
  const opening = useRef('call');
  const onAskRef = useRef(onAsk);
  const contextRef = useRef(context);
  onAskRef.current = onAsk;
  // Whether the call has work running outside a delegation (a queued request).
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onAwayRef = useRef(onAway);
  onAwayRef.current = onAway;
  // What a call-back says first, and the last thing the call said before it hung up.
  const news = useRef('');
  const lastSaid = useRef('');
  // Anton's line so far, since the person last spoke.
  const agentLine = useRef('');
  // A call-back before its first word: the card says it is analyzing, and the
  // microphone stays off until Anton speaks.
  const [analyzing, setAnalyzing] = useState(false);
  const analyzingRef = useRef(false);
  const analyzeTimer = useRef(null);
  contextRef.current = context;

  const cleanup = useCallback(() => {
    const current = call.current;
    call.current = null;
    clearTimeout(speakingTimer.current);
    clearTimeout(lingerTimer.current);
    clearTimeout(analyzeTimer.current);
    lingeringRef.current = false;
    setLingering(false);
    analyzingRef.current = false;
    setAnalyzing(false);
    // A request still out belongs to the call that is going: the next call
    // starts with no work, so its idle stop isn't held off for good.
    workingRef.current = false;
    setWorking(false);
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

  // The answer goes back to the session that asked: a call that changed since
  // (hung up, or moved to another voice) drops it.
  const handleDelegation = useCallback(async (delegationId) => {
    const asking = call.current;
    await new Promise((r) => { setTimeout(r, TRANSCRIPT_SETTLE_MS); });
    if (call.current !== asking) return;
    const request = (heard.current.pending.trim() || heard.current.lastTurn).trim();
    heard.current.lastTurn = request || heard.current.lastTurn;
    heard.current.pending = '';
    if (!request) {
      send({ type: 'session.commentary.append', event_id: eventId('nothing'), delegation_id: delegationId, content: 'I didn\'t catch the request. Ask the user to say it again.' });
      return;
    }
    setWorking(true);
    workingRef.current = true;
    let content;
    try {
      content = forTheAvatar(await onAskRef.current(request), { maxChars: MAX_SPOKEN_CHARS });
    } catch (err) {
      content = `Anton couldn't finish it: ${withoutPhoneNumbers(err?.message || 'something went wrong').slice(0, 300)}`;
    } finally {
      if (call.current === asking) {
        setWorking(false);
        workingRef.current = false;
        lastActive.current = Date.now();
      }
    }
    if (call.current !== asking) return;
    send({ type: 'session.commentary.append', event_id: eventId('result'), delegation_id: delegationId, content });
    // The person asked to hang up (hangUpAfterAnswer): the goodbye, then the card's X.
    if (asking.hangUpAfter) {
      await afterLineRef.current?.(asking);
      await foldAndEndRef.current?.(asking);
    }
  }, [send]);

  // Back from fading out: someone spoke, or the person clicked the call button.
  const wake = useCallback(() => {
    if (!lingeringRef.current) return;
    clearTimeout(lingerTimer.current);
    lingeringRef.current = false;
    setLingering(false);
    lastActive.current = Date.now();
  }, []);

  // A call-back's analyzing ends: Anton spoke, or never will. The person can answer.
  const stopAnalyzing = useCallback(() => {
    clearTimeout(analyzeTimer.current);
    if (!analyzingRef.current) return;
    analyzingRef.current = false;
    setAnalyzing(false);
    call.current?.microphone?.getAudioTracks().forEach((t) => { t.enabled = true; });
    setMicOn(true);
  }, []);

  const onEvent = useCallback((event) => {
    switch (event.type) {
      case 'session.started': {
        setPhase('live');
        const current = call.current;
        if (current) current.live = true;
        const kind = opening.current;
        const about = kind === 'preview' ? '' : withoutPhoneNumbers(contextRef.current?.() || '').slice(0, 1800);
        if (about) send({ type: 'session.thinking.append', event_id: eventId('context'), delegation_id: null, content: about });
        const line = kind === 'call' ? (about ? OPENINGS.task : OPENINGS.fresh)
          : kind === 'callBack' ? OPENINGS.callBack(news.current, lastSaid.current) : OPENINGS[kind];
        if (line) send({ type: 'session.instructions.append', event_id: eventId('greet'), delegation_id: null, content: line });
        // News that came while it connected.
        (current?.pending || []).forEach((content) => {
          send({ type: 'session.instructions.append', event_id: eventId('announce'), delegation_id: null, content });
        });
        if (current) current.pending = [];
        if (kind === 'preview') void afterLine(current).then(() => foldAndEnd(current));
        if (analyzingRef.current) {
          clearTimeout(analyzeTimer.current);
          analyzeTimer.current = setTimeout(() => { if (call.current === current) stopAnalyzing(); }, ANALYZE_MAX_MS);
        }
        break;
      }
      case 'session.input_transcript.delta': {
        wake();
        agentLine.current = '';
        lastActive.current = Date.now();
        const delta = String(event.delta || '');
        heard.current.pending += delta;
        setCaptions((c) => ({ ...c, user: tail(c.last === 'user' ? c.user + delta : delta.trimStart()), last: 'user' }));
        break;
      }
      case 'session.output_transcript.delta': {
        wake();
        const delta = String(event.delta || '');
        agentLine.current = (agentLine.current + delta).slice(-400);
        // Anton is speaking: from here the person can answer.
        stopAnalyzing();
        setCaptions((c) => ({ ...c, agent: tail(c.last === 'agent' ? c.agent + delta : delta.trimStart()), last: 'agent' }));
        setAgentSpeaking(true);
        spoke.current = Date.now();
        lastActive.current = spoke.current;
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
        // A call-back would wait for a line that may never come.
        stopAnalyzing();
        break;
      default:
    }
  }, [cleanup, handleDelegation, send, stopAnalyzing, wake]);

  // Resolves once Anton has said the line just asked for in `owner` (or it
  // never came, or that call is gone).
  const afterLine = useCallback((owner) => new Promise((resolve) => {
    const asked = Date.now();
    spoke.current = 0;
    const tick = () => {
      const now = Date.now();
      const started = spoke.current > 0;
      if (!owner || call.current !== owner || now - asked > LINE_MAX_MS
        || (!started && now - asked > LINE_START_MS)
        || (started && now - spoke.current > LINE_QUIET_MS)) { resolve(); return; }
      setTimeout(tick, 150);
    };
    setTimeout(tick, 150);
  }), []);

  const startRef = useRef(null);
  const endRef = useRef(null);
  const afterLineRef = useRef(afterLine);
  afterLineRef.current = afterLine;
  const foldAndEndRef = useRef(null);
  // Folds the card, then hangs up `owner`: a call that replaced it since (a
  // voice switch) is not this one's to end.
  const foldAndEnd = useCallback(async (owner) => {
    if (!owner || call.current !== owner) return;
    owner.ending = true;
    setClosing(true);
    await new Promise((r) => { setTimeout(r, FOLD_MS); });
    if (call.current !== owner) return;
    await endRef.current?.();
  }, []);
  foldAndEndRef.current = foldAndEnd;

  const start = useCallback(async ({ voice: asked = null, kind = 'call', say = '' } = {}) => {
    if (call.current) return;
    opening.current = kind;
    news.current = withoutPhoneNumbers(String(say)).slice(0, MAX_SPOKEN_CHARS);
    awayArmed.current = kind === 'callBack';
    analyzingRef.current = kind === 'callBack';
    setAnalyzing(kind === 'callBack');
    agentLine.current = '';
    setPhase('starting');
    setNotice('');
    setClosing(false);
    setVoice(asked);
    setPreviewing(kind === 'preview');
    setCaptions({ user: '', agent: '', last: null });
    setWorking(false);
    workingRef.current = false;
    setMicOn(kind !== 'preview' && kind !== 'callBack');
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
        // A call-back listens only once Anton starts speaking.
        if (analyzingRef.current) microphone.getAudioTracks().forEach((t) => { t.enabled = false; });
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
    const ending = call.current;
    ending.ending = true;
    if (send({ type: 'session.close' })) {
      // session.closed cleans up; this is the backstop, for this call only: a
      // call started since (a call-back) is not this one's to end.
      setTimeout(() => { if (call.current === ending) { cleanup(); setPhase('idle'); } }, CLOSE_WAIT_MS);
    } else {
      cleanup();
      setPhase('idle');
    }
  }, [cleanup, send]);
  startRef.current = start;
  endRef.current = end;

  // The microphone of `owner` goes off now, not when the session confirms it closed.
  const stopMicrophone = useCallback((owner) => {
    owner?.microphone?.getTracks().forEach((t) => t.stop());
    setMicOn(false);
  }, []);

  // The person hangs up (the card's X): the microphone stops at once.
  const hangUp = useCallback(async () => {
    stopMicrophone(call.current);
    await end();
  }, [end, stopMicrophone]);

  // The person asked the call to hang up: the microphone stops at once, and
  // the call ends as the X ends it once the answer (a goodbye) is said.
  const hangUpAfterAnswer = useCallback(() => {
    const owner = call.current;
    if (!owner) return false;
    owner.ending = true;
    owner.hangUpAfter = true;
    stopMicrophone(owner);
    return true;
  }, [stopMicrophone]);

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
    const owner = call.current;
    if (!owner || closing) return;
    owner.ending = true;
    owner.microphone?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setMicOn(false);
    if (send({ type: 'session.instructions.append', event_id: eventId('bye'), delegation_id: null, content: OPENINGS.signOff })) {
      await afterLine(owner);
    }
    await foldAndEnd(owner);
  }, [afterLine, closing, foldAndEnd, send]);

  // Quiet for long enough (AWAY_MS right after handing Anton work or on a
  // call-back, else IDLE_MS): the card fades out and the call listens for
  // LINGER_MS more, then hangs up, saying it is away when work still runs. A
  // preview ends by itself; a sign-off is under way.
  useEffect(() => {
    if (phase !== 'live' || previewing || closing) return undefined;
    lastActive.current = Date.now();
    const timer = setInterval(() => {
      if (workingRef.current || !call.current || call.current.ending || lingeringRef.current || analyzingRef.current) return;
      const limit = awayArmed.current ? AWAY_MS : IDLE_MS;
      if (Date.now() - lastActive.current < limit) return;
      lingeringRef.current = true;
      setLingering(true);
      clearTimeout(lingerTimer.current);
      lingerTimer.current = setTimeout(() => {
        if (!lingeringRef.current || !call.current) return;
        if (busyRef.current?.()) {
          // What the call-back picks up from.
          lastSaid.current = agentLine.current.trim().slice(-300);
          onAwayRef.current?.();
        }
        call.current.microphone?.getAudioTracks().forEach((t) => { t.enabled = false; });
        setMicOn(false);
        void endRef.current?.();
      }, LINGER_MS);
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [phase, previewing, closing]);

  // The call just handed Anton work: a short quiet is enough to fade out.
  const armAway = useCallback(() => { awayArmed.current = true; lastActive.current = Date.now(); }, []);
  // The call button while the card is fading: back to an ordinary call.
  const resume = useCallback(() => {
    awayArmed.current = false;
    wake();
    lastActive.current = Date.now();
  }, [wake]);

  // Something to tell the person unasked (queued work finished): GPT-Live
  // says it in its own words when it can. Only a call that will still be
  // there to say it takes it: one connecting says it once it is live, one
  // fading out comes back for it. A call hanging up, a voice preview or no
  // call returns false, and the app calls back instead.
  const announce = useCallback((text) => {
    const current = call.current;
    if (!current || current.ending || opening.current === 'preview') return false;
    const content = 'Tell the user now, in one or two short sentences, then ask whether they need anything else, suggesting '
      + 'one fitting next step if one stands out; if they say no, say only something like "OK, just ping me if you need me": '
      + withoutPhoneNumbers(String(text)).slice(0, MAX_SPOKEN_CHARS);
    if (!current.live) {
      current.pending = [...(current.pending || []), content];
      return true;
    }
    if (!send({ type: 'session.instructions.append', event_id: eventId('announce'), delegation_id: null, content })) return false;
    wake();
    lastActive.current = Date.now();
    return true;
  }, [send, wake]);

  // Calls the person back with what Anton finished while the call was down. A
  // call still hanging up, or a voice preview, gives way to it.
  const callBack = useCallback((text, voice = null) => {
    const current = call.current;
    if (current && (current.ending || opening.current === 'preview')) {
      if (!current.ending) send({ type: 'session.close' });
      cleanup();
    }
    return startRef.current?.({ voice, kind: 'callBack', say: text });
  }, [cleanup, send]);
  // Whether a call is up and staying (for work that finishes later).
  const isOn = useCallback(() => Boolean(call.current && !call.current.ending), []);

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
    lingering, analyzing, start, end, hangUp, hangUpAfterAnswer, toggleMic, announce, switchVoice, preview, signOff, callBack, isOn, armAway, resume,
    dismiss: () => { setPhase('idle'); setNotice(''); },
  };
}
