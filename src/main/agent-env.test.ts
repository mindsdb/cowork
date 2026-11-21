import { describe, expect, it } from 'vitest';

import { sanitizedParentEnv } from './agent-env';

describe('the environment an agent or a repository hook runs with', () => {
  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GIT_AUTHOR_NAME: 'Someone',
    SOME_UNRELATED_VAR: 'keep-me',
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    ANTHROPIC_API_KEY: 'sk-should-not-leak',
    COWORK_AUTH_TOKEN: 'ab'.repeat(32),
    COWORK_HOME: '/Users/someone/.cowork-dev',
    COWORK_APP_SECRET_STDIN: '2',
    MINDSHUB_API_KEY: 'mdb_should_not_leak',
    OPENAI_API_KEY: 'sk-should-not-leak-either',
    OPENAI_BASE_URL: 'https://example.test/v1',
  };

  it("drops this app's, its server's and the provider families, and Claude Code's own markers", () => {
    expect(sanitizedParentEnv(parent)).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/someone',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      GIT_AUTHOR_NAME: 'Someone',
      SOME_UNRELATED_VAR: 'keep-me',
    });
  });

  it('matches the families by prefix only, so a name that merely contains one stays', () => {
    const kept = { MY_COWORK_SETTING: 'a', NOT_OPENAI_KEY: 'b', XMINDSHUB_URL: 'c', CLAUDECODE_EXTRA: 'd' };

    expect(sanitizedParentEnv(kept)).toEqual(kept);
  });

  it("reads this process's own environment by default", () => {
    process.env.MINDSHUB_SECRET_FOR_THIS_TEST = 'x';
    try {
      expect(sanitizedParentEnv()).not.toHaveProperty('MINDSHUB_SECRET_FOR_THIS_TEST');
    } finally {
      delete process.env.MINDSHUB_SECRET_FOR_THIS_TEST;
    }
  });
});
