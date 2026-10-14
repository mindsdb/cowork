import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, powerSaveBlocker: {} }));

import { createKeepAwake } from './keep-awake';

function fakeBlocker() {
  const started = new Set<number>();
  let next = 1;
  return {
    started,
    start: vi.fn(() => { const id = next++; started.add(id); return id; }),
    stop: vi.fn((id: number) => { started.delete(id); }),
    isStarted: (id: number) => started.has(id),
  };
}

describe('createKeepAwake', () => {
  it('holds one blocker while active and releases it when not', () => {
    const blocker = fakeBlocker();
    const keepAwake = createKeepAwake(blocker);

    keepAwake.set(true);
    keepAwake.set(true);
    expect(blocker.start).toHaveBeenCalledTimes(1);
    expect(blocker.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(keepAwake.active).toBe(true);

    keepAwake.set(false);
    expect(blocker.stop).toHaveBeenCalledTimes(1);
    expect(keepAwake.active).toBe(false);
    keepAwake.set(false);
    expect(blocker.stop).toHaveBeenCalledTimes(1);
  });

  it('starts a new blocker if the old one was stopped elsewhere', () => {
    const blocker = fakeBlocker();
    const keepAwake = createKeepAwake(blocker);
    keepAwake.set(true);
    blocker.started.clear();
    keepAwake.set(true);
    expect(blocker.start).toHaveBeenCalledTimes(2);
  });
});
