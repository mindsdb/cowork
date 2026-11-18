import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHtmlComparisonRuntime,
  HTML_COMPARISON_ACTIVE_ATTRIBUTE as ACTIVE,
  HTML_COMPARISON_ATTRIBUTE as ATTR,
  HTML_COMPARISON_HIGHLIGHT_MS,
  HTML_COMPARISON_PARENT_SOURCE,
  HTML_COMPARISON_SOURCE,
} from './htmlComparisonRuntime';

// jsdom marks dispatched events untrusted, and the runtime ignores those so
// artifact scripts cannot fake one. The parent's message and the user's key
// press are what is under test, so they are marked trusted.
function trusted(event) {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

// In a top-level jsdom window, window.parent is the window itself.
function fromParent(data, source = window.parent) {
  window.dispatchEvent(trusted(new MessageEvent('message', { data, source })));
}

const goto = (index, extra = {}) => ({
  source: HTML_COMPARISON_PARENT_SOURCE, token: 'tok', type: 'goto', index, ...extra,
});

describe('HTML comparison runtime', () => {
  let messages;
  let scrolled;
  let listeners;

  beforeEach(() => {
    vi.useFakeTimers();
    messages = [];
    scrolled = [];
    listeners = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.source === HTML_COMPARISON_SOURCE) messages.push(message);
    });
    // Each test runs a fresh runtime; drop the previous one's listeners.
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      listeners.push([type, listener, options]);
      addEventListener(type, listener, options);
    });
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView() { scrolled.push(this); });
    document.body.innerHTML = `
      <h1 ${ATTR}="0">First</h1>
      <p ${ATTR}="2">Third</p>
      <input id="field">`;
    // eslint-disable-next-line no-new-func
    new Function(createHtmlComparisonRuntime('tok'))();
  });

  afterEach(() => {
    for (const [type, listener, options] of listeners) window.removeEventListener(type, listener, options);
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete Element.prototype.scrollIntoView;
    document.body.innerHTML = '';
  });

  it('scrolls to the numbered change and highlights it briefly', () => {
    fromParent(goto(2));
    const target = document.querySelector(`[${ATTR}="2"]`);
    expect(scrolled).toEqual([target]);
    expect(target.hasAttribute(ACTIVE)).toBe(true);

    vi.advanceTimersByTime(HTML_COMPARISON_HIGHLIGHT_MS);
    expect(target.hasAttribute(ACTIVE)).toBe(false);
  });

  it('moves the highlight when the parent jumps again', () => {
    fromParent(goto(0));
    fromParent(goto(2));
    expect(document.querySelector(`[${ATTR}="0"]`).hasAttribute(ACTIVE)).toBe(false);
    expect(document.querySelector(`[${ATTR}="2"]`).hasAttribute(ACTIVE)).toBe(true);
  });

  it('stays put for a change this side does not have', () => {
    fromParent(goto(1));
    expect(scrolled).toEqual([]);
    expect(document.querySelector(`[${ACTIVE}]`)).toBeNull();
  });

  it('ignores a wrong token, another sender, and untrusted messages', () => {
    fromParent(goto(0, { token: 'guess' }));
    fromParent(goto(0), null);
    window.dispatchEvent(new MessageEvent('message', { data: goto(0), source: window.parent }));
    expect(scrolled).toEqual([]);
  });

  it('reports Alt+Arrow to the parent, since keys in the frame never reach it', () => {
    window.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, cancelable: true })));
    window.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, cancelable: true })));
    window.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true })));
    expect(messages).toEqual([
      { source: HTML_COMPARISON_SOURCE, token: 'tok', type: 'step', direction: 1 },
      { source: HTML_COMPARISON_SOURCE, token: 'tok', type: 'step', direction: -1 },
    ]);
  });

  it('leaves Alt+Arrow to a text field in the page', () => {
    document.getElementById('field').dispatchEvent(trusted(new KeyboardEvent('keydown', {
      key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true,
    })));
    expect(messages).toEqual([]);
  });
});
