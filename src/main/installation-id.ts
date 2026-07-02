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

// 16 lowercase hex chars (what crypto.randomBytes(8) produces). Used to
// reject a clobbered/non-hex file rather than silently adopting its first
// 16 bytes as a "valid" id, which would feed a garbage key name downstream.
const HEX_ID = /^[0-9a-f]{16}$/;

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
      if (HEX_ID.test(existing)) {
        _cached = existing;
        return _cached;
      }
      // Non-hex/corrupt contents: fall through and regenerate, overwriting it.
    }
  } catch {
    // fall through and (re)create
  }

  const id = crypto.randomBytes(8).toString('hex');
  try {
    // Owner-only perms, matching the server owner token (ENG-439 review): the
    // id lives alongside secrets under ~/.cowork, so keep it readable only by
    // this OS user (least-privilege hygiene — it's an opaque device id, not a
    // credential). chmod pins the mode past umask / a pre-existing file.
    fs.mkdirSync(coworkHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(idPath, id + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(idPath, 0o600);
  } catch (err) {
    // best-effort persistence; keep the id stable for at least this process.
    // Warn so the orphaned-key-per-launch degradation is diagnosable in the
    // field instead of silent.
    console.warn('[installation-id] could not persist device id to %s', idPath, err);
  }
  _cached = id;
  return _cached;
}
