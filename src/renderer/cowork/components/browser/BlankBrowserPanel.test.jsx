import { describe, expect, it } from 'vitest';
import { BLANK_LINES, blankLineFor, browserRequestFor } from './BlankBrowserPanel';

describe('the blank browser page', () => {
  it('keeps one line per task', () => {
    expect(blankLineFor('task-1')).toBe(blankLineFor('task-1'));
    expect(BLANK_LINES).toContain(blankLineFor('task-2'));
  });

  it('opens a link, and searches anything else', () => {
    expect(browserRequestFor(' example.com/pricing ')).toBe('Open example.com/pricing in the browser.');
    expect(browserRequestFor('https://news.ycombinator.com')).toBe('Open https://news.ycombinator.com in the browser.');
    expect(browserRequestFor('best tacos in SF')).toBe('Search the web in the browser for: best tacos in SF');
  });
});
