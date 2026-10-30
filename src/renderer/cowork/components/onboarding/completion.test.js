import { describe, it, expect } from 'vitest';
import { stepsCompletedBySend, classifyStart } from './completion';
import { OWN_WORK_PROMPT, HABIT_TRACKER_PROMPT } from './steps';
import { TASK_MODES, composeModeMessage } from '../taskmodes/taskModes';
import { sampleId } from '../../lib/consoleHandoff';

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

describe('classifyStart', () => {
  it('knows the first onboarding step, and how much was added to it', () => {
    expect(classifyStart(OWN_WORK_PROMPT)).toEqual({ start_kind: 'own_work', added_chars: 0 });
    expect(classifyStart(`${OWN_WORK_PROMPT} About my Q3 report.`)).toEqual({ start_kind: 'own_work', added_chars: 20 });
  });

  it('names an example by its id, with nothing added when sent as placed', () => {
    const snake = TASK_MODES.find((m) => m.id === 'games').samples.find((s) => s.label === 'Classic snake game');
    expect(classifyStart(snake.prompt)).toEqual({ start_kind: 'example', example_id: 'classic-snake-game', added_chars: 0 });
  });

  it('counts what a person adds to a plain example, and not for an ordinary one', () => {
    const plain = TASK_MODES.flatMap((m) => m.samples).find((s) => s.plain);
    const added = '\n\nLast week: all quiet.';
    const got = classifyStart(`${plain.prompt}${added}`);
    expect(got.start_kind).toBe('example');
    expect(got.added_chars).toBe(added.length);
  });

  it('still names an example the person edited, with a mode pill selected', () => {
    const mode = TASK_MODES.find((m) => m.instruction && m.samples.some((s) => !s.plain));
    const sample = mode.samples.find((s) => !s.plain);
    const edit = ' with a space theme';
    const sent = composeModeMessage(mode, `${sample.prompt}${edit}`);
    expect(sent).not.toBe(`${sample.prompt}${edit}`);
    expect(classifyStart(sent)).toEqual({ start_kind: 'example', example_id: sampleId(sample.label), added_chars: edit.length });
  });

  it('does not count the instruction a mode pill adds as what the person added', () => {
    const mode = TASK_MODES.find((m) => m.instruction);
    expect(classifyStart(composeModeMessage(mode, `${OWN_WORK_PROMPT} About my Q3 report.`)))
      .toEqual({ start_kind: 'own_work', added_chars: 20 });
  });

  it('knows the other onboarding steps and the habit tracker', () => {
    expect(classifyStart('I want to set you up for the work I actually do. Ask me a couple of quick questions about my role, remember what matters to me, then suggest and set up a few tools or workflows that would help.'))
      .toEqual({ start_kind: 'onboarding_step', example_id: 'customize-role' });
    expect(classifyStart(HABIT_TRACKER_PROMPT)).toMatchObject({ start_kind: 'example', example_id: 'build-a-habit-tracker' });
  });

  it('calls anything else free text, including empty and non-text', () => {
    expect(classifyStart('what is on my calendar')).toEqual({ start_kind: 'free_text' });
    expect(classifyStart('')).toEqual({ start_kind: 'free_text' });
    expect(classifyStart(undefined)).toEqual({ start_kind: 'free_text' });
  });
});
