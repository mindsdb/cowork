import * as fs from 'fs';
import { coworkHome, coworkEnvPath, readEnvFile } from './cowork-home';
import { writeEnvFileAtomic } from './minds-auth';

// Setup wizard's "Install backend server" checkbox, unchecked — persisted so
// the choice survives past this one run. checkInstallStatus() (installer.ts)
// reads this to report "installed" for routing purposes even though
// cowork-server was deliberately never installed, so resolveBootTarget /
// handleAuthComplete don't loop back into the installer on every future boot.
// Exported for custom-server.ts: clearing the custom server URL also clears
// this, so "revert to the local server" can route back into the installer.
export const SKIP_BACKEND_ENV_KEY = 'COWORK_SKIP_BACKEND_INSTALL';

export function skipBackendInstallRequested(): boolean {
  return (readEnvFile()[SKIP_BACKEND_ENV_KEY] || '').trim().toLowerCase() === 'true';
}

export async function persistSkipBackendInstall(): Promise<void> {
  const homeDir = coworkHome();
  if (!fs.existsSync(homeDir)) fs.mkdirSync(homeDir, { recursive: true });
  const envPath = coworkEnvPath();
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8') : '';
  const lines = existing.split('\n').filter((l) => !l.startsWith(`${SKIP_BACKEND_ENV_KEY}=`));
  lines.push(`${SKIP_BACKEND_ENV_KEY}=true`);
  const out = lines.filter((l) => l.length > 0).join('\n') + '\n';
  await writeEnvFileAtomic(envPath, out);
}
