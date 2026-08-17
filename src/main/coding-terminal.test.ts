import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const detectClaudeCodeMock = vi.hoisted(() => vi.fn());
const revealMindsApiKeyMock = vi.hoisted(() => vi.fn());
const revealMindsBaseUrlMock = vi.hoisted(() => vi.fn());
vi.mock('./coding-mode', () => ({
  detectClaudeCode: detectClaudeCodeMock,
  revealMindsApiKey: revealMindsApiKeyMock,
  revealMindsBaseUrl: revealMindsBaseUrlMock,
}));

vi.mock('./uv-paths', () => ({
  getEnvPath: () => '/fake/path',
}));

const ensureTaskWorktreeMock = vi.hoisted(() => vi.fn());
const removeTaskWorktreeMock = vi.hoisted(() => vi.fn());
vi.mock('./coding-workspace', () => ({
  ensureTaskWorktree: ensureTaskWorktreeMock,
  removeTaskWorktree: removeTaskWorktreeMock,
}));

const fsStore = vi.hoisted(() => new Map<string, string>());
vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  readFileSync: (p: string) => {
    if (!fsStore.has(p)) {
      const err: any = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    }
    return fsStore.get(p);
  },
  writeFileSync: (p: string, data: string) => {
    fsStore.set(p, data);
  },
  // No real symlinks in these fake paths — identity is the correct
  // "resolved" path for every test here.
  realpathSync: (p: string) => p,
}));

class FakeUtilityProcess extends EventEmitter {
  postMessage = vi.fn();
  kill = vi.fn();
}

const forkMock = vi.hoisted(() => vi.fn());
vi.mock('electron', () => ({
  utilityProcess: { fork: forkMock },
}));

function fakeSender() {
  return { send: vi.fn() } as any;
}

// startCodingTerminal awaits detectClaudeCode/revealMindsApiKey (both mocked
// promises) before registering listeners and posting 'start' — wait for that
// to actually happen before emitting host-process events at it.
async function waitForStartPosted(child: FakeUtilityProcess) {
  await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' })));
}

describe('coding-terminal', () => {
  beforeEach(async () => {
    vi.resetModules();
    forkMock.mockReset();
    detectClaudeCodeMock.mockReset();
    revealMindsApiKeyMock.mockReset();
    revealMindsBaseUrlMock.mockReset();
    fsStore.clear();
    detectClaudeCodeMock.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    revealMindsApiKeyMock.mockResolvedValue('mdb_test_token');
    revealMindsBaseUrlMock.mockResolvedValue('https://api.staging.mindshub.ai');
    ensureTaskWorktreeMock.mockReset();
    removeTaskWorktreeMock.mockReset();
    ensureTaskWorktreeMock.mockImplementation(async (repoPath: string, taskId: string) => ({
      path: `${repoPath}/.claude-mindshub/tasks/${taskId}`,
      isNew: true,
    }));
    removeTaskWorktreeMock.mockResolvedValue(undefined);
  });

  it('forks the pty host and reports ok once it acks "started"', async () => {
    const { startCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const sender = fakeSender();

    const resultPromise = startCodingTerminal('task-1', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    const result = await resultPromise;

    expect(result).toEqual({ ok: true });
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'start',
      claudePath: '/usr/local/bin/claude',
      args: ['--model', 'kimi'],
      cwd: '/proj/.claude-mindshub/tasks/task-1',
      env: expect.objectContaining({
        ANTHROPIC_BASE_URL: 'https://api.staging.mindshub.ai',
        ANTHROPIC_AUTH_TOKEN: 'mdb_test_token',
        PATH: '/fake/path',
        CLAUDE_CONFIG_DIR: '/proj/.claude-mindshub/config',
        CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
      }),
    }));
    expect(isCodingTerminalRunning('task-1')).toBe(true);
  });

  it('strips inherited CLAUDE_CODE_*/ANTHROPIC_* vars so a nested session cannot leak in', async () => {
    // e.g. this exact scenario in dev: launching the app from inside a
    // Claude Code session's own shell inherits CLAUDE_CODE_CHILD_SESSION,
    // which makes the embedded CLI think it's a child session and disables
    // its own transcript saving.
    process.env.CLAUDE_CODE_CHILD_SESSION = '1';
    process.env.CLAUDE_CODE_SESSION_ID = 'outer-session';
    process.env.CLAUDECODE = '1';
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    process.env.SOME_UNRELATED_VAR = 'keep-me';
    try {
      const { startCodingTerminal } = await import('./coding-terminal');
      const child = new FakeUtilityProcess();
      forkMock.mockReturnValue(child);

      const resultPromise = startCodingTerminal('task-clean-env', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
      await waitForStartPosted(child);
      child.emit('message', { type: 'started' });
      await resultPromise;

      const sentEnv = (child.postMessage.mock.calls.find((c: any[]) => c[0]?.type === 'start')?.[0] as any).env;
      expect(sentEnv.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
      expect(sentEnv.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(sentEnv.CLAUDECODE).toBeUndefined();
      expect(sentEnv.ANTHROPIC_API_KEY).toBeUndefined();
      expect(sentEnv.SOME_UNRELATED_VAR).toBe('keep-me');
      // Our own deliberate ANTHROPIC_* overrides still make it through.
      expect(sentEnv.ANTHROPIC_BASE_URL).toBe('https://api.staging.mindshub.ai');
      expect(sentEnv.ANTHROPIC_AUTH_TOKEN).toBe('mdb_test_token');
    } finally {
      delete process.env.CLAUDE_CODE_CHILD_SESSION;
      delete process.env.CLAUDE_CODE_SESSION_ID;
      delete process.env.CLAUDECODE;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.SOME_UNRELATED_VAR;
    }
  });

  it('seeds a fresh project config dir with a dark theme and onboarding already done', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-seed', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(JSON.parse(fsStore.get('/proj/.claude-mindshub/config/settings.json')!)).toEqual({ theme: 'dark' });
    expect(JSON.parse(fsStore.get('/proj/.claude-mindshub/config/.claude.json')!)).toEqual({
      hasCompletedOnboarding: true,
      projects: { '/proj/.claude-mindshub/tasks/task-seed': { hasTrustDialogAccepted: true } },
    });
  });

  it('does not clobber an existing config dir\'s other settings/state', async () => {
    fsStore.set('/proj/.claude-mindshub/config/settings.json', JSON.stringify({ theme: 'light', tui: 'fullscreen' }));
    fsStore.set('/proj/.claude-mindshub/config/.claude.json', JSON.stringify({ hasCompletedOnboarding: true, userID: 'abc' }));
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-preserve', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    // theme was already 'light' (a deliberate choice, e.g. via /theme) — must survive untouched
    expect(JSON.parse(fsStore.get('/proj/.claude-mindshub/config/settings.json')!)).toEqual({ theme: 'light', tui: 'fullscreen' });
    expect(JSON.parse(fsStore.get('/proj/.claude-mindshub/config/.claude.json')!)).toEqual({
      hasCompletedOnboarding: true,
      userID: 'abc',
      projects: { '/proj/.claude-mindshub/tasks/task-preserve': { hasTrustDialogAccepted: true } },
    });
  });

  it('does not re-mark trust for a cwd that already has it, and preserves other project entries', async () => {
    fsStore.set('/proj/.claude-mindshub/config/.claude.json', JSON.stringify({
      hasCompletedOnboarding: true,
      projects: {
        '/proj/.claude-mindshub/tasks/task-other': { hasTrustDialogAccepted: true, allowedTools: ['Bash'] },
        '/proj/.claude-mindshub/tasks/task-trust': { hasTrustDialogAccepted: true },
      },
    }));
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-trust', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(JSON.parse(fsStore.get('/proj/.claude-mindshub/config/.claude.json')!).projects).toEqual({
      '/proj/.claude-mindshub/tasks/task-other': { hasTrustDialogAccepted: true, allowedTools: ['Bash'] },
      '/proj/.claude-mindshub/tasks/task-trust': { hasTrustDialogAccepted: true },
    });
  });

  it('falls back to running directly in the project when worktree setup fails', async () => {
    ensureTaskWorktreeMock.mockRejectedValue(new Error('git not found'));
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-nogit', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    // Still treated as a first launch — the message is queued via
    // initialInput (the host delays actually typing it), not skipped.
    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/proj', args: ['--model', 'kimi'], initialInput: 'hi\r' }));
  });

  it('reconnecting to a task whose worktree already exists uses --continue and skips retyping the message', async () => {
    ensureTaskWorktreeMock.mockResolvedValue({ path: '/proj/.claude-mindshub/tasks/task-old', isNew: false });
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-old', { projectPath: '/proj', message: 'the original opening line', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/proj/.claude-mindshub/tasks/task-old',
      args: ['--model', 'kimi', '--continue'],
      initialInput: undefined,
    }));
  });

  it('is a no-op reconnect when a session for the task is already running', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const sender = fakeSender();

    const p1 = startCodingTerminal('task-1', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await p1;
    const result = await startCodingTerminal('task-1', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);

    expect(result).toEqual({ ok: true });
    expect(forkMock).toHaveBeenCalledTimes(1);
  });

  it('fails without spawning when no model was selected', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-nomodel', { projectPath: '/proj', message: '', model: '' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(forkMock).not.toHaveBeenCalled();
  });

  it('fails without spawning when model is an object instead of an id string', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    // A caller violating the TS contract (e.g. a bug in untyped renderer
    // code forwarding the model object instead of its id) is exactly what
    // this guard exists to catch — hence the deliberate `as any`.
    const badOpts = { projectPath: '/proj', message: '', model: { id: 'mindshub_air', name: 'MindsHub Air' } } as any;
    const result = await startCodingTerminal('task-objmodel', badOpts, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(forkMock).not.toHaveBeenCalled();
  });

  it('fails when the claude CLI is not installed', async () => {
    detectClaudeCodeMock.mockResolvedValue({ installed: false, path: null });
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-2', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(forkMock).not.toHaveBeenCalled();
  });

  it('fails when no MindsHub API key is configured', async () => {
    revealMindsApiKeyMock.mockResolvedValue(null);
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-3', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(forkMock).not.toHaveBeenCalled();
  });

  it('falls back to the prod inference host if minds_url is unavailable', async () => {
    revealMindsBaseUrlMock.mockResolvedValue(null);
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-fallback-url', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ ANTHROPIC_BASE_URL: 'https://api.mindshub.ai' }),
    }));
  });

  it('sends the opening message as initialInput on the start payload', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-msg', { projectPath: '/proj', message: 'build me a login form', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(child.postMessage).toHaveBeenCalledWith(expect.objectContaining({ initialInput: 'build me a login form\r' }));
  });

  it('streams PTY data to the renderer and cleans up on exit', async () => {
    const { startCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const sender = fakeSender();

    const resultPromise = startCodingTerminal('task-4', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, sender);
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    child.emit('message', { type: 'data', data: 'hello from claude' });
    expect(sender.send).toHaveBeenCalledWith('coding:terminal-data', 'task-4', 'hello from claude');

    child.emit('message', { type: 'exit', exitCode: 0 });
    expect(sender.send).toHaveBeenCalledWith('coding:terminal-exit', 'task-4', 0);
    expect(isCodingTerminalRunning('task-4')).toBe(false);
  });

  it('reports failure when the host process reports an error', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-5', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'error', reason: 'native module missing' });

    await expect(resultPromise).resolves.toEqual({ ok: false, reason: 'native module missing' });
  });

  it('reports failure when the host process exits before acking start', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-6', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('exit', 1);

    const result = await resultPromise;
    expect(result.ok).toBe(false);
  });

  it('writes input and forwards resize to the right session', async () => {
    const { startCodingTerminal, writeToCodingTerminal, resizeCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const resultPromise = startCodingTerminal('task-7', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;
    child.postMessage.mockClear();

    writeToCodingTerminal('task-7', 'ls\n');
    resizeCodingTerminal('task-7', 100, 40);

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'write', data: 'ls\n' });
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'resize', cols: 100, rows: 40 });
  });

  it('kill removes the session and kills the host process', async () => {
    const { startCodingTerminal, killCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const resultPromise = startCodingTerminal('task-8', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    killCodingTerminal('task-8');

    expect(child.kill).toHaveBeenCalled();
    expect(isCodingTerminalRunning('task-8')).toBe(false);
  });

  it('killAllCodingTerminals kills every running session', async () => {
    const { startCodingTerminal, killAllCodingTerminals, isCodingTerminalRunning } = await import('./coding-terminal');
    const childA = new FakeUtilityProcess();
    const childB = new FakeUtilityProcess();
    forkMock.mockReturnValueOnce(childA).mockReturnValueOnce(childB);
    const pA = startCodingTerminal('task-a', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(childA);
    childA.emit('message', { type: 'started' });
    await pA;
    const pB = startCodingTerminal('task-b', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(childB);
    childB.emit('message', { type: 'started' });
    await pB;

    killAllCodingTerminals();

    expect(childA.kill).toHaveBeenCalled();
    expect(childB.kill).toHaveBeenCalled();
    expect(isCodingTerminalRunning('task-a')).toBe(false);
    expect(isCodingTerminalRunning('task-b')).toBe(false);
  });

  it('removeCodingTask kills a running session and removes its worktree', async () => {
    const { startCodingTerminal, removeCodingTask, isCodingTerminalRunning } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);
    const resultPromise = startCodingTerminal('task-del', { projectPath: '/proj', message: '', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    await removeCodingTask('task-del', '/proj');

    expect(child.kill).toHaveBeenCalled();
    expect(isCodingTerminalRunning('task-del')).toBe(false);
    expect(removeTaskWorktreeMock).toHaveBeenCalledWith('/proj', 'task-del');
  });
});
