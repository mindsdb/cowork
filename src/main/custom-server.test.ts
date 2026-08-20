import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// custom-server.ts imports writeEnvFileAtomic from minds-auth.ts, which
// transitively loads token-store.ts, which touches electron's `app` at
// module init. Stub it so the module imports under the node test env.
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => os.tmpdir(),
  },
}));

// custom-server.ts reads/writes through cowork-home.ts's readEnvFile/
// coworkHome/coworkEnvPath — point those at a throwaway temp file instead of
// the real ~/.cowork*/.env. The temp dir is created inline, at mock-factory
// eval time (not via a `let` the factory closes over): token-store.ts calls
// coworkHome() at ITS OWN module top-level as part of the hoisted import
// chain, before any of this file's own top-level statements run, so a
// factory referencing an outer `let` hits it mid-TDZ. __testPaths exposes
// the generated paths back to this file's tests.
vi.mock('./cowork-home', async (importOriginal) => {
  // Spread the real module first — other transitive imports (keychain-
  // service.ts, credential-provisioning.ts, ...) need its other exports
  // (buildKind, etc.) untouched; only these three are overridden.
  const actual = (await importOriginal()) as Record<string, unknown>;
  const nodeFs = require('fs');
  const nodeOs = require('os');
  const nodePath = require('path');
  const homeDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'cowork-custom-server-'));
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

import { getCustomServerConfig, setCustomServerConfig } from './custom-server';
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

describe('getCustomServerConfig', () => {
  it('returns nulls when nothing is configured', () => {
    expect(getCustomServerConfig()).toEqual({ url: null, token: null });
  });

  it('reads a configured url and token', () => {
    fs.writeFileSync(envPath, 'COWORK_CUSTOM_SERVER_URL=http://127.0.0.1:27866\nCOWORK_CUSTOM_SERVER_TOKEN=abc123\n');
    expect(getCustomServerConfig()).toEqual({ url: 'http://127.0.0.1:27866', token: 'abc123' });
  });

  it('treats a url with no token as unauthenticated (both null-safe)', () => {
    fs.writeFileSync(envPath, 'COWORK_CUSTOM_SERVER_URL=http://127.0.0.1:27866\n');
    expect(getCustomServerConfig()).toEqual({ url: 'http://127.0.0.1:27866', token: null });
  });
});

describe('setCustomServerConfig', () => {
  it('writes a url and token, preserving unrelated existing lines', async () => {
    fs.writeFileSync(envPath, 'COWORK_KEYCHAIN=false\n');
    await setCustomServerConfig({ url: 'http://127.0.0.1:27866', token: 'abc123' });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('COWORK_KEYCHAIN=false');
    expect(content).toContain('COWORK_CUSTOM_SERVER_URL=http://127.0.0.1:27866');
    expect(content).toContain('COWORK_CUSTOM_SERVER_TOKEN=abc123');
    expect(getCustomServerConfig()).toEqual({ url: 'http://127.0.0.1:27866', token: 'abc123' });
  });

  it('clearing with an empty url removes both keys, reverting to the local server', async () => {
    fs.writeFileSync(
      envPath,
      'COWORK_CUSTOM_SERVER_URL=http://127.0.0.1:27866\nCOWORK_CUSTOM_SERVER_TOKEN=abc123\nCOWORK_KEYCHAIN=false\n',
    );
    await setCustomServerConfig({ url: null, token: null });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).not.toContain('COWORK_CUSTOM_SERVER_URL');
    expect(content).not.toContain('COWORK_CUSTOM_SERVER_TOKEN');
    expect(content).toContain('COWORK_KEYCHAIN=false');
    expect(getCustomServerConfig()).toEqual({ url: null, token: null });
  });

  it('replaces a previously-configured url/token rather than duplicating lines', async () => {
    await setCustomServerConfig({ url: 'http://127.0.0.1:27866', token: 'old-token' });
    await setCustomServerConfig({ url: 'http://192.168.1.5:26866', token: 'new-token' });

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content.match(/COWORK_CUSTOM_SERVER_URL=/g)).toHaveLength(1);
    expect(getCustomServerConfig()).toEqual({ url: 'http://192.168.1.5:26866', token: 'new-token' });
  });

  it('works even if the home directory briefly disappears (recreates it)', async () => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    await setCustomServerConfig({ url: 'http://127.0.0.1:27866', token: null });
    expect(getCustomServerConfig()).toEqual({ url: 'http://127.0.0.1:27866', token: null });
  });
});
