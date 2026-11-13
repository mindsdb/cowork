// The bar's chat prompt (ENG-4227): its suffix shape, and finding the chat's
// reply to it in the chat's own messages.
import { describe, expect, it } from 'vitest';
import { chatReplyFor, countUserPrompts, parseQuickEditPrompt, quickEditChatPrompt } from './quickEditPrompt';

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
