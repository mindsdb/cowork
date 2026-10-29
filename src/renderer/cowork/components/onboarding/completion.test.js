import { describe, it, expect } from 'vitest';
import { stepsCompletedBySend } from './completion';
import { OWN_WORK_PROMPT, HABIT_TRACKER_PROMPT } from './steps';
import { TASK_MODES } from '../taskmodes/taskModes';

describe('stepsCompletedBySend', () => {
  it('completes the own-work step, and only it, for its prompt', () => {
    expect(stepsCompletedBySend(OWN_WORK_PROMPT)).toEqual(['bring-your-work']);
  });

  it('still recognizes the own-work prompt after the person edits or pads it', () => {
    expect(stepsCompletedBySend(`  ${OWN_WORK_PROMPT} It is about my quarterly report.  `)).toEqual(['bring-your-work']);
  });

  it('completes the example step for the habit tracker, as before', () => {
    expect(stepsCompletedBySend(HABIT_TRACKER_PROMPT)).toEqual(['see-it-work']);
    expect(stepsCompletedBySend('Build me a habit tracker with five habits.')).toEqual(['see-it-work']);
  });

  it('completes the example step for every example in every mode, sent as placed', () => {
    for (const mode of TASK_MODES) {
      for (const sample of mode.samples) {
        expect(stepsCompletedBySend(sample.prompt), sample.label).toEqual(['see-it-work']);
      }
    }
  });

  it('counts a plain example that the person added a paste to, but not an ordinary one', () => {
    const plain = TASK_MODES.flatMap((m) => m.samples).find((s) => s.plain);
    expect(stepsCompletedBySend(`${plain.prompt}\n\nLast week: all quiet.`)).toEqual(['see-it-work']);
  });

  it('does not count an example the person has rewritten', () => {
    const sample = TASK_MODES[0].samples[0];
    expect(stepsCompletedBySend(`${sample.prompt} Make it shorter.`)).toEqual([]);
  });

  it('ignores ordinary messages and non-text', () => {
    expect(stepsCompletedBySend('what is on my calendar')).toEqual([]);
    expect(stepsCompletedBySend('   ')).toEqual([]);
    expect(stepsCompletedBySend(undefined)).toEqual([]);
    expect(stepsCompletedBySend({ text: OWN_WORK_PROMPT })).toEqual([]);
  });
});
