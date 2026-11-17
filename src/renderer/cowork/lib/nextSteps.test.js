import { describe, expect, it } from 'vitest';
import { TASK_MODES } from '../components/taskmodes/taskModes';
import {
  NEXT_STEP,
  RESULT_KIND,
  distinctLinkCount,
  hasMarkdownTable,
  nextStepsFor,
  offersNextSteps,
  resultKinds,
  scheduledPromptFor,
} from './nextSteps';

const EXAMPLE_PROMPT = TASK_MODES.find((m) => m.id === 'games').samples[0].prompt;
const TABLE = '| Month | Total |\n| --- | ---: |\n| Jan | 12 |';
const LINKS = 'Sources: https://a.example/report and https://b.example/data.';
const answer = (over = {}) => ({ role: 'assistant', content: 'Done.', steps: [], ...over });

describe('reading the reply', () => {
  it('finds a Markdown table only with its delimiter row', () => {
    expect(hasMarkdownTable(TABLE)).toBe(true);
    expect(hasMarkdownTable('| a | b |\n| c | d |')).toBe(false);
    expect(hasMarkdownTable('no table here')).toBe(false);
  });

  it('counts distinct links, ignoring trailing punctuation', () => {
    expect(distinctLinkCount('see https://a.example/x, and https://a.example/x.')).toBe(1);
    expect(distinctLinkCount(LINKS)).toBe(2);
    expect(distinctLinkCount(null)).toBe(0);
  });
});

describe('resultKinds', () => {
  it('names an example start only on the turn that answered it', () => {
    expect(resultKinds({ firstUserText: EXAMPLE_PROMPT, isFirstTurn: true, answer: answer() })[0]).toBe(RESULT_KIND.EXAMPLE);
    expect(resultKinds({ firstUserText: EXAMPLE_PROMPT, isFirstTurn: false, answer: answer() })).toEqual([RESULT_KIND.OTHER]);
  });

  it('reads an example sent with a replayed timestamp prefix', () => {
    const replayed = `[2026-11-16 09:14] ${EXAMPLE_PROMPT}`;
    expect(resultKinds({ firstUserText: replayed, isFirstTurn: true, answer: answer() })).toContain(RESULT_KIND.EXAMPLE);
  });

  it('does not treat free text as an example', () => {
    expect(resultKinds({ firstUserText: 'Summarize my notes', isFirstTurn: true, answer: answer() })).toEqual([RESULT_KIND.OTHER]);
  });

  it('names files, artifacts, tables and research in priority order', () => {
    const kinds = resultKinds({
      userMessage: { role: 'user', attachments: [{ id: 'a' }] },
      answer: answer({ content: `${TABLE}\n\n${LINKS}`, artifact: { id: 'x' } }),
    });
    expect(kinds).toEqual([RESULT_KIND.FILE, RESULT_KIND.ARTIFACT, RESULT_KIND.TABLE, RESULT_KIND.RESEARCH]);
  });

  it('needs two different links to call a reply research', () => {
    expect(resultKinds({ answer: answer({ content: 'See https://a.example/one.' }) })).toEqual([RESULT_KIND.OTHER]);
  });

  it('finds an artifact made in a step', () => {
    expect(resultKinds({ answer: answer({ steps: [{ badge: 'Artifact' }] }) })).toEqual([RESULT_KIND.ARTIFACT]);
  });
});

describe('nextStepsFor', () => {
  it('offers own data after an example', () => {
    expect(nextStepsFor({ firstUserText: EXAMPLE_PROMPT, isFirstTurn: true, answer: answer() }))
      .toEqual({ resultKind: RESULT_KIND.EXAMPLE, steps: [NEXT_STEP.OWN_DATA] });
  });

  it('offers another file after work on an attached file', () => {
    expect(nextStepsFor({ userMessage: { attachments: [{ id: 'a' }] }, answer: answer() }).steps)
      .toEqual([NEXT_STEP.ANOTHER_FILE]);
  });

  it('offers a page and a schedule after research or a table', () => {
    expect(nextStepsFor({ answer: answer({ content: TABLE }) }).steps).toEqual([NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
    expect(nextStepsFor({ answer: answer({ content: LINKS }) })).toEqual({
      resultKind: RESULT_KIND.RESEARCH, steps: [NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE],
    });
  });

  it('repeats nothing the artifact card already offers', () => {
    expect(nextStepsFor({ answer: answer({ artifact: { id: 'x' } }) })).toEqual({ resultKind: RESULT_KIND.ARTIFACT, steps: [] });
    expect(nextStepsFor({ answer: answer({ artifact: { id: 'x' }, content: TABLE }) }).steps).toEqual([]);
  });

  it('keeps the steps an artifact card does not cover', () => {
    expect(nextStepsFor({ firstUserText: EXAMPLE_PROMPT, isFirstTurn: true, answer: answer({ artifact: { id: 'x' } }) }).steps)
      .toEqual([NEXT_STEP.OWN_DATA]);
  });

  it('offers own data rather than another file when an example came with files', () => {
    expect(nextStepsFor({
      firstUserText: EXAMPLE_PROMPT, isFirstTurn: true,
      userMessage: { attachments: [{ id: 'a' }] }, answer: answer(),
    }).steps).toEqual([NEXT_STEP.OWN_DATA]);
  });

  it('caps the row at three', () => {
    const { steps } = nextStepsFor({ userMessage: { attachments: [{ id: 'a' }] }, answer: answer({ content: TABLE }) });
    expect(steps).toEqual([NEXT_STEP.ANOTHER_FILE, NEXT_STEP.MAKE_PAGE, NEXT_STEP.SCHEDULE]);
  });

  it('leaves out what the surface cannot do', () => {
    expect(nextStepsFor({ answer: answer({ content: TABLE }) }, { canSchedule: false }).steps).toEqual([NEXT_STEP.MAKE_PAGE]);
    expect(nextStepsFor({ userMessage: { attachments: [{ id: 'a' }] }, answer: answer() }, { canAttach: false }).steps).toEqual([]);
    expect(nextStepsFor({ firstUserText: EXAMPLE_PROMPT, isFirstTurn: true, answer: answer() }, { canAttach: false }).steps).toEqual([]);
  });

  it('offers nothing after a plain answer', () => {
    expect(nextStepsFor({ answer: answer() })).toEqual({ resultKind: RESULT_KIND.OTHER, steps: [] });
  });
});

describe('offersNextSteps', () => {
  const base = { isLatest: true, inFlight: false, answer: answer() };

  it('offers under the latest finished answer', () => {
    expect(offersNextSteps(base)).toBe(true);
  });

  it('offers nothing under an older answer, while a turn runs, or after a failure', () => {
    expect(offersNextSteps({ ...base, isLatest: false })).toBe(false);
    expect(offersNextSteps({ ...base, inFlight: true })).toBe(false);
    expect(offersNextSteps({ ...base, followedByFailure: true })).toBe(false);
  });

  it('offers nothing after an incomplete or empty answer', () => {
    expect(offersNextSteps({ ...base, answer: answer({ incompleteReason: 'round_cap' }) })).toBe(false);
    expect(offersNextSteps({ ...base, answer: answer({ content: '' }) })).toBe(false);
    expect(offersNextSteps({ ...base, answer: answer({ content: '', artifact: { id: 'x' } }) })).toBe(true);
    expect(offersNextSteps({ ...base, answer: { role: 'user', content: 'hi' } })).toBe(false);
  });

  it('offers nothing while a question waits for an answer', () => {
    const asking = answer({ steps: [{ badge: 'AskUser', data: {} }] });
    const answered = answer({ steps: [{ badge: 'AskUser', data: { answer: { status: 'answered' } } }] });
    expect(offersNextSteps({ ...base, answer: asking })).toBe(false);
    expect(offersNextSteps({ ...base, answer: answered })).toBe(true);
  });
});

describe('scheduledPromptFor', () => {
  it('is the message the answer replied to, without a replay timestamp', () => {
    expect(scheduledPromptFor({ content: '[2026-11-16 09:14] Find this week’s grants ' })).toBe('Find this week’s grants');
    expect(scheduledPromptFor(null)).toBe('');
  });
});
