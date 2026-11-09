import { describe, expect, it, vi } from 'vitest';

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => { handlers[channel] = fn; }) },
  powerSaveBlocker: {
    started: new Set<number>(),
    next: 1,
    start(this: { started: Set<number>; next: number }) { const id = this.next++; this.started.add(id); return id; },
    stop(this: { started: Set<number> }, id: number) { this.started.delete(id); },
    isStarted(this: { started: Set<number> }, id: number) { return this.started.has(id); },
  },
  powerMonitor: {
    battery: false,
    listeners: {} as Record<string, Array<() => void>>,
    isOnBatteryPower(this: { battery: boolean }) { return this.battery; },
    on(this: { listeners: Record<string, Array<() => void>> }, name: string, fn: () => void) {
      (this.listeners[name] ||= []).push(fn);
    },
  },
}));

import { powerMonitor, powerSaveBlocker } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { LEASE_MS, createKeepAwake, registerKeepAwakeHandlers } from './keep-awake';

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

function fakeTimers() {
  let pending: { fn: () => void; ms: number } | null = null;
  return {
    set: vi.fn((fn: () => void, ms: number) => { pending = { fn, ms }; return pending; }),
    clear: vi.fn((handle: unknown) => { if (handle === pending) pending = null; }),
    fire: () => { const p = pending; pending = null; p?.fn(); },
    get pending() { return pending; },
  };
}

describe('createKeepAwake', () => {
  it('holds one blocker while active and releases it when not', () => {
    const blocker = fakeBlocker();
    const keepAwake = createKeepAwake(blocker, fakeTimers());

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
    const keepAwake = createKeepAwake(blocker, fakeTimers());
    keepAwake.set(true);
    blocker.started.clear();
    keepAwake.set(true);
    expect(blocker.start).toHaveBeenCalledTimes(2);
  });

  it('lets a hold lapse when the renderer stops renewing it', () => {
    const blocker = fakeBlocker();
    const timers = fakeTimers();
    const keepAwake = createKeepAwake(blocker, timers);

    keepAwake.set(true);
    expect(timers.pending?.ms).toBe(LEASE_MS);
    keepAwake.set(true);  // the next poll renews it
    expect(keepAwake.active).toBe(true);

    timers.fire();
    expect(keepAwake.active).toBe(false);
    expect(blocker.stop).toHaveBeenCalledTimes(1);
  });

  describe('on battery', () => {
    function power(onBattery: boolean) {
      const state = { onBattery };
      return { state, onBattery: () => state.onBattery };
    }

    it('does not hold on battery, and holds once plugged in', () => {
      const blocker = fakeBlocker();
      const p = power(true);
      const keepAwake = createKeepAwake(blocker, fakeTimers(), p);

      keepAwake.set(true);
      expect(blocker.start).not.toHaveBeenCalled();
      expect(keepAwake.active).toBe(false);

      p.state.onBattery = false;
      keepAwake.powerChanged();
      expect(keepAwake.active).toBe(true);
    });

    it('ends the hold when unplugged and starts it again when plugged back in', () => {
      const blocker = fakeBlocker();
      const p = power(false);
      const keepAwake = createKeepAwake(blocker, fakeTimers(), p);

      keepAwake.set(true);
      expect(keepAwake.active).toBe(true);

      p.state.onBattery = true;
      keepAwake.powerChanged();
      expect(keepAwake.active).toBe(false);
      expect(blocker.stop).toHaveBeenCalledTimes(1);

      p.state.onBattery = false;
      keepAwake.powerChanged();
      expect(keepAwake.active).toBe(true);
      expect(blocker.start).toHaveBeenCalledTimes(2);
    });

    it('does not hold after plugging in once the request was withdrawn or lapsed', () => {
      const blocker = fakeBlocker();
      const timers = fakeTimers();
      const p = power(true);
      const keepAwake = createKeepAwake(blocker, timers, p);

      keepAwake.set(true);
      timers.fire();  // the renderer stopped renewing it while on battery
      p.state.onBattery = false;
      keepAwake.powerChanged();
      expect(keepAwake.active).toBe(false);

      p.state.onBattery = true;
      keepAwake.set(true);
      keepAwake.set(false);
      p.state.onBattery = false;
      keepAwake.powerChanged();
      expect(keepAwake.active).toBe(false);
      expect(blocker.start).not.toHaveBeenCalled();
    });
  });
});

describe('registerKeepAwakeHandlers', () => {
  function sender() {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return { on: vi.fn((name: string, fn: (...args: unknown[]) => void) => { listeners[name] = fn; }), listeners };
  }
  const blocker = powerSaveBlocker as unknown as { started: Set<number> };

  it.each([
    ['closes', (s: ReturnType<typeof sender>) => s.listeners.destroyed()],
    ['crashes', (s: ReturnType<typeof sender>) => s.listeners['render-process-gone']()],
    ['reloads', (s: ReturnType<typeof sender>) => s.listeners['did-start-navigation']({}, 'app://', false, true)],
  ])('releases the hold when its renderer %s', (_name, end) => {
    registerKeepAwakeHandlers();
    const s = sender();
    handlers[IPC.SCHEDULE_KEEP_AWAKE]({ sender: s }, true);
    expect(blocker.started.size).toBe(1);

    end(s);
    expect(blocker.started.size).toBe(0);
  });

  it('follows the power source the OS reports', () => {
    const monitor = powerMonitor as unknown as { battery: boolean; listeners: Record<string, Array<() => void>> };
    monitor.battery = true;
    try {
      registerKeepAwakeHandlers();
      const s = sender();
      handlers[IPC.SCHEDULE_KEEP_AWAKE]({ sender: s }, true);
      expect(blocker.started.size).toBe(0);

      monitor.battery = false;
      monitor.listeners['on-ac'].forEach((fn) => fn());
      expect(blocker.started.size).toBe(1);

      monitor.battery = true;
      monitor.listeners['on-battery'].forEach((fn) => fn());
      expect(blocker.started.size).toBe(0);

      handlers[IPC.SCHEDULE_KEEP_AWAKE]({ sender: s }, false);
    } finally {
      monitor.battery = false;
    }
  });

  it('keeps the hold through an in-page navigation', () => {
    registerKeepAwakeHandlers();
    const s = sender();
    handlers[IPC.SCHEDULE_KEEP_AWAKE]({ sender: s }, true);
    s.listeners['did-start-navigation']({}, 'app://#/tasks', true, true);
    expect(blocker.started.size).toBe(1);
    handlers[IPC.SCHEDULE_KEEP_AWAKE]({ sender: s }, false);
    expect(blocker.started.size).toBe(0);
  });
});
