import { afterEach, describe, expect, it } from 'vitest';

import { sanitizedParentEnv } from './agent-env';

const originalPlatform = process.platform;
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('the environment an agent or a repository hook runs with', () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  const parent: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/Users/someone',
    SSH_AUTH_SOCK: '/tmp/agent.sock',
    GIT_AUTHOR_NAME: 'Someone',
    SOME_UNRELATED_VAR: 'keep-me',
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    ANTHROPIC_API_KEY: 'sk-the-users-own',
    COWORK_AUTH_TOKEN: 'ab'.repeat(32),
    COWORK_HOME: '/Users/someone/.cowork-dev',
    COWORK_APP_SECRET_STDIN: '2',
    MINDSHUB_API_KEY: 'mdb_should_not_leak',
    OPENAI_API_KEY: 'sk-the-users-own-too',
    OPENAI_BASE_URL: 'https://example.test/v1',
  };

  it("drops only this app's and its server's families for a git call, and keeps the user's provider keys", () => {
    expect(sanitizedParentEnv(parent)).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/someone',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      GIT_AUTHOR_NAME: 'Someone',
      SOME_UNRELATED_VAR: 'keep-me',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      ANTHROPIC_API_KEY: 'sk-the-users-own',
      OPENAI_API_KEY: 'sk-the-users-own-too',
      OPENAI_BASE_URL: 'https://example.test/v1',
    });
  });

  it("also drops Claude Code's own markers and ANTHROPIC_* for the Claude Code CLI, and keeps the user's OPENAI_*", () => {
    expect(sanitizedParentEnv(parent, { forClaudeCode: true })).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/someone',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      GIT_AUTHOR_NAME: 'Someone',
      SOME_UNRELATED_VAR: 'keep-me',
      OPENAI_API_KEY: 'sk-the-users-own-too',
      OPENAI_BASE_URL: 'https://example.test/v1',
    });
  });

  it('matches the families by prefix only, so a name that merely contains one stays', () => {
    const kept = { MY_COWORK_SETTING: 'a', NOT_ANTHROPIC_KEY: 'b', XMINDSHUB_URL: 'c', CLAUDECODE_EXTRA: 'd' };

    expect(sanitizedParentEnv(kept, { forClaudeCode: true })).toEqual(kept);
  });

  it('matches the families in any case on Windows, whose variable names ignore case', () => {
    setPlatform('win32');
    const mixed = { Path: 'C:\\Windows', Cowork_Home: 'C:\\cowork', mindshub_api_key: 'mdb_x', Anthropic_Api_Key: 'sk-x', ClaudeCode: '1' };

    expect(sanitizedParentEnv(mixed)).toEqual({ Path: 'C:\\Windows', Anthropic_Api_Key: 'sk-x', ClaudeCode: '1' });
    expect(sanitizedParentEnv(mixed, { forClaudeCode: true })).toEqual({ Path: 'C:\\Windows' });
  });

  it('matches the families by case elsewhere, where a differently cased name is another variable', () => {
    setPlatform('linux');
    const mixed = { Cowork_Home: '/home/someone/cowork', COWORK_HOME: '/home/someone/.cowork' };

    expect(sanitizedParentEnv(mixed)).toEqual({ Cowork_Home: '/home/someone/cowork' });
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
