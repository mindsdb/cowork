// Single source of truth for the global Cowork config home.
//
// History: the desktop app, cowork-server, and the agent used to scatter
// global config across `~/.anton` (the `.env` credentials + a state.json)
// AND `~/.cowork` (db, projects, files, …). Everything but the `.env` and
// state.json already lived under `~/.cowork`, so we consolidate the
// stragglers here and migrate them on first run. Per-project agent data
// stays workspace-relative (`<project>/.anton/…`) and is unrelated.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const LEGACY_HOME = path.join(os.homedir(), '.anton');

export function coworkHome(): string {
  return path.join(os.homedir(), '.cowork');
}

export function coworkEnvPath(): string {
  return path.join(coworkHome(), '.env');
}

export function coworkStatePath(): string {
  return path.join(coworkHome(), 'state.json');
}

// Copy the legacy `~/.anton/.env` and `~/.anton/cowork/state.json` to the
// new `~/.cowork` location when they don't exist there yet, so existing
// installs keep their credentials + provider state. Idempotent and
// best-effort — never block startup on it.
export function migrateLegacyHome(): void {
  try {
    const home = coworkHome();
    if (!fs.existsSync(home)) fs.mkdirSync(home, { recursive: true });

    const newEnv = coworkEnvPath();
    const oldEnv = path.join(LEGACY_HOME, '.env');
    if (!fs.existsSync(newEnv) && fs.existsSync(oldEnv)) {
      fs.copyFileSync(oldEnv, newEnv);
    }

    const newState = coworkStatePath();
    const oldState = path.join(LEGACY_HOME, 'cowork', 'state.json');
    if (!fs.existsSync(newState) && fs.existsSync(oldState)) {
      fs.copyFileSync(oldState, newState);
    }
  } catch {
    // best-effort migration; a failure here must not stop the app.
  }
}
