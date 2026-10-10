import { afterEach, describe, expect, it, vi } from 'vitest';
import { trimCopiedSelection } from './clipboard';

function copyEvent() {
  const data = {};
  return {
    data,
    preventDefault: vi.fn(),
    clipboardData: { setData: (type, value) => { data[type] = value; } },
  };
}

function selectContents(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('trimCopiedSelection', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('drops the trailing newlines a selection past the end of a message picks up', () => {
    document.body.innerHTML = '<div id="m"><p>Ship it today</p></div>';
    const selection = selectContents(document.getElementById('m'));
    vi.spyOn(selection, 'toString').mockReturnValue('Ship it today\n\n\n\n');
    const event = copyEvent();

    trimCopiedSelection(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.data['text/plain']).toBe('Ship it today');
    expect(event.data['text/html']).toContain('<p>Ship it today</p>');
  });

  it('leaves the default copy alone when nothing trails the text', () => {
    document.body.innerHTML = '<p id="m">Ship it today</p>';
    selectContents(document.getElementById('m'));
    const event = copyEvent();

    trimCopiedSelection(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.data).toEqual({});
  });
});
