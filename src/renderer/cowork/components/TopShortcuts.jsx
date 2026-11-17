import Ico from './Icons';
import { Tooltip } from './ui';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useTranslation } from '../../lib/i18n';

/* The browser icon at the top right, beside the panel toggle in a task and
   in the header elsewhere; on a phone, in the top bar instead.
   `onShowBrowser` opens the browser pane. (A voice call starts from its own
   round button, VoiceLauncher.) */
export default function TopShortcuts({ onShowBrowser = null, className = '', style }) {
  // On a phone it lives in the top bar (MobileShell), beside the theme toggle.
  const { isMobile } = useBreakpoint();
  const { t } = useTranslation('shell');
  if (isMobile || !onShowBrowser) return null;
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
    </div>
  );
}
