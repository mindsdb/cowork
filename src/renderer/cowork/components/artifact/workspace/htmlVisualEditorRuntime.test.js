import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHtmlVisualEditorRuntime,
  HTML_VISUAL_EDITOR_ATTRIBUTE as ATTR,
  HTML_VISUAL_EDITOR_SOURCE,
} from './htmlVisualEditorRuntime';

// jsdom marks every dispatched event untrusted, and the runtime ignores those
// so artifact scripts cannot fake an editing gesture. A user's own gesture is
// what is under test here, so the events are marked trusted.
function trusted(event) {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

function press(element, init = {}) {
  element.dispatchEvent(trusted(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...init })));
  element.focus?.();
  const click = trusted(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  element.dispatchEvent(click);
  return click;
}

describe('HTML visual editor runtime', () => {
  let messages;
  let pageClicks;

  beforeEach(async () => {
    messages = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.source === HTML_VISUAL_EDITOR_SOURCE) messages.push(message);
    });
    document.body.innerHTML = `
      <section id="s1"><h1 ${ATTR}="e0" tabindex="0">First slide</h1></section>
      <section id="s2" hidden><h1 ${ATTR}="e1" tabindex="0">Second slide</h1></section>
      <button id="next" ${ATTR}="e2" tabindex="0">Next</button>`;
    pageClicks = 0;
    // The deck's own navigation, as a generated deck wires it.
    document.getElementById('next').addEventListener('click', () => {
      pageClicks += 1;
      document.getElementById('s1').hidden = true;
      document.getElementById('s2').hidden = false;
    });
    // eslint-disable-next-line no-new-func
    new Function(createHtmlVisualEditorRuntime('tok'))();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const lastSelection = () => messages.filter((m) => m.type === 'selection').at(-1);

  it('reports how many editable elements are also controls', () => {
    expect(messages.find((m) => m.type === 'ready')).toMatchObject({ editableCount: 3, interactiveCount: 1 });
  });

  it('lets a click on a control reach the page, so the user can move to another slide', () => {
    const click = press(document.getElementById('next'));
    expect(click.defaultPrevented).toBe(false);
    expect(pageClicks).toBe(1);
    expect(document.getElementById('s2').hidden).toBe(false);
    expect(lastSelection()).toBeUndefined();
  });

  it('edits text on the slide the user moved to', () => {
    press(document.getElementById('next'));
    const heading = document.querySelector(`[${ATTR}="e1"]`);
    press(heading);
    expect(heading.getAttribute('contenteditable')).toBe('true');
    expect(lastSelection()).toMatchObject({ elementId: 'e1' });
  });

  it('edits a control label on Alt-click instead of pressing it', () => {
    const button = document.getElementById('next');
    const click = press(button, { altKey: true });
    expect(click.defaultPrevented).toBe(true);
    expect(pageClicks).toBe(0);
    expect(button.getAttribute('contenteditable')).toBe('true');
    expect(lastSelection()).toMatchObject({ elementId: 'e2' });
  });

  it('keeps the page from seeing clicks inside a control while its label is edited', () => {
    const button = document.getElementById('next');
    press(button, { altKey: true });
    const click = press(button);
    expect(click.defaultPrevented).toBe(true);
    expect(pageClicks).toBe(0);
  });

  it('still edits a control reached with the keyboard', () => {
    const button = document.getElementById('next');
    button.dispatchEvent(trusted(new FocusEvent('focusin', { bubbles: true })));
    expect(lastSelection()).toMatchObject({ elementId: 'e2' });
  });

  it('ignores untrusted clicks', () => {
    document.getElementById('s1').querySelector('h1')
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(lastSelection()).toBeUndefined();
  });
});
