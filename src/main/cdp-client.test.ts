import { describe, it, expect, vi } from 'vitest';
import { CdpClient, type CdpSocket } from './cdp-client';

// A controllable fake CDP socket: captures sent frames, lets a test drive
// open/message/close/error. No real network (denied in the test env).
class FakeSocket implements CdpSocket {
  sent: string[] = [];
  closed = false;
  private handlers: Record<string, ((arg?: unknown) => void)[]> = {};

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
    this.fire('close');
  }
  on(event: string, cb: (arg?: unknown) => void): void {
    (this.handlers[event] ||= []).push(cb);
  }
  fire(event: string, arg?: unknown): void {
    for (const cb of this.handlers[event] || []) cb(arg);
  }
  // Simulate a CDP reply/event coming back over the wire.
  reply(obj: unknown): void {
    this.fire('message', JSON.stringify(obj));
  }
}

function connectedClient(): { client: CdpClient; socket: FakeSocket } {
  const socket = new FakeSocket();
  const client = new CdpClient({ wsFactory: () => socket, commandTimeoutMs: 50 });
  const p = client.connect('ws://127.0.0.1:9333/devtools/page/ABC');
  socket.fire('open');
  return { client, socket, connectPromise: p } as unknown as {
    client: CdpClient;
    socket: FakeSocket;
  };
}

describe('CdpClient', () => {
  it('resolves connect() on open and correlates a command by id', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket, commandTimeoutMs: 500 });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;

    const cmd = client.send('Page.enable', {});
    // one frame was sent, with id + method
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]);
    expect(frame.method).toBe('Page.enable');
    expect(frame.id).toBe(1);

    socket.reply({ id: frame.id, result: { ok: true } });
    await expect(cmd).resolves.toEqual({ ok: true });
  });

  it('rejects a command when CDP returns an error', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket, commandTimeoutMs: 500 });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;

    const cmd = client.send('DOM.getDocument');
    const frame = JSON.parse(socket.sent[0]);
    socket.reply({ id: frame.id, error: { message: 'boom' } });
    await expect(cmd).rejects.toThrow('boom');
  });

  it('dispatches CDP events (no id) to method listeners', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;

    const onDestroyed = vi.fn();
    client.on('Target.targetDestroyed', onDestroyed);
    socket.reply({ method: 'Target.targetDestroyed', params: { targetId: 'ABC' } });
    expect(onDestroyed).toHaveBeenCalledWith({ targetId: 'ABC' });
  });

  it('times out a hung command', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket, commandTimeoutMs: 10 });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;
    await expect(client.send('Runtime.evaluate')).rejects.toThrow(/timed out/);
  });

  it('rejects in-flight commands when the socket closes', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket, commandTimeoutMs: 1000 });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;
    const cmd = client.send('Runtime.evaluate');
    socket.fire('close');
    await expect(cmd).rejects.toThrow(/closed/);
  });

  it('close() is idempotent and rejects further sends', async () => {
    const socket = new FakeSocket();
    const client = new CdpClient({ wsFactory: () => socket });
    const connected = client.connect('ws://x');
    socket.fire('open');
    await connected;
    client.close();
    client.close();
    expect(socket.closed).toBe(true);
    await expect(client.send('Page.enable')).rejects.toThrow(/not connected/);
  });
});
