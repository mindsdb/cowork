import { useEffect } from 'react';
import Ico from '../../Icons';
import { Kbd, Tooltip } from '../../ui';
import { shortcutHint } from '../../ui/ActionBar';
import { useTranslation } from '../../../../lib/i18n';

function isEditable(element) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) return !['radio', 'checkbox', 'button', 'submit'].includes(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

// Alt+↓ / Alt+↑, so plain arrows keep scrolling the focused pane. Typing
// fields keep Alt+Arrow for moving the caret by word or paragraph.
export function changeStepFromKey(event) {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return 0;
  if (isEditable(event.target)) return 0;
  if (event.key === 'ArrowDown') return 1;
  if (event.key === 'ArrowUp') return -1;
  return 0;
}

// "2 of 5 changes" with previous / next. Stepping wraps around at either end,
// like find-in-page, so the next change after the last is the first.
export function ComparisonChangeNav({ index, count, onStep }) {
  const { t } = useTranslation('artifacts');

  useEffect(() => {
    if (count < 1) return undefined;
    const onKeyDown = (event) => {
      const direction = changeStepFromKey(event);
      if (!direction || event.defaultPrevented) return;
      event.preventDefault();
      onStep(direction);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [count, onStep]);

  if (count < 1) return null;
  const buttons = [
    { direction: -1, label: t('comparison.previousChange'), icon: Ico.chevUp(14), keys: 'Alt+ArrowUp', hint: 'Alt+↑' },
    { direction: 1, label: t('comparison.nextChange'), icon: Ico.chevDown(14), keys: 'Alt+ArrowDown', hint: 'Alt+↓' },
  ];

  return (
    <div className="artifact-compare-nav" role="group" aria-label={t('comparison.changeNavigation')}>
      <span className="artifact-compare-nav-position" aria-live="polite">
        {t('comparison.changePosition', { current: index + 1, count })}
      </span>
      {buttons.map(({ direction, label, icon, keys, hint }) => (
        <Tooltip
          key={direction}
          content={<span className="inline-flex items-center gap-1.5">{label}<Kbd>{shortcutHint(hint)}</Kbd></span>}
        >
          <button
            type="button"
            aria-label={label}
            aria-keyshortcuts={keys}
            onClick={() => onStep(direction)}
          >
            {icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}

export default ComparisonChangeNav;
