import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, trimCopiedSelection } from './clipboard';

function copyEvent(currentTarget = document.body) {
  const data = {};
  return {
    data,
    currentTarget,
    preventDefault: vi.fn(),
    clipboardData: { setData: (type, value) => { data[type] = value; } },
  };
}

function select(range) {
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

function selectContents(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return select(range);
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

  it('keeps the formatting of the element a partial selection sits inside', () => {
    document.body.innerHTML = '<div id="turn"><div class="bubble"><p><strong id="b">Ship it today</strong></p></div></div>';
    const text = document.getElementById('b').firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const selection = select(range);
    vi.spyOn(selection, 'toString').mockReturnValue('Ship \n\n');
    const event = copyEvent(document.getElementById('turn'));

    trimCopiedSelection(event);

    expect(event.data['text/html']).toBe('<p><strong>Ship </strong></p>');
  });

  it('keeps the list around a selection that spans list items', () => {
    document.body.innerHTML = '<div id="turn"><ul class="md-list"><li id="a">One</li><li id="b">Two</li></ul></div>';
    const range = document.createRange();
    range.setStart(document.getElementById('a').firstChild, 0);
    range.setEnd(document.getElementById('b'), 0);
    const selection = select(range);
    vi.spyOn(selection, 'toString').mockReturnValue('One\n\n');
    const event = copyEvent(document.getElementById('turn'));

    trimCopiedSelection(event);

    expect(event.data['text/html']).toBe('<ul><li id="a">One</li><li id="b"></li></ul>');
  });
});

/* The fallback copies from a hidden textarea it has to focus, the way the
   browser selects text in one. Run from a button in a popover, the focus must
   come back to that button, and the textarea must sit beside it: a popover
   whose focus leaves it (to the page's body) stops Tab from reaching its
   buttons. */
describe('copyText without the Clipboard API', () => {
  const execCommand = document.execCommand;
  afterEach(() => {
    document.execCommand = execCommand;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('copies from beside the focused element and gives focus back to it', async () => {
    document.body.innerHTML = '<div id="popup"><button id="copy">Copy</button><button id="next">Next</button></div>';
    const button = document.getElementById('copy');
    button.focus();
    if (navigator.clipboard) vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    // A browser focuses a textarea when it selects its text.
    vi.spyOn(HTMLTextAreaElement.prototype, 'select').mockImplementation(function select() {
      this.focus();
    });
    let copiedFrom = null;
    document.execCommand = vi.fn(() => {
      const el = document.activeElement;
      copiedFrom = { tagName: el.tagName, value: el.value, parent: el.parentElement };
      return true;
    });

    await expect(copyText('SELECT 1')).resolves.toBe(true);

    expect(copiedFrom).toEqual({ tagName: 'TEXTAREA', value: 'SELECT 1', parent: document.getElementById('popup') });
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
