// Minimal Chrome DevTools Protocol (CDP) client for the Browser Control
// bridge (M1). Deliberately tiny — a thin `ws` wrapper — rather than
// puppeteer/playwright: read-only M1 only needs id-correlated `send()`,
// event dispatch, and clean close.
//
// Transport: one WebSocket to a target's `webSocketDebuggerUrl` (discovered
// via Chrome's /json/list on loopback). Requests are correlated by an
// incrementing integer `id`; events (no `id`, a `method` + `params`) are
// dispatched to per-method listeners. Everything is loopback-only; the socket
// lives in the Electron main process and never touches the renderer.

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

// Injected transport factory so tests can supply a fake socket (network is
// denied in the test env; a real socket would fail loudly).
export type WebSocketFactory = (url: string) => CdpSocket;

// The minimal socket surface the client relies on (a subset of `ws`).
export interface CdpSocket {
  send(data: string): void;
  close(): void;
  on(event: 'open' | 'close' | 'error', cb: (arg?: unknown) => void): void;
  on(event: 'message', cb: (data: unknown) => void): void;
}

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  method: string;
}

export interface CdpClientOptions {
  // Override the transport (tests). Defaults to a real `ws` WebSocket.
  wsFactory?: WebSocketFactory;
  // Per-command timeout in ms. A hung command rejects rather than hanging.
  commandTimeoutMs?: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 15000;

// Default factory: a real `ws` socket adapted to the CdpSocket shape.
function realWsFactory(url: string): CdpSocket {
  const socket = new WebSocket(url);
  return {
    send: (data: string) => socket.send(data),
    close: () => socket.close(),
    on: (event: string, cb: (arg?: unknown) => void) => {
      if (event === 'message') {
        socket.on('message', (data: WebSocket.RawData) => cb(data.toString()));
      } else {
        socket.on(event as 'open' | 'close' | 'error', (arg?: unknown) => cb(arg));
      }
    },
  } as CdpSocket;
}

// A single CDP connection to one target's debugger URL. `emit('event', ...)`
// is used internally; consumers use `on(method, cb)` for CDP events and
// `send(method, params)` for commands.
export class CdpClient extends EventEmitter {
  private socket: CdpSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly commandTimeoutMs: number;
  private readonly wsFactory: WebSocketFactory;
  private closed = false;

  constructor(opts: CdpClientOptions = {}) {
    super();
    this.wsFactory = opts.wsFactory ?? realWsFactory;
    this.commandTimeoutMs = opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  // Open the socket to a target's webSocketDebuggerUrl. Resolves on 'open',
  // rejects on early 'error'/'close'.
  connect(webSocketDebuggerUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.wsFactory(webSocketDebuggerUrl);
      this.socket = socket;

      socket.on('open', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      socket.on('message', (data: unknown) => this.handleMessage(String(data)));
      socket.on('close', () => {
        this.handleClose();
        if (!settled) {
          settled = true;
          reject(new Error('CDP socket closed before open'));
        }
      });
      socket.on('error', (err: unknown) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
        this.emit('socket-error', err);
      });
    });
  }

  // Issue a CDP command; resolves with the `result` object or rejects with
  // the CDP `error.message` / a timeout.
  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.closed || !this.socket) {
      return Promise.reject(new Error('CDP client is not connected'));
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }
      }, this.commandTimeoutMs);
      this.pending.set(id, {
        method,
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      try {
        this.socket!.send(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(raw: string): void {
    let msg: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || `CDP error for ${pending.method}`));
      } else {
        pending.resolve(msg.result ?? {});
      }
      return;
    }
    // An event: dispatch to `method` listeners (e.g. Target.targetDestroyed,
    // Page.frameNavigated).
    if (msg.method) {
      this.emit(msg.method, msg.params ?? {});
    }
  }

  private handleClose(): void {
    if (this.closed) return;
    // Reject any in-flight commands so callers don't hang.
    for (const [, pending] of this.pending) {
      pending.reject(new Error('CDP socket closed'));
    }
    this.pending.clear();
    this.emit('close');
  }

  // Close the socket and reject in-flight commands. Idempotent.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, pending] of this.pending) {
      pending.reject(new Error('CDP client closed'));
    }
    this.pending.clear();
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
