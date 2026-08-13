import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { vi } from 'vitest';

// Same isolation pattern as token-store.test.ts: a real temp directory per
// test run, rather than mocking fs, so writeFileSync's mode:0o600 and
// mkdirSync's recursive behavior are exercised for real.
const h = vi.hoisted(() => {
  const base = `${process.env.TMPDIR || '/tmp'}/keychain-fallback-test-${process.pid}`;
  return { userData: `${base}/userData`, home: `${base}/cowork-home` };
});

vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./cowork-home', () => ({ coworkHome: () => h.home }));

import { getFallbackPassword, setFallbackPassword, deleteFallbackPassword } from './keychain-fallback';

const STORE_FILE = path.join(h.home, 'keychain-fallback.json');

beforeEach(() => {
  fs.rmSync(path.dirname(h.userData), { recursive: true, force: true });
  fs.mkdirSync(h.userData, { recursive: true });
  fs.mkdirSync(h.home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(h.userData), { recursive: true, force: true });
});

describe('keychain-fallback', () => {
  it('returns null for an entry that was never set', () => {
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBeNull();
  });

  it('round-trips a value through set/get', () => {
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'refresh-token-value');
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBe('refresh-token-value');
  });

  it('never stores the plaintext value on disk', () => {
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'super-secret-refresh-token');
    const onDisk = fs.readFileSync(STORE_FILE, 'utf8');
    expect(onDisk).not.toContain('super-secret-refresh-token');
  });

  it('writes the store file as 0600', () => {
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'tok');
    const mode = fs.statSync(STORE_FILE).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps distinct (service, account) pairs from colliding', () => {
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'value-1');
    setFallbackPassword('cowork-oauth-preview', 'gmail:a@b.com', 'value-2');
    setFallbackPassword('cowork-oauth', 'GITHUB_CLIENT_SECRET', 'value-3');
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBe('value-1');
    expect(getFallbackPassword('cowork-oauth-preview', 'gmail:a@b.com')).toBe('value-2');
    expect(getFallbackPassword('cowork-oauth', 'GITHUB_CLIENT_SECRET')).toBe('value-3');
  });

  it('deletes an entry without disturbing others in the same store', () => {
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'keep-me');
    setFallbackPassword('cowork-oauth', 'linear:x@y.com', 'delete-me');
    deleteFallbackPassword('cowork-oauth', 'linear:x@y.com');
    expect(getFallbackPassword('cowork-oauth', 'linear:x@y.com')).toBeNull();
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBe('keep-me');
  });

  it('deleting an entry that never existed is a no-op, not an error', () => {
    expect(() => deleteFallbackPassword('cowork-oauth', 'never:set')).not.toThrow();
  });

  it('treats a corrupt store file as empty rather than throwing', () => {
    fs.mkdirSync(h.home, { recursive: true });
    fs.writeFileSync(STORE_FILE, 'not valid json{{{', { mode: 0o600 });
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBeNull();
    // A subsequent write should still succeed and overwrite the corrupt file.
    setFallbackPassword('cowork-oauth', 'gmail:a@b.com', 'recovered');
    expect(getFallbackPassword('cowork-oauth', 'gmail:a@b.com')).toBe('recovered');
  });
});
