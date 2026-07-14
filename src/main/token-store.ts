import { safeStorage, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { coworkHome } from './cowork-home';
import { IPC } from '../shared/ipc-channels';

// Persistence for the Keycloak refresh token.
//
// On macOS, Electron's safeStorage (Keychain) binds ACLs to the binary's
// CDHash, which changes on every build — even with the same Developer ID
// cert — causing a keychain-access prompt on every app launch. We use
// AES-256-CBC file-based storage instead (encrypted, 0600 permissions).
//
// On Windows/Linux, safeStorage (DPAPI / libsecret) doesn't prompt, so
// we keep using it there.

const IS_MAC = process.platform === 'darwin';
const KEYCHAIN_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');
const ENCRYPTED_FILE = path.join(coworkHome(), 'refresh-token.dat');

// ── Mac file-based encryption ───────────────────────────────────────

// Machine-local obfuscation key derived from a stable per-user path.
// This is NOT cryptographic security — it prevents casual plaintext
// exposure on disk. The real protection is file permissions (0600).
function deriveKey(): Buffer {
  const seed = `mindshub-cowork:${app.getPath('userData')}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encryptToken(plaintext: string): Buffer {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]);
}

function decryptToken(data: Buffer): string {
  const key = deriveKey();
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// ── Read / write per platform ───────────────────────────────────────

function writeToken(refreshToken: string): void {
  if (IS_MAC) {
    fs.mkdirSync(coworkHome(), { recursive: true });
    fs.writeFileSync(ENCRYPTED_FILE, encryptToken(refreshToken), { mode: 0o600 });
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(KEYCHAIN_FILE, safeStorage.encryptString(refreshToken));
    return;
  }
  // safeStorage unavailable (DPAPI/libsecret failure). Previously this
  // silently persisted NOTHING — the user looked signed in until the
  // next launch, then showed up as unauthenticated (ENG-761). Fall back
  // to the same encrypted file macOS uses so the session survives.
  console.warn('[token-store] safeStorage unavailable — using encrypted-file fallback');
  fs.mkdirSync(coworkHome(), { recursive: true });
  fs.writeFileSync(ENCRYPTED_FILE, encryptToken(refreshToken), { mode: 0o600 });
}

function readToken(): string | null {
  // Mac: encrypted file
  if (IS_MAC) {
    if (!fs.existsSync(ENCRYPTED_FILE)) return null;
    return decryptToken(fs.readFileSync(ENCRYPTED_FILE));
  }
  // Windows/Linux: safeStorage, then the encrypted-file fallback written
  // when safeStorage was unavailable at save time.
  if (fs.existsSync(KEYCHAIN_FILE) && safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(fs.readFileSync(KEYCHAIN_FILE));
  }
  if (fs.existsSync(ENCRYPTED_FILE)) return decryptToken(fs.readFileSync(ENCRYPTED_FILE));
  return null;
}

function deleteTokenFiles(): void {
  try { fs.unlinkSync(ENCRYPTED_FILE); } catch {}
  try { fs.unlinkSync(KEYCHAIN_FILE); } catch {}
}

// ── Public API ──────────────────────────────────────────────────────

let _accessToken: string | null = null;
let _expiresAt = 0; // epoch ms

// Push the new auth state to every renderer. token-store is the single
// choke point every MindsHub auth transition flows through (login,
// silent refresh, logout, invalid-grant clear), so broadcasting here —
// rather than at each call site — is what guarantees the UI can never
// silently disagree with the main process again (ENG-761). Defensive:
// callable before any window exists and under test mocks.
function broadcastAuthChanged(authenticated: boolean): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.MINDSHUB_AUTH_CHANGED, { authenticated });
    }
  } catch { /* no windows yet / test env */ }
}

export function saveTokens(accessToken: string, expiresInSeconds: number, refreshToken: string): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresInSeconds * 1000;
  if (refreshToken) {
    try { writeToken(refreshToken); } catch (e) {
      console.warn('[token-store] failed to persist refresh token', e);
    }
  }
  broadcastAuthChanged(true);
}

export function getAccessToken(): string | null { return _accessToken; }

export function isAccessTokenExpired(): boolean {
  return Date.now() > _expiresAt - 60_000; // 60s buffer
}

export function getRefreshToken(): string | null {
  try {
    return readToken();
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  _accessToken = null;
  _expiresAt = 0;
  deleteTokenFiles();
  broadcastAuthChanged(false);
}

// Stub — the keychain toggle in settings calls this, but on macOS we no
// longer use the keychain so there is nothing to migrate. On Windows/Linux
// there is only one store (safeStorage) so migration is also a no-op.
export function migrateRefreshTokenStore(_toKeychain: boolean): void {}
