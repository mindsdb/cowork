import { beforeEach, describe, expect, it } from 'vitest';
import { getTerminalShellPreference, setTerminalShellPreference } from './terminalPreferences';

describe('terminal shell preference', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults invalid or absent values to automatic', () => {
    expect(getTerminalShellPreference()).toBe('auto');
    window.localStorage.setItem('mindshub.code.terminalShell', 'tcsh');
    expect(getTerminalShellPreference()).toBe('auto');
  });

  it('persists a valid device-local choice', () => {
    setTerminalShellPreference('zsh');
    expect(getTerminalShellPreference()).toBe('zsh');
  });
});
