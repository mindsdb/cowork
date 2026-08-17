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
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

// Cap on waiting for the CLI's first output before typing the opening
// message anyway — a CLI that never produces output for some reason
// shouldn't leave the prompt permanently untyped.
const FIRST_OUTPUT_FALLBACK_MS = 1500;
// Once real output starts, give the TUI a moment to actually finish
// switching into raw/alt-screen mode before typing — the first chunk is
// typically just the start of that switch, not the end of it.
const POST_FIRST_OUTPUT_DELAY_MS = 150;

let proc: PtyProcess | null = null;

function reportError(err: unknown, where: string) {
  const e = err as any;
  parentPort.postMessage({
    type: 'error',
    reason: e?.message || String(e),
    where,
    stack: e?.stack || null,
  });
}

// Diagnostic-only: a mistyped `msg.args`/`msg.env` entry could throw
// asynchronously (outside the per-message try/catch below) — surface it
// instead of silently dying with no signal to the main process.
process.on('uncaughtException', (err) => reportError(err, 'uncaughtException'));
process.on('unhandledRejection', (err) => reportError(err, 'unhandledRejection'));

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

        // Typed immediately, this would land while the PTY's own line
        // discipline is still echoing keystrokes as plain text — claude
        // hasn't switched into raw/alt-screen mode yet at the instant
        // spawn() returns. Waiting for its first real output (a sign it's
        // actually drawing) before typing avoids the opening message
        // appearing twice: once as stray echoed text above the TUI, once
        // in the TUI's own prompt.
        if (typeof msg.initialInput === 'string' && msg.initialInput) {
          const initialInput = msg.initialInput;
          let sent = false;
          const send = () => {
            if (sent || !proc) return;
            sent = true;
            proc.write(initialInput);
          };
          const fallback = setTimeout(send, FIRST_OUTPUT_FALLBACK_MS);
          const onFirstOutput = proc.onData(() => {
            clearTimeout(fallback);
            onFirstOutput.dispose();
            setTimeout(send, POST_FIRST_OUTPUT_DELAY_MS);
          });
        }
      } catch (err) {
        reportError(err, 'start');
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
