import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('./server-process', () => ({
  getServerPort: () => 26866,
}));
vi.mock('./server-auth', () => ({
  authHeader: () => ({}),
}));

const findOnPathMock = vi.hoisted(() => vi.fn());
vi.mock('./uv-paths', () => ({
  findOnPath: findOnPathMock,
}));

const spawnCalls = vi.hoisted(() => [] as any[]);
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', async (importActual) => {
  const actual = await importActual<typeof import('child_process')>();
  return { ...actual, spawn: spawnMock };
});

import { shQuote, detectClaudeCode, launchCodingTask } from './coding-mode';

// shQuote is the security-critical piece: Terminal.app's `do script` runs in
// a shell it spawns itself, not a child of this process, so every
// interpolated value (secret, task message) has to be a literal in the
// script text — safety rests entirely on this escaping being correct
// regardless of what the value contains.
describe('shQuote', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shQuote('hello')).toBe(`'hello'`);
  });

  it.each([
    `it's a test`,
    `$(rm -rf /) \`whoami\` "quoted" ; echo pwned && true`,
    `line1\nline2`,
    `'''triple quotes'''`,
    '',
  ])('round-trips arbitrary content through a real shell: %s', (input) => {
    const echoed = execSync(`printf '%s' ${shQuote(input)}`).toString();
    expect(echoed).toBe(input);
  });
});

describe('detectClaudeCode', () => {
  beforeEach(() => findOnPathMock.mockReset());

  it('reports installed with the resolved path when found', async () => {
    findOnPathMock.mockResolvedValue('/usr/local/bin/claude');
    await expect(detectClaudeCode()).resolves.toEqual({
      installed: true,
      path: '/usr/local/bin/claude',
    });
  });

  it('reports not installed when absent from PATH', async () => {
    findOnPathMock.mockResolvedValue(null);
    await expect(detectClaudeCode()).resolves.toEqual({ installed: false, path: null });
  });
});

describe('launchCodingTask', () => {
  let projectDir: string;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-task-project-'));
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    spawnCalls.length = 0;
    spawnMock.mockReset();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  function setPlatform(value: string) {
    Object.defineProperty(process, 'platform', { value });
  }

  it('rejects on non-macOS platforms before touching the network', async () => {
    setPlatform('win32');
    const result = await launchCodingTask({ projectPath: projectDir, message: 'hi', model: 'kimi' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/macOS/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects a project folder that does not exist', async () => {
    setPlatform('darwin');
    const result = await launchCodingTask({
      projectPath: path.join(projectDir, 'does-not-exist'),
      message: 'hi',
      model: 'kimi',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('rejects an empty task message', async () => {
    setPlatform('darwin');
    const result = await launchCodingTask({ projectPath: projectDir, message: '   ', model: 'kimi' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/);
  });

  it('rejects when no MindsHub API key is configured', async () => {
    setPlatform('darwin');
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ value: '' }) });
    const result = await launchCodingTask({ projectPath: projectDir, message: 'hi', model: 'kimi' });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/MindsHub API key/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('writes a private, self-deleting script and opens Terminal via osascript on success', async () => {
    setPlatform('darwin');
    (globalThis.fetch as any).mockResolvedValue({ ok: true, json: async () => ({ value: 'mdb_test_token' }) });
    const emitter: any = { stderr: { on: vi.fn() }, on: vi.fn() };
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        const exitHandler = emitter.on.mock.calls.find((c: any[]) => c[0] === 'exit')?.[1];
        exitHandler?.(0);
      });
      return emitter;
    });

    const result = await launchCodingTask({
      projectPath: projectDir,
      message: `has "quotes" and $(command) substitution`,
      model: 'kimi',
    });

    expect(result).toEqual({ ok: true });
    expect(spawnMock).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-e']));
    const [, args] = spawnMock.mock.calls[0];
    expect(args[1]).toContain('Terminal');
  });
});
