// The bar's chat prompt (ENG-4227): its suffix shape, and finding the chat's
// reply to it in the chat's own messages.
import { describe, expect, it } from 'vitest';
import {
  INLINE_SUBMIT_DEFAULT_MESSAGE,
  chatReplyFor,
  countUserPrompts,
  inlineSubmitChatPrompt,
  parseQuickEditPrompt,
  quickEditChatPrompt,
} from './quickEditPrompt';

const PROMPT = 'make it bigger\n\n(About the artifact `mindshub-explainer-a8c2272e`.)';

describe('quickEditChatPrompt / parseQuickEditPrompt', () => {
  it('round-trips the message and the slug', () => {
    expect(quickEditChatPrompt({ slug: 'mindshub-explainer-a8c2272e' }, 'make it bigger')).toBe(PROMPT);
    expect(parseQuickEditPrompt(PROMPT)).toEqual({ text: 'make it bigger', slug: 'mindshub-explainer-a8c2272e' });
  });

  it('keeps a multi-line message whole', () => {
    expect(parseQuickEditPrompt('line one\nline two\n\n(About the artifact `a`.)')).toEqual({ text: 'line one\nline two', slug: 'a' });
  });

  it.each([
    ['plain text', 'hi'],
    ['the suffix not at the end', 'hi\n\n(About the artifact `a`.) and more'],
    ['a single newline before it', 'hi\n(About the artifact `a`.)'],
    ['no message before it', '\n\n(About the artifact `a`.)'],
    ['a different wording', 'hi\n\n(About artifact `a`.)'],
    ['not a string', null],
  ])('ignores %s', (_, content) => {
    expect(parseQuickEditPrompt(content)).toBeNull();
  });
});

// ENG-4684: an inline artifact's Submit is the bar's prompt plus its state.
describe('inlineSubmitChatPrompt / parseQuickEditPrompt', () => {
  const artifact = { slug: 'budget-1' };

  it('appends the state as a JSON block after the suffix, and reads it back', () => {
    const prompt = inlineSubmitChatPrompt(artifact, 'here you go', { budget: 1200 });
    expect(prompt).toBe('here you go\n\n(About the artifact `budget-1`.)\n\n```json\n{\n  "budget": 1200\n}\n```');
    expect(parseQuickEditPrompt(prompt)).toEqual({ text: 'here you go', slug: 'budget-1', json: '{\n  "budget": 1200\n}' });
  });

  it('says the default when the page sent no message', () => {
    expect(parseQuickEditPrompt(inlineSubmitChatPrompt(artifact, '', [1]))).toMatchObject({ text: INLINE_SUBMIT_DEFAULT_MESSAGE, json: '[\n  1\n]' });
    expect(parseQuickEditPrompt(inlineSubmitChatPrompt(artifact, undefined, null))).toMatchObject({ text: INLINE_SUBMIT_DEFAULT_MESSAGE, json: 'null' });
  });

  it('reads a block that is not JSON as the user\'s own text', () => {
    expect(parseQuickEditPrompt('hi\n\n(About the artifact `a`.)\n\n```json\n{nope\n```')).toBeNull();
  });

  it('reads a block not right after the suffix as the user\'s own text', () => {
    expect(parseQuickEditPrompt('hi\n\n(About the artifact `a`.) x\n\n```json\n{}\n```')).toBeNull();
  });
});

describe('chatReplyFor', () => {
  const user = { role: 'user', content: PROMPT };

  it('is null until the message is in the chat', () => {
    expect(chatReplyFor([], PROMPT)).toBeNull();
    expect(chatReplyFor([{ role: 'user', content: 'other' }], PROMPT)).toBeNull();
  });

  it('reads the live row, then the saved answer', () => {
    expect(chatReplyFor([user, { role: '_streaming', content: 'Work', steps: [] }], PROMPT))
      .toEqual({ text: 'Work', live: true, needsAnswer: false, failed: false });
    expect(chatReplyFor([user, { role: 'assistant', content: 'Done.' }], PROMPT))
      .toEqual({ text: 'Done.', live: false, needsAnswer: false, failed: false });
  });

  it('reads the reply to the nth asking, not an earlier one', () => {
    const messages = [user, { role: 'assistant', content: 'old' }, user, { role: '_streaming', content: 'new' }];
    expect(countUserPrompts(messages.slice(0, 2), PROMPT)).toBe(1);
    expect(chatReplyFor(messages, PROMPT, 1).text).toBe('new');
    expect(chatReplyFor(messages, PROMPT, 0).text).toBe('old');
  });

  it('flags an open question, and a failed turn', () => {
    const asking = { role: '_streaming', content: '', steps: [{ badge: 'AskUser', status: 'in_progress', data: { answer: null } }] };
    expect(chatReplyFor([user, asking], PROMPT).needsAnswer).toBe(true);
    const answered = { role: 'assistant', content: 'ok', steps: [{ badge: 'AskUser', status: 'completed', data: { answer: ['a'] } }] };
    expect(chatReplyFor([user, answered], PROMPT).needsAnswer).toBe(false);
    expect(chatReplyFor([user, { role: 'error', content: 'x' }], PROMPT).failed).toBe(true);
  });

  it('stops at the next user message', () => {
    expect(chatReplyFor([user, { role: 'user', content: 'next' }, { role: 'assistant', content: 'to next' }], PROMPT).text).toBe('');
  });
});
