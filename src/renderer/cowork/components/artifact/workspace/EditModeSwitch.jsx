// Live edit's Navigate / Edit switch (ENG-4383): a pill floating at the
// bottom centre of the canvas, the comments toolbar's twin. Navigate leaves
// the page working (click through slides, open tabs, follow buttons) without
// leaving Live edit or saving; Edit holds the page still and makes any text,
// buttons' and links' included, editable on click.

import { Toolbar } from '@base-ui/react/toolbar';
import Ico from '../../Icons';
import { Tooltip } from '../../ui';
import { useTranslation } from '../../../../lib/i18n';

// The comments toolbar's glass (CommentsToolbar.jsx).
const SHADOW =
  '0 0 0 0.5px rgba(0,0,0,0.12),0 2px 2px -1px rgba(0,0,0,0.04),'
  + '0 4px 4px -2px rgba(0,0,0,0.04),'
  + 'inset 0 0 0 0.5px rgba(255,255,255,0.24),'
  + 'inset 0 -0.5px 0 rgba(255,255,255,0.16),'
  + 'inset 0 0.5px 0 rgba(255,255,255,0.24)';

function ModeButton({ on, icon, label, hint, onClick }) {
  return (
    <Tooltip content={hint}>
      <Toolbar.Button
        aria-pressed={on}
        onClick={onClick}
        className={[
          'h-[24px] px-[10px] flex items-center gap-[6px] rounded-full border-0 cursor-pointer',
          'text-[12px] font-medium whitespace-nowrap font-[inherit]',
          'transition-[background,color] duration-hover',
          on ? 'bg-ink text-surface' : 'bg-transparent text-ink hover:bg-surface-2',
        ].join(' ')}
      >
        {icon}
        <span>{label}</span>
      </Toolbar.Button>
    </Tooltip>
  );
}

/** `mode`: 'navigate' | 'edit'. */
export function EditModeSwitch({ mode, onChange }) {
  const { t } = useTranslation('artifacts');
  return (
    <Toolbar.Root
      aria-label={t('htmlEditor.mode.ariaLabel')}
      className="artifact-edit-mode-switch absolute left-1/2 bottom-[24px] z-20 h-[32px]
        flex items-center gap-[2px] px-1 rounded-[46px] motion-reduce:!animate-none"
      style={{
        transform: 'translateX(-50%)',
        background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
        backdropFilter: 'blur(5.6px)',
        WebkitBackdropFilter: 'blur(5.6px)',
        boxShadow: SHADOW,
        fontFamily: 'var(--font-body)',
        animation: 'cw-act-bar-in var(--dur-layout) var(--ease-out)',
      }}
    >
      <ModeButton
        on={mode === 'navigate'}
        icon={Ico.pointer(14)}
        label={t('htmlEditor.mode.navigate')}
        hint={t('htmlEditor.mode.navigateHint')}
        onClick={() => onChange('navigate')}
      />
      <ModeButton
        on={mode === 'edit'}
        icon={Ico.textCursor(14)}
        label={t('htmlEditor.mode.edit')}
        hint={t('htmlEditor.mode.editHint')}
        onClick={() => onChange('edit')}
      />
    </Toolbar.Root>
  );
}

export default EditModeSwitch;
