import { describe, it, expect } from 'vitest';
import { splitTurnSegments, liveSegmentIndex } from './turnSegments';

const work = (id, startedAt = 1) => ({ id, label: id, badge: 'ToolProgress', status: 'completed', startedAt });
const question = (qid, { answer = null, completedAt = null } = {}) => ({
  id: `question-${qid}`,
  label: `Prompt ${qid}`,
  badge: 'AskUser',
  status: answer ? 'completed' : 'in_progress',
  completedAt,
  data: { question_id: qid, answer },
});
const ANSWER = { status: 'answered', values: ['accept'], text: '' };
const shape = (segments) => segments.map((s) => (s.kind === 'question' ? `Q:${s.step.id}` : s.steps.map((x) => x.id)));

describe('splitTurnSegments', () => {
  it('returns one steps segment when the turn has no questions', () => {
    const segments = splitTurnSegments([work('a'), work('b')], { startedAt: 10 });
    expect(shape(segments)).toEqual([['a', 'b']]);
    expect(segments[0]).toMatchObject({ kind: 'steps', key: 'seg-0', startedAt: 10 });
  });

  it('returns one empty segment for missing steps', () => {
    expect(shape(splitTurnSegments(undefined))).toEqual([[]]);
  });

  it('splits around each question and keeps empty segments', () => {
    const steps = [
      work('a'),
      question('q1', { answer: ANSWER, completedAt: 100 }),
      work('b'),
      question('q2', { answer: ANSWER, completedAt: 200 }),
      question('q3', { answer: ANSWER, completedAt: 300 }),
      work('c'),
    ];
    const segments = splitTurnSegments(steps);
    expect(shape(segments)).toEqual([
      ['a'], 'Q:question-q1', ['b'], 'Q:question-q2', [], 'Q:question-q3', ['c'],
    ]);
    expect(segments.map((s) => s.key)).toEqual([
      'seg-0', 'question-q1', 'seg-2', 'question-q2', 'seg-4', 'question-q3', 'seg-6',
    ]);
  });

  it('starts a segment after a question at the answer time, falling back to its first step', () => {
    const segments = splitTurnSegments([
      question('q1', { answer: ANSWER, completedAt: 100 }),
      work('a', 150),
      question('q2', { answer: ANSWER, completedAt: null }),
      work('b', 250),
      question('q3', { answer: ANSWER, completedAt: null }),
    ], { startedAt: 5 });
    const steps = segments.filter((s) => s.kind === 'steps');
    expect(steps.map((s) => s.startedAt)).toEqual([5, 100, 250, null]);
  });

  it('keeps the expiry rules: answered never expired, only the last unanswered of a live turn is open', () => {
    const steps = [
      question('q1', { answer: ANSWER, completedAt: 100 }),
      question('q2'),
      question('q3'),
    ];
    const expired = (segments) => segments.filter((s) => s.kind === 'question').map((s) => s.expired);

    expect(expired(splitTurnSegments(steps, { conversationLive: true }))).toEqual([false, true, false]);
    expect(expired(splitTurnSegments(steps, { conversationLive: false }))).toEqual([false, true, true]);
  });
});

describe('liveSegmentIndex', () => {
  it('is the only segment when there are no questions', () => {
    expect(liveSegmentIndex(splitTurnSegments([work('a')]))).toBe(0);
  });

  it('is the last segment once the last question is answered', () => {
    const segments = splitTurnSegments([work('a'), question('q1', { answer: ANSWER, completedAt: 100 })]);
    expect(liveSegmentIndex(segments)).toBe(2);
  });

  it('is the segment before a pending question', () => {
    const segments = splitTurnSegments([
      work('a'),
      question('q1', { answer: ANSWER, completedAt: 100 }),
      work('b'),
      question('q2'),
    ]);
    expect(liveSegmentIndex(segments)).toBe(2);
  });

  it('treats a timed-out question as answered', () => {
    const segments = splitTurnSegments([
      work('a'),
      question('q1', { answer: { status: 'timeout', values: [], text: '' }, completedAt: 100 }),
    ]);
    expect(liveSegmentIndex(segments)).toBe(2);
  });

  it('is -1 for no segments', () => {
    expect(liveSegmentIndex([])).toBe(-1);
  });
});
