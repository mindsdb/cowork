import { describe, expect, it } from 'vitest';
import { awaitUpdateMaintenanceIdle, withUpdateMaintenance } from './update-maintenance';

describe('withUpdateMaintenance', () => {
  it('serializes mutations and keeps the queue usable after a failure', async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });

    const first = withUpdateMaintenance(async () => {
      order.push('first-start');
      await held;
      order.push('first-end');
    });
    const second = withUpdateMaintenance(() => {
      order.push('second');
      throw new Error('expected');
    }).catch(() => undefined);
    const third = withUpdateMaintenance(() => {
      order.push('third');
      return 3;
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    release();
    await expect(third).resolves.toBe(3);
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second', 'third']);
  });
});

describe('awaitUpdateMaintenanceIdle', () => {
  it('resolves only after an in-flight operation settles (the quit-drain gate)', async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let applyDone = false;

    const apply = withUpdateMaintenance(async () => {
      await held;
      applyDone = true;
    });

    let idleResolved = false;
    const idle = awaitUpdateMaintenanceIdle().then(() => { idleResolved = true; });

    // The gate must still be closed while the apply is in flight.
    await Promise.resolve();
    expect(idleResolved).toBe(false);

    release();
    await idle;
    expect(applyDone).toBe(true);
    expect(idleResolved).toBe(true);
    await apply;
  });

  it('never rejects even when the drained operation throws', async () => {
    const failing = withUpdateMaintenance(() => { throw new Error('apply blew up'); }).catch(() => undefined);
    await expect(awaitUpdateMaintenanceIdle()).resolves.toBeUndefined();
    await failing;
  });

  it('resolves immediately when the gate is idle', async () => {
    await expect(awaitUpdateMaintenanceIdle()).resolves.toBeUndefined();
  });
});
