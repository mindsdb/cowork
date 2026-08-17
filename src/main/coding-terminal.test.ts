import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const detectClaudeCodeMock = vi.hoisted(() => vi.fn());
const revealMindsApiKeyMock = vi.hoisted(() => vi.fn());
vi.mock('./coding-mode', () => ({
  detectClaudeCode: detectClaudeCodeMock,
  revealMindsApiKey: revealMindsApiKeyMock,
}));

vi.mock('./uv-paths', () => ({
  getEnvPath: () => '/fake/path',
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
    detectClaudeCodeMock.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    revealMindsApiKeyMock.mockResolvedValue('mdb_test_token');
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
      cwd: '/proj',
      env: expect.objectContaining({
        ANTHROPIC_BASE_URL: 'https://api.mindshub.ai',
        ANTHROPIC_AUTH_TOKEN: 'mdb_test_token',
        PATH: '/fake/path',
        CLAUDE_CONFIG_DIR: '/proj/.claude-mindshub',
      }),
    }));
    expect(isCodingTerminalRunning('task-1')).toBe(true);
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

  it('types the opening message into stdin once the host is up', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const child = new FakeUtilityProcess();
    forkMock.mockReturnValue(child);

    const resultPromise = startCodingTerminal('task-msg', { projectPath: '/proj', message: 'build me a login form', model: 'kimi' }, 80, 24, fakeSender());
    await waitForStartPosted(child);
    child.emit('message', { type: 'started' });
    await resultPromise;

    expect(child.postMessage).toHaveBeenCalledWith({ type: 'write', data: 'build me a login form\r' });
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
});
