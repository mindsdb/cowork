import { describe, it, expect } from 'vitest';
import { answerBody, reduceAll, visibleFirstTake } from './responseStreamAdapter';

const created = { type: 'response.created', response: { id: 'r' } };
const take = (delta) => ({ type: 'response.first_take.delta', delta });
const takeDone = { type: 'response.first_take.done' };
const cleared = { type: 'response.first_take.cleared' };
const text = (delta) => ({ type: 'response.output_text.delta', delta });

describe('responseStreamAdapter — instant first take', () => {
  it('collects the take', () => {
    const state = reduceAll([created, take("I'll pull "), take('your sales.'), takeDone]);
    expect(visibleFirstTake(state.firstTake)).toEqual({ text: "I'll pull your sales.", done: true });
    expect(state.bodyText).toBe('');
  });

  it('never becomes part of the answer, and stays until the answer starts (ENG-3554)', () => {
    // A one-line round is narration until the turn says otherwise.
    const narrating = reduceAll([created, take('Checking.'), text('Revenue rose 4%.')]);
    expect(visibleFirstTake(narrating.firstTake)?.text).toBe('Checking.');
    expect(answerBody(narrating)).toBe('');
    // An answer takes its place.
    const answering = reduceAll([created, take('Checking.'), text('Revenue rose 4%.\n\nMostly in Q3.')]);
    expect(visibleFirstTake(answering.firstTake)).toBeNull();
    expect(answerBody(answering)).toBe('Revenue rose 4%.\n\nMostly in Q3.');
  });

  it('a blank delta is not Anton speaking', () => {
    const state = reduceAll([created, take('Checking.'), text('\n\n')]);
    expect(visibleFirstTake(state.firstTake)?.text).toBe('Checking.');
  });

  it("stays on the server's clear, which only stops it growing (ENG-3554)", () => {
    const state = reduceAll([created, take('Checking.'), cleared, take(' more'), takeDone]);
    expect(visibleFirstTake(state.firstTake)?.text).toBe('Checking.');
  });

  it("an older server's clear on Anton's narration doesn't take it away (ENG-3554)", () => {
    // That server clears the take right before Anton's first words.
    const state = reduceAll([
      created, take("I'll build that game for you."), cleared, text("I'll create a hybrid game."),
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 't1' },
    ]);
    expect(visibleFirstTake(state.firstTake)?.text).toBe("I'll build that game for you.");
    expect(state.steps[0]).toEqual(expect.objectContaining({ badge: 'Note', label: "I'll create a hybrid game." }));
  });

  it('after the clear, the answer still takes its place', () => {
    const state = reduceAll([created, take('Checking.'), cleared, text('# Results\n\nAll good.')]);
    expect(visibleFirstTake(state.firstTake)).toBeNull();
  });

  it("stays through Anton's narration, which becomes a step (ENG-3554)", () => {
    const state = reduceAll([
      created, take('Checking.'), text('Let me look.'),
      { type: 'response.in_progress', thought_role: 'thought.scratchpad.start', tool_use_id: 't1' },
      take(' more'),
    ]);
    expect(visibleFirstTake(state.firstTake)?.text).toBe('Checking. more');
    expect(state.steps[0]).toEqual(expect.objectContaining({ badge: 'Note', label: 'Let me look.' }));
  });

  it("a late take can't reappear once the answer has replaced it", () => {
    const state = reduceAll([created, take('Checking.'), text('# Results\n'), take(' late')]);
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
