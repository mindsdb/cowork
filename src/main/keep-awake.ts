import { ipcMain, powerSaveBlocker } from 'electron';
import { IPC } from '../shared/ipc-channels';

// Holds off system sleep while a scheduled task is running or about to fire,
// so a laptop left idle doesn't sleep through the run. The display may still
// sleep. The renderer decides when, from the schedule list it already polls.

interface Blocker {
  start: (type: 'prevent-app-suspension') => number;
  stop: (id: number) => void;
  isStarted: (id: number) => boolean;
}

export function createKeepAwake(blocker: Blocker) {
  let id: number | null = null;
  return {
    set(active: boolean): void {
      if (active && (id === null || !blocker.isStarted(id))) {
        id = blocker.start('prevent-app-suspension');
      } else if (!active && id !== null) {
        if (blocker.isStarted(id)) blocker.stop(id);
        id = null;
      }
    },
    get active(): boolean {
      return id !== null && blocker.isStarted(id);
    },
  };
}

export function registerKeepAwakeHandlers(): void {
  const keepAwake = createKeepAwake(powerSaveBlocker);
  ipcMain.handle(IPC.SCHEDULE_KEEP_AWAKE, (_event: unknown, active: unknown) => {
    keepAwake.set(active === true);
  });
}
