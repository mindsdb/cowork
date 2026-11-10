import Ico from './Icons';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): who is on the call, what they
// are doing, live captions of both sides, mute and hang-up. It shows while a
// call runs; closing it hangs up. `call` is useVoiceCall's.
//
// `docked`: in the sidebar, above its footer, where the onboarding steps sit.
// Otherwise (sidebar collapsed, phone) it floats in that corner.

const STATUS = {
  starting: 'Calling…',
  ending: 'Hanging up…',
};

function RoundButton({ label, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`voice-call__btn${danger ? ' voice-call__btn--danger' : ''}`}
    >
      {children}
    </button>
  );
}

export default function VoiceCallWindow({ call, agentLabel = 'Anton', docked = false }) {
  const { phase, notice, captions, agentSpeaking, working, micOn } = call;
  if (phase === 'idle') return null;
  const live = phase === 'live';
  const ended = phase === 'ended';

  let status = STATUS[phase] || '';
  if (live) status = working ? `${agentLabel} is working on it…` : (micOn ? 'Listening' : 'Muted');
  if (ended) status = notice || 'The call ended.';

  return (
    <div role="dialog" aria-label={`Voice call with ${agentLabel}`} className={`voice-call${docked ? ' voice-call--docked' : ''}`}>
      <div className="voice-call__head">
        <span className={`voice-call__orb${live && agentSpeaking ? ' is-talking' : ''}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="voice-call__title">{agentLabel} <span className="voice-call__sub">· AI voice</span></div>
          <div className="voice-call__status" aria-live="polite">{status}</div>
        </div>
        <button
          type="button"
          aria-label={ended ? 'Close' : 'End call'}
          title={ended ? 'Close' : 'End call'}
          onClick={ended ? call.dismiss : call.end}
          className="voice-call__close"
        >
          {Ico.close(14)}
        </button>
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

      {!ended && (
        <div className="voice-call__controls">
          <RoundButton label={micOn ? 'Mute' : 'Unmute'} onClick={call.toggleMic}>
            {micOn ? Ico.mic(16) : Ico.micOff(16)}
          </RoundButton>
          <RoundButton label="Hang up" onClick={call.end} danger>
            {Ico.hangUp(16)}
          </RoundButton>
        </div>
      )}
    </div>
  );
}
