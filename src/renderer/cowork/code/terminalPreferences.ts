import type { TerminalShellPreference } from './api';

const STORAGE_KEY = 'mindshub.code.terminalShell';
const VALID_PREFERENCES = new Set<TerminalShellPreference>([
  'auto', 'bash', 'zsh', 'fish', 'system', 'pwsh', 'powershell', 'cmd',
]);

export function getTerminalShellPreference(): TerminalShellPreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as TerminalShellPreference | null;
    return stored && VALID_PREFERENCES.has(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function setTerminalShellPreference(preference: TerminalShellPreference): void {
  if (typeof window === 'undefined' || !VALID_PREFERENCES.has(preference)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Some managed browsers disable local storage. Automatic remains a safe
    // default and the server still validates every requested shell.
  }
}
