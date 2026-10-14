import Select from '../components/ui/Select';
import Tooltip from '../components/ui/Tooltip';
import type { PermissionMode } from './api';
import { isPermissionMode, PERMISSION_OPTIONS } from './permissions';


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
          options={PERMISSION_OPTIONS}
          variant="unstyled"
          size="sm"
          ariaLabel="Coding permissions"
          menuLabel="Permissions"
          disabled={disabled}
          className="meta-pill code-composer-picker code-permission-picker"
        />
      </span>
    </Tooltip>
  );
}
