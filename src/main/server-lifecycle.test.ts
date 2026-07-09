import { describe, expect, it } from 'vitest';
import { withServerLifecycle } from './server-lifecycle';

describe('withServerLifecycle', () => {
  it('serializes a queued maintenance transition behind an in-flight start', async () => {
    const order: string[] = [];
    let releaseStart!: () => void;
    let startEntered!: () => void;
    const startEnteredPromise = new Promise<void>((resolve) => { startEntered = resolve; });
    const startBlocked = new Promise<void>((resolve) => { releaseStart = resolve; });

    const start = withServerLifecycle(async () => {
      order.push('start');
      startEntered();
      await startBlocked;
      order.push('start-complete');
    });
    await startEnteredPromise;

    const maintenance = withServerLifecycle(async () => {
      order.push('maintenance');
    });
    await Promise.resolve();
    expect(order).toEqual(['start']);

    releaseStart();
    await Promise.all([start, maintenance]);
    expect(order).toEqual(['start', 'start-complete', 'maintenance']);
  });

  it('allows a compound lifecycle operation to call the helper again', async () => {
    await expect(withServerLifecycle(async () => {
      await Promise.resolve();
      return withServerLifecycle(async () => 'complete');
    })).resolves.toBe('complete');
  });
});
