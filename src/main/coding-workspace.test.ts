import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

const fsStore = vi.hoisted(() => new Map<string, string>());
const existsPaths = vi.hoisted(() => new Set<string>());
const lstatPaths = vi.hoisted(() => new Set<string>());
const symlinkSyncMock = vi.hoisted(() => vi.fn());
vi.mock('fs', () => ({
  existsSync: (p: string) => existsPaths.has(p),
  mkdirSync: vi.fn(),
  readFileSync: (p: string) => {
    if (!fsStore.has(p)) {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return fsStore.get(p);
  },
  writeFileSync: (p: string, data: string) => {
    fsStore.set(p, data);
  },
  rmSync: vi.fn(),
  lstatSync: (p: string) => {
    if (p.endsWith('/.claude-mindshub')) return { isDirectory: () => true, ino: 1n, dev: 1n };
    if (!lstatPaths.has(p)) {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }
    return {};
  },
  symlinkSync: symlinkSyncMock,
}));

/* The folder's modes and access list are checked on a real filesystem in
 * coding-terminal.private-folder.test.ts; this file's fs is an in-memory fake. */
vi.mock('./private-files', () => ({ pinPrivateDir: vi.fn(), restrictToOwnerOnWindows: vi.fn(async () => {}) }));

// execFile's callback signature is (err, stdout, stderr) — succeed by
// default; individual tests override with mockImplementationOnce to
// simulate a specific git command failing (e.g. "not a repo").
function succeed() {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
    cb(null, '', '');
  });
}
function failOnce() {
  execFileMock.mockImplementationOnce((_cmd: string, _args: string[], _opts: any, cb: any) => {
    cb(new Error('not a git repository'), '', 'fatal: not a git repository');
  });
}

describe('coding-workspace', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    fsStore.clear();
    existsPaths.clear();
    lstatPaths.clear();
    symlinkSyncMock.mockReset();
    succeed();
  });

  describe('ensureTaskWorktree', () => {
    it('reuses an existing worktree directory without touching git', async () => {
      existsPaths.add('/proj/.claude-mindshub/tasks/task-1');
      const { ensureTaskWorktree } = await import('./coding-workspace');

      const result = await ensureTaskWorktree('/proj', 'task-1');

      expect(result).toEqual({ path: '/proj/.claude-mindshub/tasks/task-1', isNew: false });
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("runs git, and so the repository's hooks, without this app's or its server's settings, and with the user's provider keys", async () => {
      process.env.COWORK_AUTH_TOKEN = 'ab'.repeat(32);
      process.env.MINDSHUB_API_KEY = 'mdb_should_not_leak';
      process.env.OPENAI_API_KEY = 'sk-the-users-own';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-the-users-own';
      try {
        const { ensureTaskWorktree } = await import('./coding-workspace');
        failOnce();

        await ensureTaskWorktree('/proj', 'task-env');

        expect(execFileMock).toHaveBeenCalled();
        for (const [, , opts] of execFileMock.mock.calls as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }][]) {
          expect(opts.cwd).toBe('/proj');
          expect(opts.env).toBeDefined();
          expect(opts.env).not.toHaveProperty('COWORK_AUTH_TOKEN');
          expect(opts.env).not.toHaveProperty('MINDSHUB_API_KEY');
          // Desktop main sets neither, so both are the user's own.
          expect(opts.env.OPENAI_API_KEY).toBe('sk-the-users-own');
          expect(opts.env.ANTHROPIC_API_KEY).toBe('sk-ant-the-users-own');
          expect(opts.env.PATH).toBe(process.env.PATH);
        }
      } finally {
        delete process.env.COWORK_AUTH_TOKEN;
        delete process.env.MINDSHUB_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it('bootstraps a fresh git repo (init, .gitignore, initial commit) before creating the worktree', async () => {
      const { ensureTaskWorktree } = await import('./coding-workspace');
      // First git call (`rev-parse --is-inside-work-tree`) fails: not a repo yet.
      failOnce();

      const result = await ensureTaskWorktree('/proj', 'task-2');

      expect(result).toEqual({ path: '/proj/.claude-mindshub/tasks/task-2', isNew: true });
      const calls = execFileMock.mock.calls.map((c: any[]) => c[1]);
      expect(calls).toContainEqual(['rev-parse', '--is-inside-work-tree']);
      expect(calls).toContainEqual(['init', '-b', 'main']);
      expect(calls).toContainEqual(['add', '-A']);
      expect(calls.some((a: string[]) => a[0] === 'commit')).toBe(true);
      expect(calls).toContainEqual(['worktree', 'add', '/proj/.claude-mindshub/tasks/task-2', '-b', 'claude/task-2', 'main']);

      const gitignore = fsStore.get('/proj/.gitignore') || '';
      expect(gitignore).toContain('.anton/');
      expect(gitignore).toContain('skills/');
      expect(gitignore).toContain('.claude-mindshub/');
    });

    it('enables long paths on every git call on Windows only', async () => {
      const { ensureTaskWorktree } = await import('./coding-workspace');
      const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      try {
        await ensureTaskWorktree('/proj', 'task-win');
      } finally {
        Object.defineProperty(process, 'platform', original);
      }

      const calls = execFileMock.mock.calls.map((c: any[]) => c[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const args of calls) expect(args.slice(0, 2)).toEqual(['-c', 'core.longpaths=true']);
      expect(calls).toContainEqual([
        '-c', 'core.longpaths=true',
        'worktree', 'add', '/proj/.claude-mindshub/tasks/task-win', '-b', 'claude/task-win', 'main',
      ]);
    });

    it('skips git init when the repo already exists, but still creates the worktree', async () => {
      const { ensureTaskWorktree } = await import('./coding-workspace');
      // rev-parse succeeds (default `succeed()`) — already a repo.

      await ensureTaskWorktree('/proj', 'task-3');

      const calls = execFileMock.mock.calls.map((c: any[]) => c[1]);
      expect(calls).not.toContainEqual(['init', '-b', 'main']);
      expect(calls).toContainEqual(['worktree', 'add', '/proj/.claude-mindshub/tasks/task-3', '-b', 'claude/task-3', 'main']);
    });

    it('preserves an existing .gitignore, only appending missing entries', async () => {
      fsStore.set('/proj/.gitignore', 'node_modules/\n.anton/\n');
      const { ensureTaskWorktree } = await import('./coding-workspace');
      failOnce(); // not a repo yet, so ensureRepo() runs and touches .gitignore

      await ensureTaskWorktree('/proj', 'task-4');

      const gitignore = fsStore.get('/proj/.gitignore')!;
      expect(gitignore).toContain('node_modules/');
      expect(gitignore).toContain('.anton/');
      expect(gitignore).toContain('.claude-mindshub/');
      // Original entry isn't duplicated.
      expect(gitignore.match(/\.anton\//g)?.length).toBe(1);
    });

    it('symlinks .anton/ and skills/ from the worktree back to the live project dirs, when they exist', async () => {
      existsPaths.add('/proj/.anton');
      existsPaths.add('/proj/skills');
      const { ensureTaskWorktree } = await import('./coding-workspace');

      await ensureTaskWorktree('/proj', 'task-links');

      expect(symlinkSyncMock).toHaveBeenCalledWith('/proj/.anton', '/proj/.claude-mindshub/tasks/task-links/.anton', 'dir');
      expect(symlinkSyncMock).toHaveBeenCalledWith('/proj/skills', '/proj/.claude-mindshub/tasks/task-links/skills', 'dir');
    });

    it('skips linking a shared dir that does not exist in the project yet', async () => {
      // Neither /proj/.anton nor /proj/skills is in existsPaths.
      const { ensureTaskWorktree } = await import('./coding-workspace');

      await ensureTaskWorktree('/proj', 'task-nolinks');

      expect(symlinkSyncMock).not.toHaveBeenCalled();
    });

    it('does not re-create a link that is already there', async () => {
      existsPaths.add('/proj/.anton');
      lstatPaths.add('/proj/.claude-mindshub/tasks/task-relink/.anton');
      const { ensureTaskWorktree } = await import('./coding-workspace');

      await ensureTaskWorktree('/proj', 'task-relink');

      expect(symlinkSyncMock).not.toHaveBeenCalled();
    });

    it('re-checks shared links on reconnect (worktree already exists)', async () => {
      existsPaths.add('/proj/.claude-mindshub/tasks/task-reconnect');
      existsPaths.add('/proj/skills');
      const { ensureTaskWorktree } = await import('./coding-workspace');

      const result = await ensureTaskWorktree('/proj', 'task-reconnect');

      expect(result.isNew).toBe(false);
      expect(symlinkSyncMock).toHaveBeenCalledWith('/proj/skills', '/proj/.claude-mindshub/tasks/task-reconnect/skills', 'dir');
    });
  });

  describe('removeTaskWorktree', () => {
    it('removes the worktree and deletes its branch', async () => {
      const { removeTaskWorktree } = await import('./coding-workspace');

      await removeTaskWorktree('/proj', 'task-5');

      const calls = execFileMock.mock.calls.map((c: any[]) => c[1]);
      expect(calls).toContainEqual(['worktree', 'remove', '/proj/.claude-mindshub/tasks/task-5', '--force']);
      expect(calls).toContainEqual(['branch', '-D', 'claude/task-5']);
    });

    it('falls back to a plain delete when git does not know about the worktree', async () => {
      const fs = await import('fs');
      const { removeTaskWorktree } = await import('./coding-workspace');
      failOnce(); // `git worktree remove` fails

      await removeTaskWorktree('/proj', 'task-6');

      expect(fs.rmSync).toHaveBeenCalledWith('/proj/.claude-mindshub/tasks/task-6', { recursive: true, force: true });
    });

    it('never throws even when both the worktree remove and branch delete fail', async () => {
      const { removeTaskWorktree } = await import('./coding-workspace');
      execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: any) => {
        cb(new Error('boom'), '', '');
      });

      await expect(removeTaskWorktree('/proj', 'task-7')).resolves.toBeUndefined();
    });
  });
});
