import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { coworkHome, coworkEnvPath } from './cowork-home';

// Persistence for the Keycloak refresh token. Two stores:
//   • keychain (opt-in): safeStorage-encrypted blob in Electron userData.
//     Most secure, but on unsigned/ad-hoc macOS builds the keychain ACL
//     doesn't persist (no stable Developer-ID signature), so macOS prompts
//     for access on every launch.
//   • file (default): plaintext at ~/.cowork/refresh-token (0600). No
//     prompts; sits next to the already-plaintext ~/.cowork/.env creds.
// Governed by COWORK_KEYCHAIN=true in ~/.cowork/.env (absent/false → file).
const KEYCHAIN_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');
function plainTokenFile(): string { return path.join(coworkHome(), 'refresh-token'); }

let _accessToken: string | null = null;
let _expiresAt = 0; // epoch ms

// The plaintext-file default + opt-in toggle is a macOS-only concession to
// the keychain access prompts (which recur on unsigned/ad-hoc builds). On
// Windows/Linux, safeStorage (DPAPI / libsecret) doesn't prompt, so we
// always use it there and never downgrade those platforms to plaintext.
const IS_MAC = process.platform === 'darwin';

// Whether the COWORK_KEYCHAIN opt-in flag is set in ~/.cowork/.env.
function keychainFlagSet(): boolean {
  try {
    const env = fs.readFileSync(coworkEnvPath(), 'utf-8');
    return /^\s*COWORK_KEYCHAIN\s*=\s*true\s*$/im.test(env);
  } catch {
    return false;
  }
}

// Resolve the effective store: keychain on non-mac always; on mac only when
// the user opted in via the flag (default: plaintext file, no prompts).
function useKeychain(): boolean {
  if (!IS_MAC) return true;
  return keychainFlagSet();
}

function writeKeychain(refreshToken: string): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.writeFileSync(KEYCHAIN_FILE, safeStorage.encryptString(refreshToken));
    return true;
  } catch { return false; }
}
function readKeychain(): string | null {
  try {
    if (!fs.existsSync(KEYCHAIN_FILE) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(KEYCHAIN_FILE));
  } catch { return null; }
}
function writePlain(refreshToken: string): boolean {
  try {
    fs.mkdirSync(coworkHome(), { recursive: true });
    fs.writeFileSync(plainTokenFile(), refreshToken, { mode: 0o600 });
    return true;
  } catch { return false; }
}
function readPlain(): string | null {
  try {
    if (!fs.existsSync(plainTokenFile())) return null;
    return fs.readFileSync(plainTokenFile(), 'utf-8').trim() || null;
  } catch { return null; }
}
function deleteKeychain(): void { try { fs.unlinkSync(KEYCHAIN_FILE); } catch { /* absent */ } }
function deletePlain(): void { try { fs.unlinkSync(plainTokenFile()); } catch { /* absent */ } }

function persistRefreshToken(refreshToken: string): void {
  if (useKeychain() && writeKeychain(refreshToken)) {
    deletePlain();
    return;
  }
  // Default, or keychain unavailable: store as a file so login still persists.
  writePlain(refreshToken);
  deleteKeychain();
}

export function saveTokens(accessToken: string, expiresInSeconds: number, refreshToken: string): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresInSeconds * 1000;
  if (refreshToken) persistRefreshToken(refreshToken);
}

export function getAccessToken(): string | null { return _accessToken; }

export function isAccessTokenExpired(): boolean {
  return Date.now() > _expiresAt - 60_000; // 60s buffer
}

export function getRefreshToken(): string | null {
  // Read the active store first; fall back to the other so a token written
  // under the previous setting still resolves. In file (default) mode we
  // only touch the keychain when the file is missing — that keeps the
  // no-prompt promise for the common path.
  if (useKeychain()) return readKeychain() ?? readPlain();
  return readPlain() ?? readKeychain();
}

export function clearTokens(): void {
  _accessToken = null;
  _expiresAt = 0;
  deletePlain();
  deleteKeychain();
}

// Move the stored refresh token to the store matching a just-changed
// COWORK_KEYCHAIN setting. Call AFTER writing the new flag. Best-effort;
// switching keychain OFF reads (decrypts) the keychain blob once to move it.
export function migrateRefreshTokenStore(toKeychain: boolean): void {
  const token = getRefreshToken();
  if (!token) return;
  if (toKeychain) {
    if (writeKeychain(token)) deletePlain();
  } else {
    if (writePlain(token)) deleteKeychain();
  }
}
