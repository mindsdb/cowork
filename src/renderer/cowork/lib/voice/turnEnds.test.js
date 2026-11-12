import { describe, expect, it } from 'vitest';
import { reportTurnEnd, waitForTurnEnd } from './turnEnds';

describe('waiting for a turn to end', () => {
  it('resolves for the task it names, by any of its ids', async () => {
    const turn = waitForTurnEnd('conv-1');
    reportTurnEnd(['conv-2'], { content: 'other task' });
    reportTurnEnd(['tmp-9', 'conv-1'], { content: 'Booked.', finalId: 'conv-1b' });
    await expect(turn.promise).resolves.toEqual({ content: 'Booked.', error: null, finalId: 'conv-1b' });
  });

  it('passes an error on, and a cancelled wait hears nothing', async () => {
    const cancelled = waitForTurnEnd('conv-3');
    cancelled.cancel();
    const turn = waitForTurnEnd('conv-3');
    reportTurnEnd(['conv-3'], { error: 'The task was stopped.' });
    await expect(turn.promise).resolves.toMatchObject({ error: 'The task was stopped.', finalId: 'conv-3' });
  });
});
