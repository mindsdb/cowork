import i18n from '../../lib/i18n';
import type { PermissionMode } from './api';


interface PermissionOption {
  value: PermissionMode;
  label: string;
  title: string;
}

const PERMISSION_KEYS: Array<[PermissionMode, string]> = [
  ['read_only', 'readOnly'],
  ['supervised', 'supervised'],
  ['workspace', 'workspace'],
  ['full_access', 'fullAccess'],
];

// The label and title are read when shown, so they follow the current language.
function translatedOption(value: PermissionMode, key: string): PermissionOption {
  return {
    value,
    get label() { return i18n.t(`permissions.${key}.label`, { ns: 'code' }); },
    get title() { return i18n.t(`permissions.${key}.title`, { ns: 'code' }); },
  };
}

const PERMISSION_OPTIONS: PermissionOption[] = PERMISSION_KEYS.map(([value, key]) => translatedOption(value, key));

/**
 * The modes a picker offers, as a fresh copy with the labels in the current
 * language (a new array, so pickers re-render on a switch).
 *
 * Read only is not offered for new work: Plan mode covers looking without
 * changing. A project or task saved with it keeps it, so it stays in that
 * picker until the person chooses something else.
 */
export function permissionOptions(current?: PermissionMode): PermissionOption[] {
  return PERMISSION_OPTIONS
    .filter((option) => option.value !== 'read_only' || current === 'read_only')
    .map((option) => ({ value: option.value, label: option.label, title: option.title }));
}

export const PERMISSION_LABELS = Object.defineProperties(
  {},
  Object.fromEntries(PERMISSION_OPTIONS.map((option) => [
    option.value,
    { enumerable: true, get: () => option.label },
  ])),
) as Record<PermissionMode, string>;

export function isPermissionMode(value: string): value is PermissionMode {
  return PERMISSION_OPTIONS.some((option) => option.value === value);
}
