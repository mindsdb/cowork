import { describe, it, expect } from 'vitest';
import { reduceAll, visibleFirstTake } from './responseStreamAdapter';

const created = { type: 'response.created', response: { id: 'r' } };
const take = (delta) => ({ type: 'response.first_take.delta', delta });
const takeDone = { type: 'response.first_take.done' };
const cleared = { type: 'response.first_take.cleared' };
const text = (delta) => ({ type: 'response.output_text.delta', delta });

describe('responseStreamAdapter — instant first take (ENG-3406)', () => {
  it('collects the take while Anton has said nothing', () => {
    const state = reduceAll([created, take("I'll pull "), take('your sales.'), takeDone]);
    expect(visibleFirstTake(state.firstTake)).toEqual({ text: "I'll pull your sales.", done: true });
    expect(state.bodyText).toBe('');
  });

  it("never becomes part of the answer, and goes once Anton speaks", () => {
    const state = reduceAll([created, take('Checking.'), text('Revenue rose 4%.')]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
    expect(state.bodyText).toBe('Revenue rose 4%.');
  });

  it('a blank delta is not Anton speaking', () => {
    const state = reduceAll([created, take('Checking.'), text('\n\n')]);
    expect(visibleFirstTake(state.firstTake)?.text).toBe('Checking.');
  });

  it('goes on the server clear, and nothing late brings it back', () => {
    const state = reduceAll([created, take('Checking.'), cleared, take(' more'), takeDone]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
  });

  it('stays gone after narration moves into the thinking block', () => {
    const state = reduceAll([
      created, take('Checking.'), text('Let me look.'),
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 't1' },
      take(' late'),
    ]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
  });

  it('a question for the user takes its place', () => {
    const state = reduceAll([
      created, take('On it.'),
      { type: 'response.ask_user', question_id: 'q1', prompt: 'Which sheet?', options: [] },
    ]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
  });

  it('the end of the turn takes it off, done or failed', () => {
    const completed = { type: 'response.completed', response: { output: [] } };
    const failed = { type: 'response.failed', error: 'x' };
    expect(visibleFirstTake(reduceAll([created, take('On it.'), completed]).firstTake)).toBeNull();
    expect(visibleFirstTake(reduceAll([created, take('On it.'), failed]).firstTake)).toBeNull();
  });

  it('a turn without one is unchanged', () => {
    const state = reduceAll([created, text('Hi.')]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
    expect(state.bodyText).toBe('Hi.');
  });
});
