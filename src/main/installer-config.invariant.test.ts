import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// NSIS allowToChangeInstallationDirectory skips keep-shortcuts during manual upgrades, destroying
// taskbar pins.
// Existing InstallLocation is reused without the chooser; /D remains an override.
// Hand-parse config rather than rely on transitive js-yaml.
const yml = readFileSync(
  fileURLToPath(new URL('../../electron-builder.yml', import.meta.url)),
  'utf8',
);

// The top-level `nsis:` block: everything indented (or blank) until the next
// top-level key.
const nsisBlock = /^nsis:\n((?:(?:[ \t].*)?\n)*)/m.exec(yml)?.[1] ?? '';

const nsisFlag = (key: string): string | null => {
  const match = new RegExp(`^[ \\t]+${key}:[ \\t]*(\\S+)`, 'm').exec(nsisBlock);
  return match ? match[1] : null;
};

describe('NSIS installer config preserves taskbar pins (ENG-1367)', () => {
  // Guards against the block regex silently matching nothing (vacuous pass).
  it('finds the nsis block', () => {
    expect(nsisBlock).not.toBe('');
  });

  it('keeps the directory chooser off so manual upgrades pass --keep-shortcuts', () => {
    expect(nsisFlag('allowToChangeInstallationDirectory')).toBe('false');
  });

  it('stays a per-user assisted installer (electron-updater silent-update contract)', () => {
    expect(nsisFlag('oneClick')).toBe('false');
    expect(nsisFlag('perMachine')).toBe('false');
  });
});
