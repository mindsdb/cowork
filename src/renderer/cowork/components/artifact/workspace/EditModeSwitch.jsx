// Live edit's Navigate / Edit switch (ENG-4383), a segmented control in the
// Live edit panel. Navigate leaves the page working (click through slides,
// open tabs, follow buttons) without leaving Live edit or saving; Edit holds
// the page still and makes any text, buttons' and links' included, editable
// on click.

import Ico from '../../Icons';
import { ModeSwitch } from '../ModeSwitch';
import { useTranslation } from '../../../../lib/i18n';

/** `mode`: 'navigate' | 'edit'. */
export function EditModeSwitch({ mode, onChange }) {
  const { t } = useTranslation('artifacts');
  return (
    <ModeSwitch
      ariaLabel={t('htmlEditor.mode.ariaLabel')}
      className="artifact-edit-mode-switch"
      floating={false}
      value={mode}
      onChange={onChange}
      options={[
        { value: 'navigate', icon: Ico.pointer(14), label: t('htmlEditor.mode.navigate'), hint: t('htmlEditor.mode.navigateHint') },
        { value: 'edit', icon: Ico.textCursor(14), label: t('htmlEditor.mode.edit'), hint: t('htmlEditor.mode.editHint') },
      ]}
    />
  );
}

export default EditModeSwitch;
