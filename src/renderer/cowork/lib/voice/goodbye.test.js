import { describe, expect, it } from 'vitest';
import { isGoodbye } from './goodbye';

describe('isGoodbye (ENG-4631)', () => {
  it.each([
    "You're dismissed.",
    'you are dismissed',
    'You can hang up now.',
    'Okay, you can hang up now, thanks.',
    'Hang up.',
    'Bye!',
    'Okay, bye bye.',
    'Thanks Anton, bye.',
    "That's all, thanks.",
    "No, that's all for now.",
    'End the call please.',
    "Great, we're done here.",
    'See you later!',
    'Adiós.',
    'Thank you so much, goodbye.',
  ])('ends the call on %j', (said) => {
    expect(isGoodbye(said)).toBe(true);
  });

  it.each([
    '',
    'Thanks.',
    'Okay.',
    'Do it later.',
    'Bye the way, also check Q3.',
    "That's all the files I need, now summarize them.",
    'Start a new task and look up our churn numbers, then bye.',
    "I'm good, how are you?",
    "I'm done with the browser.",
    'What did you find?',
    'Hang up the poster in the report.',
  ])('keeps the call on %j', (said) => {
    expect(isGoodbye(said)).toBe(false);
  });
});
