import Ico from './Icons';
import { Tooltip } from './ui';
import './voice-call.css';

/* The browser and call icons at the top right, beside the panel toggle in a
   task and in the header elsewhere. `onShowBrowser` opens the browser pane;
   `call` is {label, onClick, live, disabled}: it starts a voice call, and
   while one runs it shows that (`live`). Either can be left out. */
export default function TopShortcuts({ onShowBrowser = null, call = null, className = '', style }) {
  if (!onShowBrowser && !call) return null;
  const base = 'w-7 h-7 rounded-md inline-grid place-items-center bg-transparent border-0 [-webkit-app-region:no-drag]';
  return (
    <div className={`top-shortcuts flex items-center gap-0.5 ${className}`} style={style}>
      {onShowBrowser && (
        <Tooltip content="Show browser">
          <button
            type="button"
            onClick={onShowBrowser}
            aria-label="Show browser"
            className={`${base} cursor-pointer text-ink-3 hover:text-ink hover:bg-surface-2`}
          >
            {Ico.globe(16)}
          </button>
        </Tooltip>
      )}
      {call && (
        <Tooltip content={call.label}>
          <button
            type="button"
            onClick={call.disabled ? undefined : call.onClick}
            aria-label={call.label}
            aria-disabled={call.disabled || undefined}
            className={`${base} ${
              call.live ? 'top-shortcut--live cursor-default'
                : call.disabled ? 'text-ink-3 opacity-50 cursor-default'
                  : 'cursor-pointer text-ink-3 hover:text-ink hover:bg-surface-2'
            }`}
          >
            {Ico.call(16)}
          </button>
        </Tooltip>
      )}
    </div>
  );
}
