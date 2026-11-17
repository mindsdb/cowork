// `<ScheduleNotifyMenu>` — which scheduled-run endings this device notifies
// about. Turning one on asks the browser for permission, from the click, if
// the user has not answered yet.

import { Bell, Check } from 'lucide-react';
import { Button } from '../ui';
import { Icon } from '../ui/Icon';
import Menu from '../ui/Menu';
import { askToNotify } from '../../hooks/useAutoPauseNotifications';
import { useTranslation } from '../../../lib/i18n';

const CHECK = <Icon of={Check} size={14} />;
// Unchecked items keep the check's width so labels line up.
const NO_CHECK = <span className="inline-block w-[14px]" aria-hidden="true" />;

export default function ScheduleNotifyMenu({ prefs, onChange }) {
  const { t } = useTranslation('projects');
  const item = (key) => ({
    id: key,
    label: t(`scheduleNotifyMenu.${key}`),
    icon: prefs[key] ? CHECK : NO_CHECK,
    keepOpen: true,
    aria: { role: 'menuitemcheckbox', 'aria-checked': !!prefs[key] },
    onClick: () => {
      if (!prefs[key]) askToNotify();
      onChange({ [key]: !prefs[key] });
    },
  });
  return (
    <Menu
      ariaLabel={t('scheduleNotifyMenu.label')}
      width={220}
      align="end"
      items={[{ heading: t('scheduleNotifyMenu.heading') }, item('failed'), item('succeeded')]}
      trigger={(
        <Button variant="subtle">
          <Icon of={Bell} size={14} /> {t('scheduleNotifyMenu.label')}
        </Button>
      )}
    />
  );
}
