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
  const homeDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'cowork-backend-install-pref-'));
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

import { skipBackendInstallRequested, persistSkipBackendInstall } from './backend-install-pref';
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

describe('skipBackendInstallRequested', () => {
  it('is false when nothing is configured', () => {
    expect(skipBackendInstallRequested()).toBe(false);
  });

  it('is true once the flag is set', () => {
    fs.writeFileSync(envPath, 'COWORK_SKIP_BACKEND_INSTALL=true\n');
    expect(skipBackendInstallRequested()).toBe(true);
  });

  it('is false for any other value', () => {
    fs.writeFileSync(envPath, 'COWORK_SKIP_BACKEND_INSTALL=false\n');
    expect(skipBackendInstallRequested()).toBe(false);
  });
});

describe('persistSkipBackendInstall', () => {
  it('writes the flag, preserving unrelated existing lines', async () => {
    fs.writeFileSync(envPath, 'COWORK_KEYCHAIN=false\n');
    await persistSkipBackendInstall();

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('COWORK_KEYCHAIN=false');
    expect(content).toContain('COWORK_SKIP_BACKEND_INSTALL=true');
    expect(skipBackendInstallRequested()).toBe(true);
  });

  it('is idempotent — calling twice does not duplicate the line', async () => {
    await persistSkipBackendInstall();
    await persistSkipBackendInstall();

    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content.match(/COWORK_SKIP_BACKEND_INSTALL=/g)).toHaveLength(1);
  });

  it('works even if the home directory briefly disappears (recreates it)', async () => {
    fs.rmSync(homeDir, { recursive: true, force: true });
    await persistSkipBackendInstall();
    expect(skipBackendInstallRequested()).toBe(true);
  });
});
