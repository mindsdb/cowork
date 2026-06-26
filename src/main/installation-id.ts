// Stable, anonymous per-device identifier for the Cowork desktop app.
//
// ENG-440: MindsHub API keys are minted per device (`hub:anton:<id>`) so
// signing into the same account on a second device no longer revokes the
// first device's key. That requires an id that is stable across restarts
// and re-onboards on the same machine. We persist a random value under the
// Cowork home (`~/.cowork/.installation_id`) and read it back on later
// runs; the value is opaque and carries no PII.
//
// Deliberately self-contained rather than reusing Anton's
// `get_installation_id()` (anton/analytics.py): that fingerprint is
// MAC-derived on desktop and only writes a file in the Docker fallback, so
// there's nothing for the Electron process to read. The key name only
// needs to be device-stable, not identical to Anton's analytics aid.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { coworkHome } from './cowork-home';

function installationIdPath(): string {
  return path.join(coworkHome(), '.installation_id');
}

let _cached: string | null = null;

// Read-or-create the per-device id. 16 hex chars (64 bits), matching the
// format Anton uses for analytics. If persistence fails (e.g. ~/.cowork is
// not writable) we still return a usable id for this process — the only
// degradation is that the next launch mints a fresh device key, leaving the
// old one orphaned rather than revoked, which is acceptable for ENG-440.
export function getInstallationId(): string {
  if (_cached) return _cached;

  const idPath = installationIdPath();
  try {
    if (fs.existsSync(idPath)) {
      const existing = fs.readFileSync(idPath, 'utf-8').trim().slice(0, 16);
      if (existing) {
        _cached = existing;
        return _cached;
      }
    }
  } catch {
    // fall through and (re)create
  }

  const id = crypto.randomBytes(8).toString('hex');
  try {
    fs.mkdirSync(coworkHome(), { recursive: true });
    fs.writeFileSync(idPath, id + '\n', 'utf-8');
  } catch {
    // best-effort persistence; keep the id stable for at least this process
  }
  _cached = id;
  return _cached;
}
