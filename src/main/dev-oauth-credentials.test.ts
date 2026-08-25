import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDevOAuthCredentials } from './dev-oauth-credentials';

const temporaryDirectories: string[] = [];

function oauthEnv(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'cowork-dev-oauth-'));
  temporaryDirectories.push(directory);
  const file = join(directory, '.env');
  writeFileSync(file, content, { mode: 0o600 });
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('loadDevOAuthCredentials', () => {
  it('never reads local credentials for packaged applications', () => {
    const envFile = oauthEnv('GITHUB_CLIENT_ID=local-github\n');

    expect(loadDevOAuthCredentials({ isPackaged: true, env: {}, envFile })).toEqual({});
  });

  it('loads only the GitHub and Linear OAuth client fields', () => {
    const envFile = oauthEnv([
      'GITHUB_CLIENT_ID=github-id',
      'GITHUB_CLIENT_SECRET="github-secret"',
      "export LINEAR_CLIENT_ID='linear-id'",
      'LINEAR_CLIENT_SECRET=linear-secret',
      'ANTON_MINDS_API_KEY=must-not-leak',
      'GITHUB_ACCESS_TOKEN=must-not-leak',
    ].join('\n'));

    expect(loadDevOAuthCredentials({ isPackaged: false, env: {}, envFile })).toEqual({
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: 'github-secret',
      LINEAR_CLIENT_ID: 'linear-id',
      LINEAR_CLIENT_SECRET: 'linear-secret',
    });
  });

  it('prefers an explicit process value and tolerates a missing file', () => {
    expect(loadDevOAuthCredentials({
      isPackaged: false,
      env: { GITHUB_CLIENT_ID: 'explicit' },
      envFile: '/missing/cowork-dev-oauth.env',
    })).toEqual({ GITHUB_CLIENT_ID: 'explicit' });
  });
});
