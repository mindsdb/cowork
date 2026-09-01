import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';

import { loadDevOAuthCredentials } from './dev-oauth-credentials';

describe('loadDevOAuthCredentials', () => {
  it('never reads local credentials for packaged applications', () => {
    expect(loadDevOAuthCredentials({
      isPackaged: true,
      env: {},
      fileContent: 'GITHUB_CLIENT_ID=local-github\n',
    })).toEqual({});
  });

  it('loads only the GitHub and Linear OAuth client fields', () => {
    const githubSecret = randomUUID();
    const linearSecret = randomUUID();
    const excludedMindsKey = randomUUID();
    const excludedGithubToken = randomUUID();
    const fileContent = [
      'GITHUB_CLIENT_ID=github-id',
      `GITHUB_CLIENT_SECRET="${githubSecret}"`,
      "export LINEAR_CLIENT_ID='linear-id'",
      `LINEAR_CLIENT_SECRET=${linearSecret}`,
      `ANTON_MINDS_API_KEY=${excludedMindsKey}`,
      `GITHUB_ACCESS_TOKEN=${excludedGithubToken}`,
    ].join('\n');

    expect(loadDevOAuthCredentials({ isPackaged: false, env: {}, fileContent })).toEqual({
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: githubSecret,
      LINEAR_CLIENT_ID: 'linear-id',
      LINEAR_CLIENT_SECRET: linearSecret,
    });
  });

  it('prefers an explicit process value and tolerates a missing file', () => {
    expect(loadDevOAuthCredentials({
      isPackaged: false,
      env: { GITHUB_CLIENT_ID: 'explicit' },
      fileContent: null,
    })).toEqual({ GITHUB_CLIENT_ID: 'explicit' });
  });
});
