import Ico from './Icons';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): who is on the call, what they
// are doing, live captions of both sides, mute and hang-up. It floats over the
// app and never covers the composer (voice-call.css). `call` is useVoiceCall's.
// The task view's top-right call icon opens it (`open`). With no call yet it
// offers one (`onStart`). Closing it only hides it: the call goes on, the icon
// brings it back, and away from a task (`bubble`) a small orb at the top
// right does.

// What the card says before a call, one per opening.
export const INVITES = [
  'Line’s open. Say the word.',
  'Ready when you are. Talk me through it.',
  'Hands busy? Just say it.',
  'Skip the typing. I’m all ears.',
];

const STATUS = {
  starting: 'Calling…',
  ending: 'Hanging up…',
};

function CloseButton({ onClick, label }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="voice-call__close">
      {Ico.close(14)}
    </button>
  );
}

function RoundButton({ label, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`w-9 h-9 rounded-full inline-flex items-center justify-center border-0 cursor-pointer text-white ${
        danger ? 'bg-[#d93025] hover:bg-[#b3261e]' : 'bg-white/15 hover:bg-white/25'
      }`}
    >
      {children}
    </button>
  );
}

export default function VoiceCallWindow({
  call, agentLabel = 'Anton', open = false, onClose, onShow, onStart = null, startBlocked = '', bubble = false, invite = INVITES[0],
}) {
  const { phase, notice, captions, agentSpeaking, working, micOn } = call;
  const live = phase === 'live';

  if (phase === 'idle') {
    if (!open) return null;
    return (
      <div role="dialog" aria-label={`Voice call with ${agentLabel}`} className="voice-call">
        <div className="voice-call__head">
          <span className="voice-call__orb" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="voice-call__title">{agentLabel} <span className="text-white/50 font-normal">· AI voice</span></div>
            <div className="voice-call__status">{startBlocked || invite}</div>
          </div>
          <CloseButton onClick={onClose} label="Close" />
        </div>
        <div className="voice-call__controls">
          <button
            type="button"
            onClick={onStart || undefined}
            disabled={!onStart}
            className="voice-call__start"
          >
            {Ico.call(14)} Start call
          </button>
        </div>
      </div>
    );
  }

  // Hidden, the call goes on. An ended call shows why, hidden or not.
  if (!open && phase !== 'ended') {
    if (!bubble) return null;
    return (
      <button
        type="button"
        aria-label={`Show the call with ${agentLabel}`}
        title={`Show the call with ${agentLabel}`}
        onClick={onShow}
        className="voice-call-bubble"
      >
        <span className={`voice-call__orb${live && agentSpeaking ? ' is-talking' : ''}`} aria-hidden="true" />
      </button>
    );
  }

  let status = STATUS[phase] || '';
  if (live) status = working ? `${agentLabel} is working on it…` : (micOn ? 'Listening' : 'Muted');
  if (phase === 'ended') status = notice || 'The call ended.';

  return (
    <div role="dialog" aria-label={`Voice call with ${agentLabel}`} className="voice-call">
      <div className="voice-call__head">
        <span className={`voice-call__orb${live && agentSpeaking ? ' is-talking' : ''}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="voice-call__title">{agentLabel} <span className="text-white/50 font-normal">· AI voice</span></div>
          <div className="voice-call__status" aria-live="polite">{status}</div>
        </div>
        {phase !== 'ended' && onClose && <CloseButton onClick={onClose} label="Hide (the call goes on)" />}
      </div>

      {live && (captions.user || captions.agent) && (
        <div className="voice-call__captions" aria-live="polite">
          {captions.user && (
            <div className={`voice-call__caption is-user${captions.last === 'user' ? '' : ' is-old'}`}>{captions.user}</div>
          )}
          {captions.agent && (
            <div className={`voice-call__caption${captions.last === 'agent' ? '' : ' is-old'}`}>{captions.agent}</div>
          )}
        </div>
      )}

      <div className="voice-call__controls">
        {phase === 'ended' ? (
          <button
            type="button"
            onClick={onClose || call.dismiss}
            className="text-sm px-3 py-1.5 rounded-lg bg-white/15 hover:bg-white/25 border-0 text-white cursor-pointer"
          >
            Close
          </button>
        ) : (
          <>
            <RoundButton label={micOn ? 'Mute' : 'Unmute'} onClick={call.toggleMic}>
              {micOn ? Ico.mic(16) : Ico.micOff(16)}
            </RoundButton>
            <RoundButton label="Hang up" onClick={call.end} danger>
              {Ico.hangUp(16)}
            </RoundButton>
          </>
        )}
      </div>
    </div>
  );
}
