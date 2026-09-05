import { safeStorage, app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { coworkHome } from './cowork-home';
import { IPC } from '../shared/ipc-channels';

// Persist refresh tokens with safeStorage on Windows/Linux. macOS uses the file fallback
// to avoid per-build Keychain access prompts; its actual protection is owner-only permissions.

const IS_MAC = process.platform === 'darwin';
const KEYCHAIN_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');
const ENCRYPTED_FILE = path.join(coworkHome(), 'refresh-token.dat');

// ── Mac file-based encryption ───────────────────────────────────────

// The path-derived key only obscures plaintext; mode 0600 provides the security boundary.
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

function writeEncryptedFile(refreshToken: string): void {
  fs.mkdirSync(coworkHome(), { recursive: true });
  fs.writeFileSync(ENCRYPTED_FILE, encryptToken(refreshToken), { mode: 0o600 });
}

// ENOENT is the expected case (nothing to remove); anything else means a
// stale token may survive and shadow a rotated one later — say so.
function removeStaleStore(file: string): void {
  try { fs.unlinkSync(file); } catch (e: any) {
    if (e?.code !== 'ENOENT') console.warn(`[token-store] could not remove stale token store ${file}`, e);
  }
}

function writeToken(refreshToken: string): void {
  if (IS_MAC) {
    writeEncryptedFile(refreshToken);
    // Pre-file-store builds kept the token in safeStorage under userData.
    // Inert on macOS reads, but don't leave stale credential material behind.
    removeStaleStore(KEYCHAIN_FILE);
    return;
  }
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(KEYCHAIN_FILE, safeStorage.encryptString(refreshToken));
    // Keep the fallback copy current so a secure-store outage cannot restore a stale rotated token.
    try { writeEncryptedFile(refreshToken); } catch (e) {
      console.warn('[token-store] could not refresh encrypted-file copy', e);
    }
    return;
  }
  // If safeStorage fails, persist to the encrypted-file fallback so the session survives restart.
  console.warn('[token-store] safeStorage unavailable — using encrypted-file fallback');
  writeEncryptedFile(refreshToken);
  // Do not let a previously stored DPAPI token take precedence if
  // safeStorage recovers after the refresh token has rotated.
  removeStaleStore(KEYCHAIN_FILE);
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
let _tokenStoreVersion = 0;

// Broadcast at the token-store boundary so login, refresh, logout and session death update every
// renderer.
function broadcastAuthChanged(authenticated: boolean): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.MINDSHUB_AUTH_CHANGED, { authenticated });
    }
  } catch { /* no windows yet / test env */ }
}

export function saveTokens(accessToken: string, expiresInSeconds: number, refreshToken: string): void {
  _tokenStoreVersion += 1;
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

// Lets async refreshes detect that login/logout replaced their starting
// session while the network request was in flight.
export function getTokenStoreVersion(): number { return _tokenStoreVersion; }

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
  _tokenStoreVersion += 1;
  _accessToken = null;
  _expiresAt = 0;
  deleteTokenFiles();
  broadcastAuthChanged(false);
}

// Legacy preference hook; platform-specific storage no longer migrates when toggled.
export function migrateRefreshTokenStore(_toKeychain: boolean): void {}
