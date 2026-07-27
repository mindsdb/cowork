import { describe, expect, it } from 'vitest';
import { withUpdateMaintenance } from './update-maintenance';

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
