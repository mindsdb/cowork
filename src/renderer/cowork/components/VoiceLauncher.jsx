import Ico from './Icons';
import { Tooltip } from './ui';
import './voice-call.css';

/* The voice call's button: a round one where the call's card appears (in
   the sidebar above its footer, or in that corner when the sidebar is
   folded), so the call starts where it will show. `call` is the shortcut
   App builds: {label, onClick, live, disabled}. Hidden while a call's card
   is showing; while a call fades out and still listens, it brings it back. */
export default function VoiceLauncher({ call, docked = false }) {
  if (!call || (call.live && !call.onClick)) return null;
  return (
    <div className={`voice-launcher${docked ? ' voice-launcher--docked' : ''}`}>
      <Tooltip content={call.label}>
        <button
          type="button"
          className={`voice-launcher__button${call.live ? ' is-live' : ''}`}
          onClick={call.disabled ? undefined : call.onClick}
          aria-label={call.label}
          aria-disabled={call.disabled || undefined}
        >
          {Ico.voice(20)}
        </button>
      </Tooltip>
    </div>
  );
}
