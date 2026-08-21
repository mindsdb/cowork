import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

// See custom-server.test.ts for why these two mocks exist and why the temp
// dir is created inline inside the factory rather than via an outer `let`.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
}));

vi.mock('./cowork-home', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const nodeFs = require('fs');
  const nodeOs = require('os');
  const nodePath = require('path');
  const homeDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'cowork-local-auth-'));
  const envPath = nodePath.join(homeDir, '.env');
  return {
    ...actual,
    coworkHome: () => homeDir,
    coworkEnvPath: () => envPath,
    readEnvFile: () => {
      if (!nodeFs.existsSync(envPath)) return {};
      const vars: Record<string, string> = {};
      for (const line of nodeFs.readFileSync(envPath, 'utf-8').split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        vars[line.slice(0, eq)] = line.slice(eq + 1);
      }
      return vars;
    },
    __testPaths: { homeDir, envPath },
  };
});

import { getLocalAuthConfig, setLocalAuthEnabled, verifyLocalAuthChange } from './local-auth';
import * as coworkHomeMock from './cowork-home';
const { homeDir, envPath } = (coworkHomeMock as unknown as {
  __testPaths: { homeDir: string; envPath: string };
}).__testPaths;

beforeEach(() => {
  fs.rmSync(envPath, { force: true });
});

afterEach(() => {
  fs.rmSync(envPath, { force: true });
});

describe('getLocalAuthConfig', () => {
  it('is disabled with no token when nothing is configured', () => {
    expect(getLocalAuthConfig()).toEqual({ enabled: false, token: null });
  });

  it('reads an enabled config with its token', () => {
    fs.writeFileSync(envPath, 'COWORK_REQUIRE_AUTH=true\nCOWORK_AUTH_TOKEN=abc123\n');
    expect(getLocalAuthConfig()).toEqual({ enabled: true, token: 'abc123' });
  });

  it('treats COWORK_REQUIRE_AUTH=false as disabled even with a leftover token', () => {
    fs.writeFileSync(envPath, 'COWORK_REQUIRE_AUTH=false\nCOWORK_AUTH_TOKEN=stale\n');
    expect(getLocalAuthConfig().enabled).toBe(false);
  });
});

describe('setLocalAuthEnabled', () => {
  it('enabling writes COWORK_REQUIRE_AUTH=true and a fresh token, preserving unrelated lines', async () => {
    fs.writeFileSync(envPath, 'COWORK_KEYCHAIN=false\n');
    const result = await setLocalAuthEnabled(true);

    expect(result.enabled).toBe(true);
    expect(result.token).toMatch(/^[0-9a-f]{32}$/);

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('COWORK_KEYCHAIN=false');
    expect(content).toContain('COWORK_REQUIRE_AUTH=true');
    expect(content).toContain(`COWORK_AUTH_TOKEN=${result.token}`);
    expect(getLocalAuthConfig()).toEqual({ enabled: true, token: result.token });
  });

  it('re-enabling mints a new token rather than reusing the old one', async () => {
    const first = await setLocalAuthEnabled(true);
    const second = await setLocalAuthEnabled(true);
    expect(second.token).not.toBe(first.token);
  });

  it('disabling clears both keys, reverting to no auth', async () => {
    fs.writeFileSync(
      envPath,
      'COWORK_REQUIRE_AUTH=true\nCOWORK_AUTH_TOKEN=abc123\nCOWORK_KEYCHAIN=false\n',
    );
    const result = await setLocalAuthEnabled(false);

    expect(result).toEqual({ enabled: false, token: null });
    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).not.toContain('COWORK_REQUIRE_AUTH');
    expect(content).not.toContain('COWORK_AUTH_TOKEN');
    expect(content).toContain('COWORK_KEYCHAIN=false');
    expect(getLocalAuthConfig()).toEqual({ enabled: false, token: null });
  });

  it('works even if the home directory briefly disappears (recreates it)', async () => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    const result = await setLocalAuthEnabled(true);
    expect(getLocalAuthConfig()).toEqual({ enabled: true, token: result.token });
  });
});

describe('verifyLocalAuthChange', () => {
  const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    consoleLog.mockClear();
    consoleWarn.mockClear();
    consoleError.mockClear();
  });

  it('enabled: logs success when a bare request 401s and a token-bearing one succeeds', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const authed = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return authed ? { ok: true, status: 200 } : { ok: false, status: 401 };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyLocalAuthChange(26866, { enabled: true, token: 'abc123' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:26866/api/v1/settings/',
      expect.objectContaining({ headers: { Authorization: 'Bearer abc123' } }),
    );
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('correctly rejected'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('auth key works correctly'));
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('enabled: warns if a bare request unexpectedly succeeds (auth not enforced)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    await verifyLocalAuthChange(26866, { enabled: true, token: 'abc123' });
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining('may not be enforced'));
  });

  it('enabled: errors if the token itself is rejected', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    await verifyLocalAuthChange(26866, { enabled: true, token: 'wrong' });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('auth key may be wrong'));
  });

  it('disabled: logs success when a bare request succeeds', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyLocalAuthChange(26866, { enabled: false, token: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:26866/api/v1/settings/', expect.anything());
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('correctly disabled'));
  });

  it('is best-effort: a network failure is caught and logged, never thrown', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    await expect(verifyLocalAuthChange(26866, { enabled: true, token: 'abc123' })).resolves.toBeUndefined();
    expect(consoleWarn).toHaveBeenCalledWith('[local-auth] verification request failed (non-fatal):', expect.any(Error));
  });
});
