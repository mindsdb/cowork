import type { PermissionMode } from './api';


export const PERMISSION_OPTIONS: Array<{
  value: PermissionMode;
  label: string;
  title: string;
}> = [
  {
    value: 'read_only',
    label: 'Read only',
    title: 'Inspect and explain without changing files.',
  },
  {
    value: 'supervised',
    label: 'Ask first',
    title: 'Pause before commands that need your approval.',
  },
  {
    value: 'workspace',
    label: 'Workspace auto',
    title: 'Work autonomously inside the isolated task workspace.',
  },
  {
    value: 'full_access',
    label: 'Full access',
    title: 'Work autonomously without filesystem restrictions.',
  },
];

export const PERMISSION_LABELS: Record<PermissionMode, string> = Object.fromEntries(
  PERMISSION_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PermissionMode, string>;

export function isPermissionMode(value: string): value is PermissionMode {
  return PERMISSION_OPTIONS.some((option) => option.value === value);
}
