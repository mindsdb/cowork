import Select from '../components/ui/Select';
import type { PermissionMode } from './api';
import { isPermissionMode, PERMISSION_OPTIONS } from './permissions';


export function PermissionSelect({
  value,
  onValueChange,
  disabled = false,
}: {
  value: PermissionMode;
  onValueChange: (value: PermissionMode) => void;
  disabled?: boolean;
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
      disabled={disabled}
      className="meta-pill code-composer-picker code-permission-picker"
    />
  );
}
