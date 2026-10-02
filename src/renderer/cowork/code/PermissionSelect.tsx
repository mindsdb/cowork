import Select from '../components/ui/Select';
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
  return (
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
      // A disabled trigger fires no hover events, so ui/Tooltip can't open;
      // the native title is the only way to explain why it's locked.
      title={disabled ? disabledReason : undefined}
      className="meta-pill code-composer-picker code-permission-picker"
    />
  );
}
