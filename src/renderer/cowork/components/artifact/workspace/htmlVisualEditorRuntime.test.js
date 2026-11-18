import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHtmlVisualEditorRuntime,
  HTML_VISUAL_EDITOR_ATTRIBUTE as ATTR,
  HTML_VISUAL_EDITOR_PARENT_SOURCE,
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

function key(target, name) {
  const event = trusted(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  target.dispatchEvent(event);
  return event;
}

function setMode(mode) {
  window.dispatchEvent(trusted(new MessageEvent('message', {
    source: window.parent,
    data: { source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'mode', mode },
  })));
}

// Live edit's Navigate / Edit switch (ENG-4383): Navigate leaves the page
// working, Edit holds it still and edits any text on click, a button's too.
describe('HTML visual editor runtime', () => {
  let messages;
  let registered;
  let pageClicks;
  let pageKeys;

  beforeEach(() => {
    messages = [];
    registered = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.source === HTML_VISUAL_EDITOR_SOURCE) messages.push(message);
    });
    // Every listener a runtime adds is removed after its test, so one test's
    // runtime never handles another test's events.
    for (const target of [window, document]) {
      const add = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
        registered.push([target, type, fn, options]);
        add(type, fn, options);
      });
    }
    document.body.innerHTML = `
      <section id="s1"><h1 ${ATTR}="e0" tabindex="0">First slide</h1></section>
      <section id="s2" hidden><h1 ${ATTR}="e1" tabindex="0">Second slide</h1></section>
      <button id="next" ${ATTR}="e2" tabindex="0">Next</button>
      <a id="away" href="other.html">Elsewhere</a>`;
    pageClicks = 0;
    pageKeys = [];
    // eslint-disable-next-line no-new-func
    new Function(createHtmlVisualEditorRuntime('tok'))();
    // The deck's own navigation, bound after the runtime as a page's would be.
    document.getElementById('next').addEventListener('click', () => {
      pageClicks += 1;
      document.getElementById('s1').hidden = true;
      document.getElementById('s2').hidden = false;
    });
    window.addEventListener('keydown', (event) => { pageKeys.push(event.key); });
  });

  afterEach(() => {
    for (const [target, type, fn, options] of registered) target.removeEventListener(type, fn, options);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-cowork-editor-mode');
  });

  const lastSelection = () => messages.filter((m) => m.type === 'selection').at(-1);

  it('starts in Edit mode and says so on the page, for the editor styles', () => {
    expect(messages.find((m) => m.type === 'ready')).toMatchObject({ editableCount: 3 });
    expect(document.documentElement.getAttribute('data-cowork-editor-mode')).toBe('edit');
  });

  describe('Edit', () => {
    it("edits a button's label on a plain click, and the page never sees the click", () => {
      const button = document.getElementById('next');
      const click = press(button);

      expect(button.getAttribute('contenteditable')).toBe('true');
      expect(lastSelection()).toMatchObject({ elementId: 'e2' });
      expect(click.defaultPrevented).toBe(true);
      expect(pageClicks).toBe(0);
    });

    it('opens no link', () => {
      const click = press(document.getElementById('away'));
      expect(click.defaultPrevented).toBe(true);
    });

    it('keeps keys typed into the text away from the page, so arrows never flip the slide', () => {
      press(document.querySelector(`[${ATTR}="e0"]`));
      key(document.querySelector(`[${ATTR}="e0"]`), 'ArrowRight');
      expect(pageKeys).toEqual([]);
    });

    it('leaves keys to the page when nothing is being edited', () => {
      key(document.body, 'ArrowRight');
      expect(pageKeys).toEqual(['ArrowRight']);
    });

    it('still edits text reached with the keyboard', () => {
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

  describe('Navigate', () => {
    beforeEach(() => setMode('navigate'));

    it('says so on the page, so no outline or text cursor shows', () => {
      expect(document.documentElement.getAttribute('data-cowork-editor-mode')).toBe('navigate');
    });

    it('lets a click reach the page, edits nothing, and opens links', () => {
      const click = press(document.getElementById('next'));
      expect(pageClicks).toBe(1);
      expect(document.getElementById('s2').hidden).toBe(false);
      expect(click.defaultPrevented).toBe(false);
      expect(document.getElementById('next').hasAttribute('contenteditable')).toBe(false);
      expect(lastSelection()).toBeUndefined();

      expect(press(document.getElementById('away')).defaultPrevented).toBe(false);
    });

    it('does not start editing on keyboard focus either', () => {
      document.getElementById('next').dispatchEvent(trusted(new FocusEvent('focusin', { bubbles: true })));
      expect(lastSelection()).toBeUndefined();
    });

    it('edits text on the slide the user moved to, once back in Edit', () => {
      press(document.getElementById('next'));
      setMode('edit');
      const heading = document.querySelector(`[${ATTR}="e1"]`);
      press(heading);
      expect(heading.getAttribute('contenteditable')).toBe('true');
      expect(lastSelection()).toMatchObject({ elementId: 'e1' });
    });

    it('finishes the text being edited when switching', () => {
      setMode('edit');
      press(document.querySelector(`[${ATTR}="e0"]`));
      setMode('navigate');
      expect(document.querySelector(`[${ATTR}="e0"]`).hasAttribute('contenteditable')).toBe(false);
      expect(lastSelection()).toMatchObject({ elementId: null });
    });
  });

  it('ignores a mode from anywhere but the parent', () => {
    window.dispatchEvent(trusted(new MessageEvent('message', {
      source: null,
      data: { source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'mode', mode: 'navigate' },
    })));
    expect(document.documentElement.getAttribute('data-cowork-editor-mode')).toBe('edit');
  });
});
