/* `<repo>/.claude-mindshub` holds Claude Code's transcripts and the task
 * worktrees, inside a repository other accounts may be able to read. Real fs
 * under a temp folder; coding-terminal.test.ts covers the terminal itself with
 * an in-memory fs. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

class FakeUtilityProcess extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn();
}
const forkMock = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({ utilityProcess: { fork: forkMock } }));
vi.mock('./coding-mode', () => ({
  detectClaudeCode: async () => ({ installed: true, path: '/usr/local/bin/claude' }),
  revealMindsApiKey: async () => 'mdb_test_token',
  revealMindsBaseUrl: async () => 'https://api.staging.mindshub.ai',
}));
vi.mock('./uv-paths', () => ({ getEnvPath: () => '/fake/path' }));
// No git here: the terminal falls back to running in the project folder.
vi.mock('./coding-workspace', () => ({
  ensureTaskWorktree: async () => {
    throw new Error('no git in this test');
  },
  removeTaskWorktree: vi.fn(),
}));

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFileSync,
}));

import { ensureClaudeConfigDefaults, killAllCodingTerminals, startCodingTerminal } from './coding-terminal';

const ICACLS_ARGS = ['/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-3-4:(OI)(CI)F'];

let repo: string;
let mindshub: string;
let configDir: string;

beforeEach(() => {
  execFileSync.mockReset();
  forkMock.mockReset();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-repo-'));
  mindshub = path.join(repo, '.claude-mindshub');
  configDir = path.join(mindshub, 'config');
});

afterEach(() => {
  killAllCodingTerminals();
  fs.rmSync(repo, { recursive: true, force: true });
});

const modeOf = (dir: string) => fs.statSync(dir).mode & 0o777;

async function startTerminal(taskId: string): Promise<void> {
  const child = new FakeUtilityProcess();
  forkMock.mockReturnValue(child);
  const started = startCodingTerminal(taskId, { projectPath: repo, message: '', model: 'kimi' }, 80, 24, { send: vi.fn() } as never);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' })));
  child.emit('message', { type: 'started' });
  expect(await started).toEqual({ ok: true });
}

describe('the .claude-mindshub folder a coding terminal uses', () => {
  it.skipIf(process.platform === 'win32')('is created at 0700 when a terminal starts, with the config seeded', async () => {
    await startTerminal('task-private');

    expect(modeOf(mindshub)).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'))).toEqual({ theme: 'dark' });
  });

  it.skipIf(process.platform === 'win32')('is pinned when the task worktree step already made it at 0755', async () => {
    fs.mkdirSync(path.join(mindshub, 'tasks'), { recursive: true });
    fs.chmodSync(mindshub, 0o755);

    await startTerminal('task-existing');

    expect(modeOf(mindshub)).toBe(0o700);
  });

  it('never runs icacls on linux', () => {
    ensureClaudeConfigDefaults(configDir, repo, { platform: 'linux' });
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('gets an owner-only access list once on win32, and not again once marked', () => {
    ensureClaudeConfigDefaults(configDir, repo, { platform: 'win32' });
    ensureClaudeConfigDefaults(configDir, repo, { platform: 'win32' });

    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith('icacls', [mindshub, ...ICACLS_ARGS], expect.anything());
    expect(fs.existsSync(path.join(configDir, 'settings.json'))).toBe(true);
  });

  it('gets the access list on win32 when it exists without the marker', () => {
    fs.mkdirSync(path.join(mindshub, 'tasks'), { recursive: true });

    ensureClaudeConfigDefaults(configDir, repo, { platform: 'win32' });

    expect(execFileSync).toHaveBeenCalledTimes(1);
  });

  it('still seeds the config when icacls fails', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('icacls failed');
    });

    ensureClaudeConfigDefaults(configDir, repo, { platform: 'win32' });

    expect(fs.existsSync(path.join(configDir, 'settings.json'))).toBe(true);
  });
});
