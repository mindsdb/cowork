// A video call with Anton (prototype): an avatar from Nuance Labs that the
// person talks to, which hands each request for work to Anton in their task.
//
// The server mints the call's session token (cowork.services.facetime), which
// fixes the avatar's prompt and its one tool, ask_cowork. This hook runs the
// call with Nuance's SDK:
//
// - Start from a click: browsers play the avatar's voice only after one.
// - Once the avatar can hear the person and is in view, it gets what the task
//   is about as background (never in the prompt, which Nuance reviews once)
//   and is asked to say hello.
// - Each ask_cowork call goes to `onAsk(request)`, which sends it to Anton the
//   way a typed message goes and resolves with Anton's answer. The answer goes
//   back without phone numbers (forTheAvatar), and the avatar says the gist.
// - Live captions of both sides, mute, camera and hang-up.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createNuanceConversation, MediaAccessError } from '@nuancelabs/js-sdk';
import { mintFacetimeToken } from '../../api';
import { forTheAvatar, withoutPhoneNumbers } from './forTheAvatar';

const CAPTION_CHARS = 180;

// What the person sees when a call ends on Nuance's side.
const ENDINGS = {
  'time-limit': 'The call reached its time limit.',
  'policy-violation': 'This call ended because something in it broke the video service\'s rules.',
  'age-check': 'This call ended because it looks like someone under 18 is using it without an adult.',
  refused: 'The video service refused the call.',
  'connection-lost': 'The connection was lost.',
};

function tail(text) {
  return text.length > CAPTION_CHARS ? `…${text.slice(-CAPTION_CHARS)}` : text;
}

/** Why a call couldn't start, in words for the person. */
export function startFailure(err) {
  if (err instanceof MediaAccessError) {
    return err.reason === 'permission-denied'
      ? `Allow the ${err.device === 'camera' ? 'camera' : 'microphone'} in your browser to start a video call.`
      : `Couldn't open your ${err.device === 'camera' ? 'camera' : 'microphone'}.`;
  }
  return err?.message || 'Couldn\'t start the video call.';
}

/**
 * `onAsk(request)` resolves with Anton's answer, or rejects. `context()`
 * returns background about the task, or ''.
 */
export function useFacetimeCall({ onAsk, context }) {
  // idle | starting | preparing | live | ended
  const [phase, setPhase] = useState('idle');
  const [notice, setNotice] = useState('');
  const [captions, setCaptions] = useState({ user: '', avatar: '', last: null });
  const [speaking, setSpeaking] = useState({ user: false, avatar: false });
  const [working, setWorking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(null);

  const conversationRef = useRef(null);
  const avatarVideoRef = useRef(null);
  const avatarAudioRef = useRef(null);
  const selfVideoRef = useRef(null);
  const onAskRef = useRef(onAsk);
  const contextRef = useRef(context);
  onAskRef.current = onAsk;
  contextRef.current = context;

  const attach = useCallback(() => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (avatarVideoRef.current) conversation.avatar.videoTrack?.attach(avatarVideoRef.current);
    if (avatarAudioRef.current) conversation.avatar.audioTrack?.attach(avatarAudioRef.current);
    if (selfVideoRef.current && conversation.user.videoTrack) conversation.user.videoTrack.attach(selfVideoRef.current);
  }, []);

  const start = useCallback(async ({ camera = true } = {}) => {
    if (conversationRef.current) return;
    setPhase('starting');
    setNotice('');
    setCaptions({ user: '', avatar: '', last: null });
    setWorking(false);
    setSecondsLeft(null);
    setMicOn(true);
    setCameraOn(camera);

    const conversation = createNuanceConversation({
      token: mintFacetimeToken,
      mediaDevices: { cameraEnabled: camera },
    });
    conversationRef.current = conversation;
    let started = false;
    let presented = false;
    let greeted = false;

    // Nothing goes to the avatar before session.started, and it greets once in view.
    const greet = async () => {
      if (greeted || !started || !presented) return;
      greeted = true;
      const about = withoutPhoneNumbers(contextRef.current?.() || '').slice(0, 1900);
      try {
        if (about) await conversation.append('thinking', about);
        await conversation.sendInterfaceEvent({
          type: 'response.create',
          response: {
            instructions: about
              ? 'Say hello in one short sentence, say you know what this task is about, and ask what they want to do next.'
              : 'Say hello in one short sentence and ask what they would like to work on.',
          },
        });
      } catch {
        // The person can still start talking.
      }
    };

    conversation.onChange((event) => {
      switch (event.type) {
        case 'avatar-preparing':
          setPhase('preparing');
          break;
        case 'tracks-changed':
        case 'camera-changed':
          attach();
          break;
        case 'avatar-presented':
          presented = true;
          setPhase('live');
          attach();
          void greet();
          break;
        case 'speaking-changed':
          setSpeaking((s) => ({ ...s, [event.participant]: event.isSpeaking }));
          break;
        case 'time-remaining':
          setSecondsLeft(event.secondsRemaining);
          break;
        case 'session-ended':
          setNotice(event.message || ENDINGS[event.reason] || '');
          setPhase('ended');
          setWorking(false);
          conversationRef.current = null;
          break;
        default:
      }
    });

    conversation.onInterfaceEvent((event) => {
      if (event.type === 'session.started') {
        started = true;
        void greet();
      } else if (event.type === 'session.input_transcript.delta') {
        setCaptions((c) => ({ ...c, user: tail(c.last === 'user' ? c.user + String(event.delta) : String(event.delta).trimStart()), last: 'user' }));
      } else if (event.type === 'session.output_transcript.delta') {
        setCaptions((c) => ({ ...c, avatar: tail(c.last === 'avatar' ? c.avatar + String(event.delta) : String(event.delta).trimStart()), last: 'avatar' }));
      }
    });

    conversation.onToolCall(async (call) => {
      const request = typeof call.arguments?.request === 'string' ? call.arguments.request.trim() : '';
      if (call.name !== 'ask_cowork' || !request) {
        await conversation.sendToolResult(call.callId, { error: { message: `Can't run ${call.name} with these arguments` } });
        return;
      }
      setWorking(true);
      let output;
      try {
        output = forTheAvatar(await onAskRef.current(request));
      } catch (err) {
        output = { error: { message: withoutPhoneNumbers(err?.message || 'Anton could not finish it.').slice(0, 300) } };
      } finally {
        setWorking(false);
      }
      try {
        await conversation.sendToolResult(call.callId, output);
      } catch {
        // The call ended while Anton worked; the task still has the answer.
      }
    });

    try {
      await conversation.connect();
      attach();
    } catch (err) {
      conversationRef.current = null;
      setNotice(startFailure(err));
      setPhase('ended');
    }
  }, [attach]);

  const end = useCallback(async () => {
    const conversation = conversationRef.current;
    conversationRef.current = null;
    setPhase('idle');
    setWorking(false);
    try {
      await conversation?.disconnect();
    } catch {
      // Already gone.
    }
  }, []);

  const toggleMic = useCallback(async () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (conversation.user.isMuted) await conversation.user.unmuteAudio();
    else await conversation.user.muteAudio();
    setMicOn(!conversation.user.isMuted);
  }, []);

  const toggleCamera = useCallback(async () => {
    const conversation = conversationRef.current;
    if (!conversation) return;
    if (conversation.user.isVideoEnabled) await conversation.user.disableVideo();
    else await conversation.user.enableVideo();
    setCameraOn(conversation.user.isVideoEnabled);
    attach();
  }, [attach]);

  // Leaving the app hangs up, so the call doesn't hold the one place the plan allows.
  useEffect(() => {
    const leave = () => { void conversationRef.current?.disconnect(); };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  return {
    phase, notice, captions, speaking, working, micOn, cameraOn, secondsLeft,
    avatarVideoRef, avatarAudioRef, selfVideoRef,
    start, end, toggleMic, toggleCamera, attach,
    dismiss: () => { setPhase('idle'); setNotice(''); },
  };
}
