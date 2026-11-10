import Ico from './Icons';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): who is on the call, what they
// are doing, live captions of both sides, mute and hang-up. It floats over the
// app and never covers the composer (voice-call.css). `call` is useVoiceCall's.

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
      className={`w-9 h-9 rounded-full inline-flex items-center justify-center border-0 cursor-pointer text-white ${
        danger ? 'bg-[#d93025] hover:bg-[#b3261e]' : 'bg-white/15 hover:bg-white/25'
      }`}
    >
      {children}
    </button>
  );
}

export default function VoiceCallWindow({ call, agentLabel = 'Anton' }) {
  const { phase, notice, captions, agentSpeaking, working, micOn } = call;
  if (phase === 'idle') return null;
  const live = phase === 'live';

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
            onClick={call.dismiss}
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
