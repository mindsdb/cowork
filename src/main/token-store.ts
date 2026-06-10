import { safeStorage, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_FILE = path.join(app.getPath('userData'), 'mindshub-refresh.bin');

let _accessToken: string | null = null;
let _expiresAt: number = 0; // epoch ms

export function saveTokens(accessToken: string, expiresInSeconds: number, refreshToken: string): void {
  _accessToken = accessToken;
  _expiresAt = Date.now() + expiresInSeconds * 1000;
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(TOKEN_FILE, safeStorage.encryptString(refreshToken));
  }
}

export function getAccessToken(): string | null { return _accessToken; }

export function isAccessTokenExpired(): boolean {
  return Date.now() > _expiresAt - 60_000; // 60s buffer
}

export function getRefreshToken(): string | null {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(TOKEN_FILE));
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  _accessToken = null;
  _expiresAt = 0;
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
}
