import Ico from './Icons';
import { Tooltip } from './ui';
import { useBreakpoint } from '../hooks/useBreakpoint';
import './voice-call.css';
import { useTranslation } from '../../lib/i18n';

/* The browser and call icons at the top right, beside the panel toggle in a
   task and in the header elsewhere; on a phone, in the top bar instead. `onShowBrowser` opens the browser pane;
   `call` is {label, onClick, live, disabled}: it starts a voice call, and
   while one runs it shows that (`live`). Either can be left out. */
export default function TopShortcuts({ onShowBrowser = null, call = null, className = '', style }) {
  // On a phone they live in the top bar (MobileShell), beside the theme toggle.
  const { isMobile } = useBreakpoint();
  const { t } = useTranslation('shell');
  if (isMobile || (!onShowBrowser && !call)) return null;
  const base = 'w-7 h-7 rounded-md inline-grid place-items-center bg-transparent border-0 [-webkit-app-region:no-drag]';
  return (
    <div className={`top-shortcuts flex items-center gap-0.5 ${className}`} style={style}>
      {onShowBrowser && (
        <Tooltip content={t('shortcuts.showBrowser')}>
          <button
            type="button"
            onClick={onShowBrowser}
            aria-label={t('shortcuts.showBrowser')}
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
              call.live ? `top-shortcut--live ${call.onClick ? 'cursor-pointer' : 'cursor-default'}`
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
