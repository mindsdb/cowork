/* `<repo>/.claude-mindshub` holds Claude Code's transcripts and the task
 * worktrees, inside a repository other accounts may be able to read. Real fs
 * under a temp folder and the real ensureTaskWorktree, so the order of the
 * steps is the order the app runs them. git and icacls are fakes: the fake git
 * records the folder's state at the moment it would check a worktree out.
 * coding-terminal.test.ts covers the terminal itself with an in-memory fs. */
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

/** What the fakes saw, in order: each icacls call, and the folder's mode and
 *  access-list marker when git checked a worktree out. */
type Step =
  | { kind: 'icacls'; args: string[] }
  | { kind: 'checkout'; folderMode: number; ownerOnlyMarker: boolean };

const fake = vi.hoisted(() => ({
  steps: [] as Step[],
  gitMissing: false,
  icaclsFails: false,
}));
const execFile = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('child_process')>()),
  execFile,
}));

import { killAllCodingTerminals, startCodingTerminal } from './coding-terminal';
import { ensureTaskWorktree } from './coding-workspace';

/* Spelled out rather than imported: folders on disk already carry this name,
 * so renaming it would run icacls on every one of them again. */
const OWNER_ONLY_ACCESS_MARKER = '.owner-only-access';
const ICACLS_ARGS = ['/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '*S-1-3-4:(OI)(CI)F'];

let repo: string;
let mindshub: string;

const modeOf = (dir: string) => fs.statSync(dir).mode & 0o777;

type Callback = (err: Error | null, stdout?: string, stderr?: string) => void;

function fakeExecFile(cmd: string, args: string[], _opts: unknown, cb: Callback): void {
  if (cmd === 'icacls') {
    fake.steps.push({ kind: 'icacls', args });
    cb(fake.icaclsFails ? new Error('icacls failed') : null, '', '');
    return;
  }
  if (fake.gitMissing) {
    cb(Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }));
    return;
  }
  const [command, subcommand, worktreePath] = args.filter((arg) => arg !== '-c' && arg !== 'core.longpaths=true');
  if (command === 'worktree' && subcommand === 'add') {
    fake.steps.push({
      kind: 'checkout',
      folderMode: modeOf(mindshub),
      ownerOnlyMarker: fs.existsSync(path.join(mindshub, OWNER_ONLY_ACCESS_MARKER)),
    });
    fs.mkdirSync(worktreePath, { recursive: true });
  }
  cb(null, '', '');
}

beforeEach(() => {
  execFile.mockReset().mockImplementation(fakeExecFile);
  forkMock.mockReset();
  fake.steps = [];
  fake.gitMissing = false;
  fake.icaclsFails = false;
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-repo-'));
  mindshub = path.join(repo, '.claude-mindshub');
});

afterEach(() => {
  killAllCodingTerminals();
  fs.rmSync(repo, { recursive: true, force: true });
});

async function startTerminal(taskId: string): Promise<void> {
  const child = new FakeUtilityProcess();
  forkMock.mockReturnValue(child);
  const started = startCodingTerminal(taskId, { projectPath: repo, message: '', model: 'kimi' }, 80, 24, { send: vi.fn() } as never);
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' })));
  child.emit('message', { type: 'started' });
  expect(await started).toEqual({ ok: true });
}

const checkouts = () => fake.steps.filter((step) => step.kind === 'checkout');
const icaclsCalls = () => fake.steps.filter((step) => step.kind === 'icacls');

describe('the .claude-mindshub folder a coding terminal uses', () => {
  it.skipIf(process.platform === 'win32')('is 0700 before git checks the task worktree out into it', async () => {
    await startTerminal('task-private');

    expect(checkouts()).toEqual([{ kind: 'checkout', folderMode: 0o700, ownerOnlyMarker: false }]);
    expect(modeOf(mindshub)).toBe(0o700);
    expect(JSON.parse(fs.readFileSync(path.join(mindshub, 'config', 'settings.json'), 'utf8'))).toEqual({ theme: 'dark' });
  });

  it.skipIf(process.platform === 'win32')('is pinned when an older build left it at 0755 and the task reconnects', async () => {
    fs.mkdirSync(path.join(mindshub, 'tasks', 'task-existing'), { recursive: true });
    fs.chmodSync(mindshub, 0o755);

    await startTerminal('task-existing');

    expect(checkouts()).toEqual([]);
    expect(modeOf(mindshub)).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('is 0700 with the config seeded when git is missing', async () => {
    fake.gitMissing = true;

    await startTerminal('task-no-git');

    expect(modeOf(mindshub)).toBe(0o700);
    expect(fs.existsSync(path.join(mindshub, 'config', 'settings.json'))).toBe(true);
  });

  it('never runs icacls on linux', async () => {
    await ensureTaskWorktree(repo, 'task-linux', { platform: 'linux' });
    expect(icaclsCalls()).toEqual([]);
  });

  it('gets an owner-only access list on win32 before the checkout, once', async () => {
    await ensureTaskWorktree(repo, 'task-win-1', { platform: 'win32' });
    await ensureTaskWorktree(repo, 'task-win-2', { platform: 'win32' });

    expect(fake.steps).toEqual([
      { kind: 'icacls', args: [mindshub, ...ICACLS_ARGS] },
      { kind: 'checkout', folderMode: expect.any(Number), ownerOnlyMarker: true },
      { kind: 'checkout', folderMode: expect.any(Number), ownerOnlyMarker: true },
    ]);
  });

  it('gets the access list on win32 when an older build made it without the marker', async () => {
    fs.mkdirSync(path.join(mindshub, 'tasks', 'task-old'), { recursive: true });

    await ensureTaskWorktree(repo, 'task-old', { platform: 'win32' });

    expect(icaclsCalls()).toEqual([{ kind: 'icacls', args: [mindshub, ...ICACLS_ARGS] }]);
    expect(fs.existsSync(path.join(mindshub, OWNER_ONLY_ACCESS_MARKER))).toBe(true);
  });

  describe('when it is a link, which a repository can commit', () => {
    let outer: string;
    let parent: string;
    let elsewhere: string;

    beforeEach(() => {
      fs.rmSync(repo, { recursive: true, force: true });
      outer = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-outer-'));
      parent = path.join(outer, 'parent');
      repo = path.join(parent, 'repo');
      elsewhere = path.join(outer, 'elsewhere');
      for (const dir of [parent, repo, elsewhere]) {
        fs.mkdirSync(dir, { recursive: true });
        fs.chmodSync(dir, 0o755);
      }
      mindshub = path.join(repo, '.claude-mindshub');
    });

    afterEach(() => {
      fs.rmSync(outer, { recursive: true, force: true });
    });

    it.skipIf(process.platform === 'win32').each([
      ['the folder above the repository', '..'],
      ['the repository itself', '.'],
      ['a folder outside the repository', '../../elsewhere'],
    ])('leaves %s at its mode', async (_where, target) => {
      fs.symlinkSync(target, mindshub);

      await ensureTaskWorktree(repo, 'task-link', { platform: 'linux' }).catch(() => undefined);

      expect(fs.lstatSync(mindshub).isSymbolicLink()).toBe(true);
      expect([modeOf(parent), modeOf(repo), modeOf(elsewhere)]).toEqual([0o755, 0o755, 0o755]);
    });

    it.skipIf(process.platform === 'win32')('gives the link target no access list on win32', async () => {
      fs.symlinkSync(elsewhere, mindshub);

      await ensureTaskWorktree(repo, 'task-link', { platform: 'win32' }).catch(() => undefined);

      expect(icaclsCalls()).toEqual([]);
      expect(fs.existsSync(path.join(elsewhere, OWNER_ONLY_ACCESS_MARKER))).toBe(false);
    });
  });

  it('still checks the worktree out when icacls fails, and tries again next time', async () => {
    fake.icaclsFails = true;

    const worktree = await ensureTaskWorktree(repo, 'task-acl-failed', { platform: 'win32' });
    await ensureTaskWorktree(repo, 'task-acl-retry', { platform: 'win32' });

    expect(worktree).toEqual({ path: path.join(mindshub, 'tasks', 'task-acl-failed'), isNew: true });
    expect(checkouts()).toHaveLength(2);
    expect(icaclsCalls()).toHaveLength(2);
    expect(fs.existsSync(path.join(mindshub, OWNER_ONLY_ACCESS_MARKER))).toBe(false);
  });
});
