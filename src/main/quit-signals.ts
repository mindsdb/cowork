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
export const QUIT_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export function installQuitSignalHandlers(
  quit: () => void,
  proc: Pick<NodeJS.Process, 'on'> = process,
): void {
  let signalled = false;
  for (const signal of QUIT_SIGNALS) {
    proc.on(signal, () => {
      if (signalled) return;
      signalled = true;
      console.log(`[app] received ${signal}; stopping the server before quitting`);
      quit();
    });
  }
}
