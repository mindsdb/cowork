import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node-pty', () => ({ spawn: spawnMock }));

function fakePty() {
  // Real node-pty's onData supports multiple independent listeners (each
  // call adds one, returning its own disposable) — coding-pty-host.ts
  // registers a second one-shot listener for initialInput timing
  // alongside the data-forwarding one, so a mock that only remembers the
  // latest callback would silently drop the first.
  const dataListeners: Array<(d: string) => void> = [];
  let exitListener: ((e: { exitCode: number }) => void) | undefined;
  return {
    onData: (cb: (d: string) => void) => {
      dataListeners.push(cb);
      return { dispose: () => {
        const i = dataListeners.indexOf(cb);
        if (i >= 0) dataListeners.splice(i, 1);
      } };
    },
    onExit: (cb: (e: { exitCode: number }) => void) => { exitListener = cb; },
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (d: string) => dataListeners.forEach((l) => l(d)),
    emitExit: (e: { exitCode: number }) => exitListener?.(e),
  };
}

class FakeParentPort extends EventEmitter {
  postMessage = vi.fn();
  on(event: 'message', listener: (e: { data: any }) => void) {
    return super.on(event, listener);
  }
  send(data: any) {
    this.emit('message', { data });
  }
}

describe('coding-pty-host', () => {
  let parentPort: FakeParentPort;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('node-pty', () => ({ spawn: spawnMock }));
    spawnMock.mockReset();
    parentPort = new FakeParentPort();
    (process as any).parentPort = parentPort;
    await import('./coding-pty-host');
  });

  it('spawns via node-pty and acks started, forwarding data/exit', async () => {
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);

    parentPort.send({ type: 'start', claudePath: '/bin/claude', args: ['--model', 'kimi'], cwd: '/proj', cols: 80, rows: 24, env: { FOO: 'bar' } });
    await vi.waitFor(() => expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'started' }));

    expect(spawnMock).toHaveBeenCalledWith('/bin/claude', ['--model', 'kimi'], expect.objectContaining({
      cwd: '/proj', cols: 80, rows: 24, env: { FOO: 'bar' },
    }));
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'started' });

    proc.emitData('hello');
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'data', data: 'hello' });

    proc.emitExit({ exitCode: 0 });
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'exit', exitCode: 0 });
  });

  it('posts an error message instead of crashing when node-pty fails to load', async () => {
    vi.doMock('node-pty', () => { throw new Error('native module missing'); });
    vi.resetModules();
    parentPort = new FakeParentPort();
    (process as any).parentPort = parentPort;
    await import('./coding-pty-host');

    parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {} });
    await vi.waitFor(() => expect(parentPort.postMessage).toHaveBeenCalled());

    expect(parentPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('routes write/resize/kill to the spawned pty', async () => {
    const proc = fakePty();
    spawnMock.mockReturnValue(proc);
    parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {} });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    parentPort.send({ type: 'write', data: 'ls\n' });
    parentPort.send({ type: 'resize', cols: 100, rows: 40 });
    parentPort.send({ type: 'kill' });

    expect(proc.write).toHaveBeenCalledWith('ls\n');
    expect(proc.resize).toHaveBeenCalledWith(100, 40);
    expect(proc.kill).toHaveBeenCalled();
  });

  describe('initialInput timing', () => {
    // Typed immediately at spawn, initialInput would land while the PTY's
    // own line discipline is still echoing keystrokes as plain text —
    // claude hasn't switched into raw/alt-screen mode yet the instant
    // spawn() returns. These lock in the fix: wait for real output first.
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not type initialInput until the CLI produces real output, then waits a short beat', async () => {
      vi.useFakeTimers();
      const proc = fakePty();
      spawnMock.mockReturnValue(proc);

      parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {}, initialInput: 'hi\r' });
      await vi.advanceTimersByTimeAsync(0); // let the mocked `await import('node-pty')` resolve
      expect(spawnMock).toHaveBeenCalled();
      expect(proc.write).not.toHaveBeenCalled();

      proc.emitData('splash screen output');
      expect(proc.write).not.toHaveBeenCalled(); // still not yet — one more short beat
      await vi.advanceTimersByTimeAsync(150);
      expect(proc.write).toHaveBeenCalledWith('hi\r');
    });

    it('falls back to sending initialInput after a timeout if the CLI never produces output', async () => {
      vi.useFakeTimers();
      const proc = fakePty();
      spawnMock.mockReturnValue(proc);

      parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {}, initialInput: 'hi\r' });
      await vi.advanceTimersByTimeAsync(0);
      expect(proc.write).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1500);
      expect(proc.write).toHaveBeenCalledWith('hi\r');
    });

    it('does not double-send if both the first-output path and the fallback timer could fire', async () => {
      vi.useFakeTimers();
      const proc = fakePty();
      spawnMock.mockReturnValue(proc);

      parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {}, initialInput: 'hi\r' });
      await vi.advanceTimersByTimeAsync(0);
      proc.emitData('output');
      await vi.advanceTimersByTimeAsync(150);
      expect(proc.write).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1500); // fallback timer was cleared — must not fire again
      expect(proc.write).toHaveBeenCalledTimes(1);
    });

    it('never calls write when no initialInput is given', async () => {
      vi.useFakeTimers();
      const proc = fakePty();
      spawnMock.mockReturnValue(proc);

      parentPort.send({ type: 'start', claudePath: '/bin/claude', args: [], cwd: '/proj', cols: 80, rows: 24, env: {} });
      await vi.advanceTimersByTimeAsync(0);
      proc.emitData('output');
      await vi.advanceTimersByTimeAsync(2000);

      expect(proc.write).not.toHaveBeenCalled();
    });
  });
});
