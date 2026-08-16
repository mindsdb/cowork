import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node-pty', () => ({ spawn: spawnMock }));

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

    proc._handlers.data?.('hello');
    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: 'data', data: 'hello' });

    proc._handlers.exit?.({ exitCode: 0 });
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
});
