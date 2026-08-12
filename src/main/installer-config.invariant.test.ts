import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';

// Regression guard for ENG-1367: Windows taskbar pins are destroyed on manual
// installer upgrades whenever the assisted installer is built with
// allowToChangeInstallationDirectory. With that option compiled in, a
// non-auto-update run skips the --keep-shortcuts handoff to the previous
// version's uninstaller, which then unregisters the AppUserModelID and deletes
// the Start-Menu shortcut the pin references. Upgrades reuse the registry
// InstallLocation regardless, so dropping the chooser does not break
// custom-directory installs (the /D installer switch remains as an override).
const config = load(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../electron-builder.yml'),
    'utf8',
  ),
) as { nsis?: Record<string, unknown> };

describe('NSIS installer config preserves taskbar pins (ENG-1367)', () => {
  it('keeps the directory chooser off so manual upgrades pass --keep-shortcuts', () => {
    expect(config.nsis?.allowToChangeInstallationDirectory).toBe(false);
  });

  it('stays a per-user assisted installer (electron-updater silent-update contract)', () => {
    expect(config.nsis?.oneClick).toBe(false);
    expect(config.nsis?.perMachine).toBe(false);
  });
});
