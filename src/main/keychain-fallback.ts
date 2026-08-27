// Fallback store for keychain-service.ts, used only when keytar itself
// throws - most commonly on Linux desktops/distros that don't ship or
// auto-start a Secret Service provider (gnome-keyring, kwalletd) reachable
// over D-Bus: minimal window managers, headless boxes, containers. macOS
// Keychain and Windows Credential Manager are always present, so this path
// is not expected to matter there.
//
// Same risk profile already accepted for the MindsHub login token in
// token-store.ts (ENG-761): the derived key is NOT real cryptographic
// protection - the file's 0600 permission bit is. Silent by design, same as
// that precedent (a console.warn, not a user-facing notice); a follow-up
// tracks surfacing degraded-mode status in the UI.
//
// Single JSON file rather than one file per entry: keychain-service.ts's
// callers already treat their keys as one small, related set (per-connector
// refresh tokens, plus the 15 static ENG-1241 credentials + a generation
// marker), so one file avoids directory/many-file edge cases for a store
// this small.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { coworkHome } from './cowork-home';

const FALLBACK_FILE = path.join(coworkHome(), 'keychain-fallback.json');

// JSON-encode the pair rather than joining on a separator, so no choice of
// separator character has to be proven absent from every service/account
// value that will ever exist.
function entryKey(service: string, account: string): string {
  return JSON.stringify([service, account]);
}

function deriveKey(): Buffer {
  const seed = `mindshub-cowork-keychain-fallback:${app.getPath('userData')}`;
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function decrypt(value: string): string {
  const data = Buffer.from(value, 'base64');
  const key = deriveKey();
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function readStore(): Record<string, string> {
  let raw: string;
  try {
    raw = fs.readFileSync(FALLBACK_FILE, 'utf8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      console.warn('[keychain-fallback] could not read fallback store, treating as empty:', err);
    }
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    console.warn('[keychain-fallback] fallback store is not valid JSON, treating as empty:', err);
    return {};
  }
}

function writeStore(store: Record<string, string>): void {
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(store), { mode: 0o600 });
}

export function getFallbackPassword(service: string, account: string): string | null {
  const value = readStore()[entryKey(service, account)];
  if (value === undefined) return null;
  try {
    return decrypt(value);
  } catch (err) {
    console.warn(`[keychain-fallback] could not decrypt entry for ${service}:${account}:`, err);
    return null;
  }
}

export function setFallbackPassword(service: string, account: string, value: string): void {
  const store = readStore();
  store[entryKey(service, account)] = encrypt(value);
  writeStore(store);
}

export function deleteFallbackPassword(service: string, account: string): void {
  const store = readStore();
  const key = entryKey(service, account);
  if (!(key in store)) return;
  delete store[key];
  writeStore(store);
}
