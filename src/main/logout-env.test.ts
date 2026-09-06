import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Stub the atomic writer to force exhausted retries without loading Electron/keychain dependencies.
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

  // Even a failed file write must scrub process.env. Logout treats .env cleanup as best-effort
  // because the DB owns sign-out state.
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

  // Remove ANTON_MINDS_API_KEY so the one-time device-key migration cannot repeat sign-out on every
  // launch.
  it('strips the line the boot migration uses as its marker, so it runs once', async () => {
    fs.writeFileSync(envPath, [
      'ANTON_MINDS_API_KEY=mdb_minted_by_an_older_build',
      'ANTON_TERMS_CONSENT=true',
    ].join('\n'));

    await scrubEnvCredentials(envPath);

    const written = writeEnvFileAtomic.mock.calls[0][1] as string;
    expect(written).not.toContain('ANTON_MINDS_API_KEY');
    // The consent line is what keeps the re-signed-in user out of the terms
    // step, so the migration must not take it with the credential.
    expect(written).toContain('ANTON_TERMS_CONSENT=true');
  });

  it('defaults to the canonical LOGOUT_ENV_KEYS list', () => {
    expect(LOGOUT_ENV_KEYS).toContain('ANTON_ANTHROPIC_API_KEY');
    expect(LOGOUT_ENV_KEYS).toContain('ANTON_MINDS_API_KEY');
    // Models are deliberately preserved (ENG-739).
    expect(LOGOUT_ENV_KEYS).not.toContain('ANTON_PLANNING_MODEL');
    expect(LOGOUT_ENV_KEYS).not.toContain('ANTON_CODING_MODEL');
  });
});
