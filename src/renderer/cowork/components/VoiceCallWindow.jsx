import Ico from './Icons';
import Menu from './ui/Menu';
import VoiceWaves from './VoiceWaves';
import { VOICES, setVoicePrefs, useVoicePrefs, voiceLabel } from '../lib/voice/voicePrefs';
import './voice-call.css';

// The voice call's card (ENG-4138, prototype): the call's sound waves, who is
// on it and what they are doing, and mute. The X in the corner ends the call
// (or closes an ended one's card). `call` is useVoiceCall's. Mute is the
// composer's Send button: it mutes and signs off (Anton says goodbye, the card
// folds away and the call ends). The chevron by the name picks the voice,
// which moves the call to it at once (App listens to voicePrefs).
//
// `docked`: in the sidebar, above its footer, where the onboarding steps sit.
// Otherwise (sidebar collapsed, phone) it floats in that corner.

const STATUS = {
  starting: 'Connecting…',
  ending: 'Ending…',
};

export default function VoiceCallWindow({ call, agentLabel = 'Anton', docked = false }) {
  const { phase, notice, working, micOn, meters, closing, lingering } = call;
  const prefs = useVoicePrefs();
  if (phase === 'idle') return null;
  const live = phase === 'live';
  const ended = phase === 'ended';

  let status = STATUS[phase] || '';
  if (live) status = working ? 'Working on it…' : (micOn ? 'Listening' : 'Talk soon');
  if (call.previewing && (live || phase === 'starting')) status = `Trying ${voiceLabel(prefs.voice)}`;
  if (ended) status = notice || 'The call ended.';

  // Until the session is live: one quiet line, no waves, so the card never
  // looks like it listens before it can.
  if (phase === 'starting') {
    return (
      <div
        role="dialog"
        aria-label={`Voice call with ${agentLabel}`}
        className={`voice-call voice-call--connecting${docked ? ' voice-call--docked' : ''}`}
      >
        <span className="voice-call__spin" aria-hidden="true" />
        <span className="voice-call__connecting" aria-live="polite">Connecting voice…</span>
        <button type="button" className="voice-call__x" onClick={call.end} aria-label="End call" title="End call">
          {Ico.close(12)}
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={`Voice call with ${agentLabel}`}
      className={`voice-call${docked ? ' voice-call--docked' : ''}${working ? ' is-working' : ''}${ended ? ' is-ended' : ''}${closing ? ' is-closing' : ''}${lingering ? ' is-lingering' : ''}`}
      aria-hidden={lingering || undefined}
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
          <div className="voice-call__name">
            <span className="voice-call__title">{agentLabel}</span>
            {!ended && (
              <Menu
                side="top"
                align="start"
                width={220}
                ariaLabel="Voice"
                trigger={(
                  <button type="button" className="voice-call__voice" aria-label={`Voice: ${voiceLabel(prefs.voice)}`} title="Change voice">
                    {Ico.chevDown(12)}
                  </button>
                )}
                items={[
                  { heading: 'Voice' },
                  ...VOICES.map((v) => ({
                    key: v.value,
                    label: v.label,
                    hint: v.accent,
                    icon: v.value === prefs.voice ? Ico.check(12) : <span style={{ width: 12 }} />,
                    aria: { role: 'menuitemradio', 'aria-checked': v.value === prefs.voice },
                    onClick: () => setVoicePrefs({ voice: v.value }),
                  })),
                ]}
              />
            )}
          </div>
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
              onClick={call.signOff}
              disabled={!live || !micOn}
              aria-label="Mute and end the call"
              title="Mute"
            >
              {micOn ? Ico.mic(16) : Ico.micOff(16)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
