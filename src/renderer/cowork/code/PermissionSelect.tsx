import Select from '../components/ui/Select';
import Tooltip from '../components/ui/Tooltip';
import type { PermissionMode } from './api';
import { isPermissionMode, permissionOptions } from './permissions';
import { useTranslation } from '../../lib/i18n';


export function PermissionSelect({
  value,
  onValueChange,
  disabled = false,
  disabledReason,
}: {
  value: PermissionMode;
  onValueChange: (value: PermissionMode) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const { t } = useTranslation('code');
  // A disabled trigger takes no pointer events, so the wrapper carries the
  // hover that explains why it's locked.
  return (
    <Tooltip content={disabled ? disabledReason : undefined}>
      <span className="code-permission-picker__hint">
        <Select
          value={value}
          onValueChange={(next) => {
            if (isPermissionMode(next)) onValueChange(next);
          }}
          options={permissionOptions(value)}
          variant="unstyled"
          size="sm"
          ariaLabel={t('permissions.ariaLabel')}
          menuLabel={t('permissions.menuLabel')}
          disabled={disabled}
          className="meta-pill code-composer-picker code-permission-picker"
        />
      </span>
    </Tooltip>
  );
}
