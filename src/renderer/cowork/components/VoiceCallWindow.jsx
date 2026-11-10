import Ico from './Icons';
import VoiceWaves from './VoiceWaves';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): the call's sound waves, who is
// on it and what they are doing, and mute. The X in the corner ends the call
// (or closes an ended one's card). `call` is useVoiceCall's. Mute is the
// composer's Send button.
//
// `docked`: in the sidebar, above its footer, where the onboarding steps sit.
// Otherwise (sidebar collapsed, phone) it floats in that corner.

const STATUS = {
  starting: 'Connecting…',
  ending: 'Ending…',
};

export default function VoiceCallWindow({ call, agentLabel = 'Anton', docked = false }) {
  const { phase, notice, working, micOn, meters } = call;
  if (phase === 'idle') return null;
  const live = phase === 'live';
  const ended = phase === 'ended';

  let status = STATUS[phase] || '';
  if (live) status = working ? 'Working on it…' : (micOn ? 'Listening' : 'Muted');
  if (ended) status = notice || 'The call ended.';

  return (
    <div
      role="dialog"
      aria-label={`Voice call with ${agentLabel}`}
      className={`voice-call${docked ? ' voice-call--docked' : ''}${working ? ' is-working' : ''}`}
    >
      <button
        type="button"
        className="voice-call__x"
        onClick={ended ? call.dismiss : call.end}
        aria-label={ended ? 'Close' : 'End call'}
        title={ended ? 'Close' : 'End call'}
      >
        {Ico.close(12)}
      </button>
      {!ended && <VoiceWaves meters={meters} active={live} working={working} />}
      <div className="voice-call__row">
        <div className="voice-call__who">
          <div className="voice-call__title">{agentLabel}</div>
          <div className="voice-call__status" aria-live="polite">
            {live && <span className="voice-call__dot" aria-hidden="true" />}
            {status}
          </div>
        </div>
        {!ended && (
          <div className="voice-call__controls">
            <button
              type="button"
              className={`send-btn voice-call__mic${micOn ? '' : ' is-off'}`}
              onClick={call.toggleMic}
              aria-label={micOn ? 'Mute' : 'Unmute'}
              title={micOn ? 'Mute' : 'Unmute'}
            >
              {micOn ? Ico.mic(16) : Ico.micOff(16)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
