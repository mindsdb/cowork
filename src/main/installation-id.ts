// Persist a random device ID so keys survive restarts and signing in elsewhere does not revoke this
// device.
// It is independent of Anton’s MAC-derived analytics fingerprint.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { coworkHome } from './cowork-home';

function installationIdPath(): string {
  return path.join(coworkHome(), '.installation_id');
}

let _cached: string | null = null;

// Reject corrupt IDs instead of silently accepting a truncated prefix.
const HEX_ID = /^[0-9a-f]{16}$/;

// Return a process-stable ID even when persistence fails; later launches may then leave orphaned
// device keys.
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
    }
  } catch {
  }

  const id = crypto.randomBytes(8).toString('hex');
  try {
    // Keep the ID owner-readable only, including when overwriting an existing file.
    fs.mkdirSync(coworkHome(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(idPath, id + '\n', { encoding: 'utf-8', mode: 0o600 });
    fs.chmodSync(idPath, 0o600);
  } catch (err) {
    // Warn when persistence fails: otherwise orphaned keys on each launch are hard to diagnose.
    console.warn('[installation-id] could not persist device id to %s', idPath, err);
  }
  _cached = id;
  return _cached;
}
