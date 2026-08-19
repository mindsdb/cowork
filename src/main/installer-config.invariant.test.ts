import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Regression guard for ENG-1367: Windows taskbar pins are destroyed on manual
// installer upgrades whenever the assisted installer is built with
// allowToChangeInstallationDirectory. With that option compiled in, a
// non-auto-update run skips the --keep-shortcuts handoff to the previous
// version's uninstaller, which then unregisters the AppUserModelID and deletes
// the Start-Menu shortcut the pin references. Upgrades reuse the registry
// InstallLocation regardless, so dropping the chooser does not break
// custom-directory installs (the /D installer switch remains as an override).
//
// Deliberately hand-parsed, like minds-urls.workflows.test.ts: js-yaml is only
// present transitively (via electron-builder) and could disappear on any bump,
// which is not a dependency this guard should own.
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
