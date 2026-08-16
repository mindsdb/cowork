// Runs as a separate Electron `utilityProcess` — deliberately NOT inline in the
// main process. node-pty's native spawn (forkpty/fork+exec under the hood)
// reliably crashed the whole app (a heap-corruption SIGTRAP inside PtyFork's
// argv/env cleanup) when called from Electron's main process, but never in an
// isolated repro — the main process is heavily multithreaded (GPU/network/
// libuv workers, an already-spawned cowork-server child, Cocoa's main runloop)
// and fork() is fundamentally unsafe under that kind of load. A utility
// process is a lean, separate OS process with none of that surrounding
// activity, which is exactly why VS Code and other Electron terminal apps run
// their pty host out-of-process instead of inline. This file only ever runs
// inside that child process — never imported by the main process directly.
type ParentPort = {
  on(event: 'message', listener: (e: { data: any }) => void): void;
  postMessage(message: any): void;
};

const parentPort: ParentPort = (process as unknown as { parentPort: ParentPort }).parentPort;

interface PtyProcess {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

let proc: PtyProcess | null = null;

parentPort.on('message', async (e) => {
  const msg = e.data;
  switch (msg?.type) {
    case 'start': {
      try {
        const pty = await import('node-pty');
        proc = pty.spawn(msg.claudePath, msg.args, {
          name: 'xterm-256color',
          cols: msg.cols,
          rows: msg.rows,
          cwd: msg.cwd,
          env: msg.env,
        });
        proc.onData((data) => parentPort.postMessage({ type: 'data', data }));
        proc.onExit(({ exitCode }) => parentPort.postMessage({ type: 'exit', exitCode }));
        parentPort.postMessage({ type: 'started' });
      } catch (err: any) {
        parentPort.postMessage({ type: 'error', reason: err?.message || String(err) });
      }
      break;
    }
    case 'write':
      proc?.write(msg.data);
      break;
    case 'resize':
      proc?.resize(msg.cols, msg.rows);
      break;
    case 'kill':
      try { proc?.kill(); } catch { /* already gone */ }
      break;
  }
});

export {};
