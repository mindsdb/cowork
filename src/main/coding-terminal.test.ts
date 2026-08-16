import { describe, it, expect, vi, beforeEach } from 'vitest';

const detectClaudeCodeMock = vi.hoisted(() => vi.fn());
const revealMindsApiKeyMock = vi.hoisted(() => vi.fn());
vi.mock('./coding-mode', () => ({
  detectClaudeCode: detectClaudeCodeMock,
  revealMindsApiKey: revealMindsApiKeyMock,
}));

vi.mock('./uv-paths', () => ({
  getEnvPath: () => '/fake/path',
}));

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node-pty', () => ({
  spawn: spawnMock,
}));

function fakePty() {
  const handlers: { data?: (d: string) => void; exit?: (e: { exitCode: number }) => void } = {};
  return {
    onData: (cb: (d: string) => void) => { handlers.data = cb; },
    onExit: (cb: (e: { exitCode: number }) => void) => { handlers.exit = cb; },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    _handlers: handlers,
  };
}

function fakeSender() {
  return { send: vi.fn() } as any;
}

describe('coding-terminal', () => {
  beforeEach(async () => {
    vi.resetModules();
    spawnMock.mockReset();
    detectClaudeCodeMock.mockReset();
    revealMindsApiKeyMock.mockReset();
    detectClaudeCodeMock.mockResolvedValue({ installed: true, path: '/usr/local/bin/claude' });
    revealMindsApiKeyMock.mockResolvedValue('mdb_test_token');
  });

  it('spawns a PTY and reports ok on first start', async () => {
    const { startCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    const sender = fakeSender();

    const result = await startCodingTerminal('task-1', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);

    expect(result).toEqual({ ok: true });
    expect(spawnMock).toHaveBeenCalledWith('/usr/local/bin/claude', ['--model', 'kimi', 'hi'], expect.objectContaining({
      cwd: '/proj',
      cols: 80,
      rows: 24,
      env: expect.objectContaining({
        ANTHROPIC_BASE_URL: 'https://api.mindshub.ai',
        ANTHROPIC_AUTH_TOKEN: 'mdb_test_token',
        PATH: '/fake/path',
      }),
    }));
    expect(isCodingTerminalRunning('task-1')).toBe(true);
  });

  it('is a no-op reconnect when a session for the task is already running', async () => {
    const { startCodingTerminal } = await import('./coding-terminal');
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    const sender = fakeSender();

    await startCodingTerminal('task-1', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);
    const result = await startCodingTerminal('task-1', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);

    expect(result).toEqual({ ok: true });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('fails when the claude CLI is not installed', async () => {
    detectClaudeCodeMock.mockResolvedValue({ installed: false, path: null });
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-2', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails when no MindsHub API key is configured', async () => {
    revealMindsApiKeyMock.mockResolvedValue(null);
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-3', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('streams PTY data to the renderer and cleans up on exit', async () => {
    const { startCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    const sender = fakeSender();

    await startCodingTerminal('task-4', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);
    proc._handlers.data?.('hello from claude');
    expect(sender.send).toHaveBeenCalledWith('coding:terminal-data', 'task-4', 'hello from claude');

    proc._handlers.exit?.({ exitCode: 0 });
    expect(sender.send).toHaveBeenCalledWith('coding:terminal-exit', 'task-4', 0);
    expect(isCodingTerminalRunning('task-4')).toBe(false);
  });

  it('writes input and forwards resize to the right session', async () => {
    const { startCodingTerminal, writeToCodingTerminal, resizeCodingTerminal } = await import('./coding-terminal');
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    await startCodingTerminal('task-5', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, fakeSender());

    writeToCodingTerminal('task-5', 'ls\n');
    resizeCodingTerminal('task-5', 100, 40);

    expect(proc.write).toHaveBeenCalledWith('ls\n');
    expect(proc.resize).toHaveBeenCalledWith(100, 40);
  });

  it('kill removes the session and calls proc.kill', async () => {
    const { startCodingTerminal, killCodingTerminal, isCodingTerminalRunning } = await import('./coding-terminal');
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    await startCodingTerminal('task-6', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, fakeSender());

    killCodingTerminal('task-6');

    expect(proc.kill).toHaveBeenCalled();
    expect(isCodingTerminalRunning('task-6')).toBe(false);
  });

  it('killAllCodingTerminals kills every running session', async () => {
    const { startCodingTerminal, killAllCodingTerminals, isCodingTerminalRunning } = await import('./coding-terminal');
    const procA = fakePty();
    const procB = fakePty();
    spawnMock.mockReturnValueOnce(procA).mockReturnValueOnce(procB);
    await startCodingTerminal('task-a', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, fakeSender());
    await startCodingTerminal('task-b', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, fakeSender());

    killAllCodingTerminals();

    expect(procA.kill).toHaveBeenCalled();
    expect(procB.kill).toHaveBeenCalled();
    expect(isCodingTerminalRunning('task-a')).toBe(false);
    expect(isCodingTerminalRunning('task-b')).toBe(false);
  });

  it('reports unavailable when node-pty fails to load', async () => {
    vi.doMock('node-pty', () => {
      throw new Error('native module missing');
    });
    const { startCodingTerminal } = await import('./coding-terminal');
    const sender = fakeSender();

    const result = await startCodingTerminal('task-7', { projectPath: '/proj', message: 'hi', model: 'kimi' }, 80, 24, sender);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not available/i);
  });
});
