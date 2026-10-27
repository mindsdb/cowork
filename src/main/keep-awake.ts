import { ipcMain, powerSaveBlocker, type WebContents } from 'electron';
import { IPC } from '../shared/ipc-channels';

// Holds off system sleep while a scheduled task is running or about to fire,
// so a laptop left idle doesn't sleep through the run. The display may still
// sleep, and an explicit sleep or a closed lid still sleeps the machine:
// 'prevent-app-suspension' only stops idle sleep. Nothing here wakes a
// machine that is already asleep.
//
// The renderer decides when, from the schedule list it polls, and says so
// again on every poll. A hold it stops renewing lapses (LEASE_MS), and one
// whose renderer reloads, crashes or closes ends at once, so a stale "stay
// awake" from a renderer that went away cannot keep the machine up.

// Longer than the slowest poll (10 minutes) plus its slack.
export const LEASE_MS = 15 * 60 * 1000;

interface Blocker {
  start: (type: 'prevent-app-suspension') => number;
  stop: (id: number) => void;
  isStarted: (id: number) => boolean;
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createKeepAwake(blocker: Blocker, timers: Timers = realTimers) {
  let id: number | null = null;
  let lapse: unknown = null;

  function release(): void {
    if (lapse !== null) timers.clear(lapse);
    lapse = null;
    if (id !== null && blocker.isStarted(id)) blocker.stop(id);
    id = null;
  }

  return {
    set(active: boolean): void {
      if (!active) {
        release();
        return;
      }
      if (id === null || !blocker.isStarted(id)) id = blocker.start('prevent-app-suspension');
      if (lapse !== null) timers.clear(lapse);
      lapse = timers.set(release, LEASE_MS);
    },
    release,
    get active(): boolean {
      return id !== null && blocker.isStarted(id);
    },
  };
}

export function registerKeepAwakeHandlers(): void {
  const keepAwake = createKeepAwake(powerSaveBlocker);
  const watched = new WeakSet<WebContents>();
  ipcMain.handle(IPC.SCHEDULE_KEEP_AWAKE, (event: { sender: WebContents }, active: unknown) => {
    keepAwake.set(active === true);
    const sender = event.sender;
    if (!sender || watched.has(sender)) return;
    watched.add(sender);
    // The renderer that asked is gone or starting over: its "stay awake" is
    // stale until it says so again.
    sender.on('destroyed', () => keepAwake.release());
    sender.on('render-process-gone', () => keepAwake.release());
    sender.on('did-start-navigation', (_e: unknown, _url: unknown, isInPlace: boolean, isMainFrame: boolean) => {
      if (isMainFrame && !isInPlace) keepAwake.release();
    });
  });
}
