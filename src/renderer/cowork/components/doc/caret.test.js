// Caret and selection helpers over a real (happy-dom) contentEditable.
import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  applyInlineFormat, caretOffset, caretOnEdgeLine, caretState, placeCaret, splitAtCaret, wrapSelection,
} from './caret';

function editable(html) {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

function select(startNode, start, endNode = startNode, end = start) {
  const range = document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

afterEach(() => {
  window.getSelection().removeAllRanges();
  document.body.innerHTML = '';
});

describe('splitAtCaret', () => {
  it('splits the inline Markdown at the caret, marks kept on both sides', () => {
    const el = editable('One <strong>bold</strong> two');
    select(el.querySelector('strong').firstChild, 2);
    expect(splitAtCaret(el)).toEqual({ before: 'One **bo**', after: '**ld** two' });
  });

  it('drops a selection before splitting', () => {
    const el = editable('Hello world');
    select(el.firstChild, 5, el.firstChild, 11);
    expect(splitAtCaret(el)).toEqual({ before: 'Hello', after: '' });
    expect(el.textContent).toBe('Hello');
  });

  it('keeps everything before when the caret is elsewhere', () => {
    const el = editable('*Hi*');
    const other = editable('x');
    select(other.firstChild, 0);
    expect(splitAtCaret(el)).toEqual({ before: '\\*Hi\\*', after: '' });
  });
});

describe('caretOffset and caretState', () => {
  it('count plain characters across marks', () => {
    const el = editable('ab<em>cd</em>ef');
    select(el.querySelector('em').firstChild, 1);
    expect(caretOffset(el)).toBe(3);
    expect(caretState(el)).toMatchObject({ has: true, collapsed: true, atStart: false, atEnd: false, start: 3, end: 3, len: 6 });
  });

  it('know the start, the end and a selection', () => {
    const el = editable('abc');
    select(el.firstChild, 0);
    expect(caretState(el)).toMatchObject({ atStart: true, atEnd: false });
    select(el.firstChild, 3);
    expect(caretState(el)).toMatchObject({ atStart: false, atEnd: true });
    select(el.firstChild, 0, el.firstChild, 3);
    expect(caretState(el)).toMatchObject({ collapsed: false, atStart: false, atEnd: false });
  });

  it('say so when the caret is not inside', () => {
    const el = editable('abc');
    window.getSelection().removeAllRanges();
    expect(caretOffset(el)).toBeNull();
    expect(caretState(el)).toEqual({ has: false, collapsed: true, atStart: false, atEnd: false });
  });
});

describe('caretOnEdgeLine', () => {
  it('falls back to the start and end when the browser gives no line boxes', () => {
    const el = editable('abc');
    select(el.firstChild, 0);
    expect(caretOnEdgeLine(el, 'top')).toBe(true);
    expect(caretOnEdgeLine(el, 'bottom')).toBe(false);
    select(el.firstChild, 3);
    expect(caretOnEdgeLine(el, 'bottom')).toBe(true);
  });

  it('is never on an edge with a selection or no caret', () => {
    const el = editable('abc');
    select(el.firstChild, 0, el.firstChild, 2);
    expect(caretOnEdgeLine(el, 'top')).toBe(false);
    window.getSelection().removeAllRanges();
    expect(caretOnEdgeLine(el, 'top')).toBe(false);
  });
});

describe('placeCaret', () => {
  it('goes to the start, the end, or a plain-text offset', () => {
    const el = editable('ab<strong>cd</strong>');
    placeCaret(el, 'start');
    expect(caretOffset(el)).toBe(0);
    placeCaret(el, 'end');
    expect(caretOffset(el)).toBe(4);
    placeCaret(el, 3);
    expect(caretOffset(el)).toBe(3);
    placeCaret(el, 99);
    expect(caretOffset(el)).toBe(4);
    expect(document.activeElement).toBe(el);
  });

  it('selects it all, to be typed over', () => {
    const el = editable('Un<strong>titled</strong>');
    placeCaret(el, 'all');
    expect(window.getSelection().toString()).toBe('Untitled');
    expect(document.activeElement).toBe(el);
  });

  it('does nothing without an element', () => {
    expect(() => placeCaret(null)).not.toThrow();
  });
});

describe('wrapSelection and applyInlineFormat', () => {
  it('wraps the selected words and keeps them selected', () => {
    const el = editable('Use npm test');
    select(el.firstChild, 4, el.firstChild, 12);
    expect(wrapSelection(el, 'a', { href: 'https://x.io' })).toBe(true);
    expect(el.innerHTML).toBe('Use <a href="https://x.io">npm test</a>');
    expect(window.getSelection().toString()).toBe('npm test');
  });

  it('wraps nothing for a bare caret', () => {
    const el = editable('abc');
    select(el.firstChild, 1);
    expect(wrapSelection(el, 'code')).toBe(false);
  });

  it('marks code by hand and says the text changed', () => {
    const el = editable('x = 1');
    const onInput = vi.fn();
    el.addEventListener('input', onInput);
    select(el.firstChild, 0, el.firstChild, 5);
    applyInlineFormat('code', el);
    expect(el.innerHTML).toBe('<code>x = 1</code>');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('leaves bold, italic and strike to the browser', () => {
    const exec = vi.fn();
    const had = document.execCommand;
    document.execCommand = exec;
    try {
      applyInlineFormat('bold', editable('a'));
      applyInlineFormat('strike', editable('a'));
      expect(exec.mock.calls).toEqual([['bold'], ['strikeThrough']]);
    } finally {
      document.execCommand = had;
    }
  });
});
