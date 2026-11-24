import { describe, it, expect } from 'vitest';
import { stepsCompletedBySend, classifyStart } from './completion';
import { HABIT_TRACKER_PROMPT } from './steps';
import { TASK_MODES, composeModeMessage, composeOwnWorkMessage, OWN_WORK_LEAD } from '../taskmodes/taskModes';

const JOB = 'Clean up this customer list and flag duplicates.';
import { sampleId } from '../../lib/consoleHandoff';

describe('stepsCompletedBySend', () => {
  it('completes the own-work step, and only it, for a message the own-work mode sent', () => {
    expect(stepsCompletedBySend(composeOwnWorkMessage(`${JOB} `))).toEqual(['bring-your-work']);
    expect(stepsCompletedBySend(composeOwnWorkMessage('Weekly ops sync notes...'))).toEqual(['bring-your-work']);
  });

  it('does not count a job typed by hand without the mode, or the generic lead alone', () => {
    expect(stepsCompletedBySend(JOB)).toEqual([]);
    expect(stepsCompletedBySend(OWN_WORK_LEAD)).toEqual([]);
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

  it('counts an example the person edited or added to, plain or not, as analytics does', () => {
    const all = TASK_MODES.flatMap((m) => m.samples);
    const plain = all.find((s) => s.plain);
    const ordinary = all.find((s) => !s.plain);
    expect(stepsCompletedBySend(`${plain.prompt}\n\nLast week: all quiet.`)).toEqual(['see-it-work']);
    expect(stepsCompletedBySend(`${ordinary.prompt} for Acme Plumbing`)).toEqual(['see-it-work']);
  });

  it('does not count a message that only resembles an example', () => {
    const sample = TASK_MODES[0].samples[0];
    expect(stepsCompletedBySend(sample.prompt.slice(0, -5))).toEqual([]);
  });

  it('ignores ordinary messages and non-text', () => {
    expect(stepsCompletedBySend('what is on my calendar')).toEqual([]);
    expect(stepsCompletedBySend('   ')).toEqual([]);
    expect(stepsCompletedBySend(undefined)).toEqual([]);
    expect(stepsCompletedBySend({ text: composeOwnWorkMessage(JOB) })).toEqual([]);
  });
});

describe('classifyStart', () => {
  it('knows an own-work start, its job, and how much material the person gave', () => {
    expect(classifyStart(composeOwnWorkMessage(`${JOB} `)))
      .toEqual({ start_kind: 'own_work', example_id: sampleId(JOB), added_chars: 0 });
    expect(classifyStart(composeOwnWorkMessage(`${JOB} name,email`)))
      .toEqual({ start_kind: 'own_work', example_id: sampleId(JOB), added_chars: 10 });
  });

  it('knows an own-work start with no job, and names no example for it', () => {
    expect(classifyStart(composeOwnWorkMessage('https://example.com/post')))
      .toEqual({ start_kind: 'own_work', added_chars: 24 });
    expect(classifyStart(composeOwnWorkMessage(''))).toEqual({ start_kind: 'own_work', added_chars: 0 });
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

  it('knows the other onboarding steps and the habit tracker', () => {
    expect(classifyStart("I want to connect my Google Drive so you can work with my real files. Walk me through linking it, then once it's connected, find one of my files, do something useful with it, and show me what you found."))
      .toEqual({ start_kind: 'onboarding_step', example_id: 'connect-app' });
    expect(classifyStart(HABIT_TRACKER_PROMPT)).toMatchObject({ start_kind: 'example', example_id: 'build-a-habit-tracker' });
    // A lightly edited habit tracker no longer matches the catalog entry, so it takes the prefix route.
    expect(classifyStart('Build me a habit tracker with five habits.'))
      .toEqual({ start_kind: 'example', example_id: sampleId('Build a habit tracker'), added_chars: null });
  });

  it('calls anything else free text, including empty and non-text', () => {
    expect(classifyStart('what is on my calendar')).toEqual({ start_kind: 'free_text' });
    expect(classifyStart('')).toEqual({ start_kind: 'free_text' });
    expect(classifyStart(undefined)).toEqual({ start_kind: 'free_text' });
  });
});
