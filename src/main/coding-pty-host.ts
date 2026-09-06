// Run only in an Electron utilityProcess. node-pty spawn crashed the multithreaded main process.
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

// Bound the wait so a silent CLI still receives the opening prompt.
const FIRST_OUTPUT_FALLBACK_MS = 1500;
// First output can precede raw/alt-screen setup; allow the TUI time to finish switching.
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

// Surface asynchronous spawn errors that escape the per-message try/catch.
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

        // Wait for the TUI before typing to prevent the PTY line discipline echoing the opening
        // prompt twice.
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
