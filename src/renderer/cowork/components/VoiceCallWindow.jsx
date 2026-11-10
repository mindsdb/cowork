import Ico from './Icons';
import VoiceWaves from './VoiceWaves';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): the call's sound waves, who is
// on it and what they are doing, mute and end. It shows while a call runs, and
// ending it closes it. `call` is useVoiceCall's. The buttons are the
// composer's: Mute is its Send, End is its Stop.
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
      {!ended && <VoiceWaves meters={meters} active={live} working={working} />}
      <div className="voice-call__row">
        <div className="voice-call__who">
          <div className="voice-call__title">{agentLabel}</div>
          <div className="voice-call__status" aria-live="polite">
            {live && <span className="voice-call__dot" aria-hidden="true" />}
            {status}
          </div>
        </div>
        {ended ? (
          <button type="button" className="voice-call__text-btn" onClick={call.dismiss}>Close</button>
        ) : (
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
            <button
              type="button"
              className="send-btn voice-call__end"
              onClick={call.end}
              aria-label="End call"
              title="End call"
            >
              {Ico.hangUp(16)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
