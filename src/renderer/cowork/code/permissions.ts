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

export const PERMISSION_OPTIONS: PermissionOption[] = PERMISSION_KEYS.map(([value, key]) => translatedOption(value, key));

/** A fresh copy with the labels in the current language (a new array, so pickers re-render on a switch). */
export function permissionOptions(): PermissionOption[] {
  return PERMISSION_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.title }));
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
