import { diagnostic } from '../shared/diagnostics';

// Ctrl-C under `npm run dev` delivers SIGINT to Electron main several times at
// once: from the terminal's process group, from electron's cli.js wrapper, and
// from concurrently's tree-kill. Electron's own handler allows one graceful
// shutdown and then falls back to the default action, so the second signal
// killed main mid-drain and orphaned the sidecar, which runs in its own process
// group and never sees the Ctrl-C.
//
// Route termination signals through the normal quit (and so the before-quit
// server drain) exactly once, and swallow repeats. A repeat must not call quit
// again: before-quit lets a quit through once the drain has started, which
// would end the process before the sidecar is stopped.
//
// Register only once the app is ready. Electron installs its native signal
// handlers during startup, after app.ts's top level runs, and they replace any
// handler installed before them. Registered at the top level, ours never ran
// and a repeat signal still killed main mid-drain.
export const QUIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export async function installQuitSignalHandlers(
  app: { whenReady: () => Promise<unknown>; quit: () => void },
  proc: Pick<NodeJS.Process, 'on'> = process,
): Promise<void> {
  await app.whenReady();
  let signalled = false;
  for (const signal of QUIT_SIGNALS) {
    proc.on(signal, () => {
      if (signalled) return;
      signalled = true;
      diagnostic('main.quit-signals', 'INFO', 'quit_signal_received', { exit_signal: signal });
      app.quit();
    });
  }
}
