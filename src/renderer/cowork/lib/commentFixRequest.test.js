import { describe, expect, it } from 'vitest';
import { commentFixMessage, MAX_REQUEST_CHARS } from './commentFixRequest';

const thread = (selector, text, replies = []) => ({ id: 't1', selector, payload: { text, replies: replies.map((r) => ({ text: r })) } });
const IMAGE = '0123456789abcdef0123456789abcdef.png';

describe('commentFixMessage', () => {
  it('names the element and quotes the thread, words only', () => {
    const message = commentFixMessage(thread('main > h2:nth-of-type(2)', `Make this bigger\n\n![s.png](cowork-image:${IMAGE})`, ['and bold']));
    expect(message).toBe('Address this comment on the element `main > h2:nth-of-type(2)`:\n> Make this bigger\n> and bold');
  });

  it('quotes the text a text comment is on', () => {
    const selector = JSON.stringify({ type: 'text-range', path: 'index.html', start: 1, end: 5, quote: 'Q3  revenue' });
    expect(commentFixMessage(thread(selector, 'Wrong number'))).toBe('Address this comment on the text “Q3 revenue”:\n> Wrong number');
  });

  it('speaks of the whole artifact for a general comment', () => {
    expect(commentFixMessage(thread(null, 'Too long'))).toBe('Address this comment on the artifact:\n> Too long');
  });

  it('fits the bar request cap', () => {
    expect(commentFixMessage(thread(null, 'x'.repeat(10000))).length).toBe(MAX_REQUEST_CHARS);
  });
});
