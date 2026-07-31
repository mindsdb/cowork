import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// writeEnvFileAtomic is #548's atomic + lock-tolerant writer (ENG-1209). Stub
// it so we can drive the "write still fails after retries" path deterministically
// without importing minds-auth's electron/keychain dependencies.
const writeEnvFileAtomic = vi.hoisted(() => vi.fn());
vi.mock('./minds-auth', () => ({ writeEnvFileAtomic }));

import { scrubEnvCredentials, LOGOUT_ENV_KEYS } from './logout-env';

const KEYS = ['ANTON_ANTHROPIC_API_KEY', 'ANTON_OPENAI_API_KEY'];

describe('scrubEnvCredentials (ENG-1206)', () => {
  let dir: string;
  let envPath: string;

  beforeEach(() => {
    writeEnvFileAtomic.mockReset().mockResolvedValue(undefined);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logout-env-'));
    envPath = path.join(dir, '.env');
    for (const k of KEYS) process.env[k] = 'secret';
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    for (const k of KEYS) delete process.env[k];
  });

  it('rewrites the .env without the credential keys and clears process.env', async () => {
    fs.writeFileSync(envPath, [
      'ANTON_ANTHROPIC_API_KEY=sk-1',
      'ANTON_TERMS_CONSENT=1',
      'ANTON_OPENAI_API_KEY=sk-2',
    ].join('\n'));

    await scrubEnvCredentials(envPath, KEYS);

    // Non-credential lines survive; credential lines are stripped.
    expect(writeEnvFileAtomic).toHaveBeenCalledWith(envPath, 'ANTON_TERMS_CONSENT=1');
    for (const k of KEYS) expect(process.env[k]).toBeUndefined();
  });

  // A write that never lands surfaces as a rejection (so the caller can observe
  // it) — but process.env is still scrubbed via `finally`. The logout handler
  // treats this as best-effort and presses on: since ENG-941 the DB, not the
  // .env, is authoritative for sign-out, so a failed scrub is not a failed
  // sign-out — it only leaves stale keys for the standalone anton CLI.
  it('rejects when the atomic write fails, but still clears process.env', async () => {
    fs.writeFileSync(envPath, 'ANTON_ANTHROPIC_API_KEY=sk-1');
    writeEnvFileAtomic.mockRejectedValue(new Error('EPERM: operation not permitted'));

    await expect(scrubEnvCredentials(envPath, KEYS)).rejects.toThrow('EPERM');
    for (const k of KEYS) expect(process.env[k]).toBeUndefined();
  });

  it('clears process.env even when no .env file exists (no write attempted)', async () => {
    await scrubEnvCredentials(path.join(dir, 'missing.env'), KEYS);

    expect(writeEnvFileAtomic).not.toHaveBeenCalled();
    for (const k of KEYS) expect(process.env[k]).toBeUndefined();
  });

  it('defaults to the canonical LOGOUT_ENV_KEYS list', () => {
    expect(LOGOUT_ENV_KEYS).toContain('ANTON_ANTHROPIC_API_KEY');
    expect(LOGOUT_ENV_KEYS).toContain('ANTON_MINDS_API_KEY');
    // Models are deliberately preserved (ENG-739).
    expect(LOGOUT_ENV_KEYS).not.toContain('ANTON_PLANNING_MODEL');
    expect(LOGOUT_ENV_KEYS).not.toContain('ANTON_CODING_MODEL');
  });
});
