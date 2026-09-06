// File fallback when the OS secure store fails, typically on Linux without a Secret Service
// provider.
// The derived encryption key only obscures plaintext; file mode 0600 provides the actual
// protection.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { coworkHome } from './cowork-home';

const FALLBACK_FILE = path.join(coworkHome(), 'keychain-fallback.json');

// JSON-encode the service/account pair to avoid delimiter collisions.
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
