import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  createHtmlVisualEditorRuntime,
  HTML_VISUAL_EDITOR_ATTRIBUTE as ATTR,
  HTML_VISUAL_EDITOR_PARENT_SOURCE,
  HTML_VISUAL_EDITOR_SOURCE,
} from './htmlVisualEditorRuntime';

// Opening the editor on the slide the Preview shows: the runtime replays the
// preview's navigation inputs as untrusted events, then checks the heading.

function trusted(event) {
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
}

// A generated deck: one slide visible at a time, toggled by class, moved by
// the arrow keys (read through the legacy keyCode) and a Next button.
const DECK = `
  <section class="slide active"><h1 ${ATTR}="e0" tabindex="0">One</h1></section>
  <section class="slide"><h1 ${ATTR}="e1" tabindex="0">Two</h1></section>
  <section class="slide"><h1 ${ATTR}="e2" tabindex="0">Three</h1></section>
  <nav id="nav"><button>Prev</button><button ${ATTR}="e3" tabindex="0">Next</button></nav>
  <a id="away" href="other.html">Elsewhere</a>`;

describe('HTML visual editor runtime: opening on the preview view', () => {
  let messages;
  let registered;
  let originalRect;
  let slide;

  const current = () => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active'));
  const go = (index) => {
    const slides = [...document.querySelectorAll('.slide')];
    slide = Math.max(0, Math.min(slides.length - 1, index));
    slides.forEach((s, i) => s.classList.toggle('active', i === slide));
  };
  const onDeckKey = (event) => {
    if (event.keyCode === 39) go(slide + 1);
    if (event.keyCode === 37) go(slide - 1);
  };
  const onDeckClick = (event) => {
    if (event.target.closest('#nav button:last-child')) go(slide + 1);
    if (event.target.closest('#nav button:first-child')) go(slide - 1);
  };

  const sendView = (view, source = window) => {
    window.dispatchEvent(trusted(new MessageEvent('message', {
      source,
      data: { source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'view', view },
    })));
  };
  const applied = () => messages.filter((m) => m.type === 'view-applied');

  beforeEach(() => {
    messages = [];
    registered = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      if (message?.source === HTML_VISUAL_EDITOR_SOURCE) messages.push(message);
    });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // Every listener a runtime adds is removed after its test, so one test's
    // runtime never replays another test's view.
    for (const target of [window, document]) {
      const add = target.addEventListener.bind(target);
      vi.spyOn(target, 'addEventListener').mockImplementation((type, fn, options) => {
        registered.push([target, type, fn, options]);
        add(type, fn, options);
      });
    }
    // jsdom has no layout: a heading on a visible slide is on screen.
    originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect() {
      const hiddenSlide = this.closest('.slide:not(.active)');
      return hiddenSlide
        ? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
        : { top: 20, left: 20, right: 220, bottom: 60, width: 200, height: 40 };
    };
    document.body.innerHTML = DECK;
    slide = 0;
    // eslint-disable-next-line no-new-func
    new Function(createHtmlVisualEditorRuntime('tok'))();
    // The page's own handlers, bound after the runtime as a page's would be.
    document.addEventListener('keydown', onDeckKey);
    document.addEventListener('click', onDeckClick);
  });

  afterEach(() => {
    for (const [target, type, fn, options] of registered) target.removeEventListener(type, fn, options);
    Element.prototype.getBoundingClientRect = originalRect;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    window.location.hash = '';
  });

  it('replays the preview\'s keys and control clicks and lands on its slide', async () => {
    sendView({
      inputs: [
        { type: 'key', key: 'ArrowRight', shiftKey: false },
        { type: 'click', path: '#nav/button:1', label: 'Next' },
      ],
      heading: 'Three',
    });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(current()).toBe(2);
    expect(applied()[0]).toMatchObject({ status: 'ok', token: 'tok' });
  });

  it('resolves a tag:index path from <body>', async () => {
    sendView({
      inputs: [{ type: 'click', path: 'nav:0/button:1' }, { type: 'click', path: 'nav:0/button:1' }],
      heading: 'Three',
    });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(current()).toBe(2);
  });

  it('finds a control by its label when its path is gone', async () => {
    sendView({ inputs: [{ type: 'click', path: 'header:0/button:0', label: 'Next' }], heading: 'Two' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(current()).toBe(1);
    expect(applied()[0].status).toBe('ok');
  });

  it('reports a mismatch when the heading on screen is not the preview\'s', async () => {
    sendView({ inputs: [{ type: 'key', key: 'ArrowRight' }], heading: 'Three' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(applied()[0].status).toBe('mismatch');
  });

  it('reports a mismatch when a recorded control is not in the page', async () => {
    sendView({ inputs: [{ type: 'click', path: 'main:0/button:4' }], heading: '' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(applied()[0].status).toBe('mismatch');
  });

  it('does not let the replay start editing', async () => {
    sendView({ inputs: [{ type: 'click', path: '#nav/button:1' }], heading: 'Two' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(messages.filter((m) => m.type === 'selection' && m.elementId)).toEqual([]);
    expect(document.querySelector('[contenteditable]')).toBeNull();
  });

  it('holds back the user\'s own clicks until the replay is done', async () => {
    sendView({ inputs: [{ type: 'key', key: 'ArrowRight' }], heading: 'Two' });
    const heading = document.querySelector(`[${ATTR}="e0"]`);
    const down = trusted(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    heading.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(heading.getAttribute('contenteditable')).toBeNull();

    await waitFor(() => expect(applied()).toHaveLength(1));
    const visible = document.querySelector(`[${ATTR}="e1"]`);
    visible.dispatchEvent(trusted(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })));
    expect(visible.getAttribute('contenteditable')).toBe('true');
  });

  it('applies one view per document', async () => {
    sendView({ inputs: [{ type: 'key', key: 'ArrowRight' }], heading: 'Two' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    sendView({ inputs: [{ type: 'key', key: 'ArrowRight' }], heading: 'Three' });
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(applied()).toHaveLength(1);
    expect(current()).toBe(1);
  });

  it('ignores a view that does not come from the parent window', async () => {
    window.dispatchEvent(trusted(new MessageEvent('message', {
      source: null,
      data: { source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'view', view: { inputs: [{ type: 'key', key: 'ArrowRight' }] } },
    })));
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      data: { source: HTML_VISUAL_EDITOR_PARENT_SOURCE, type: 'view', view: { inputs: [{ type: 'key', key: 'ArrowRight' }] } },
    }));
    await new Promise((resolve) => { setTimeout(resolve, 200); });
    expect(applied()).toEqual([]);
    expect(current()).toBe(0);
  });

  it('skips keys it does not know and stops there', async () => {
    sendView({ inputs: [{ type: 'key', key: 'Delete' }, { type: 'key', key: 'ArrowRight' }], heading: '' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(applied()[0].status).toBe('mismatch');
    expect(current()).toBe(0);
  });

  it('restores the hash and the scroll position', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="pane" style="overflow:auto"><p>x</p></div>');
    sendView({
      hash: '#pricing',
      scrollX: 0,
      scrollY: 1400,
      container: { path: '#pane', top: 300, left: 0 },
      inputs: [],
      heading: '',
    });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(window.location.hash).toBe('#pricing');
    expect(window.scrollTo).toHaveBeenCalledWith(0, 1400);
    expect(document.getElementById('pane').scrollTop).toBe(300);
    expect(applied()[0].status).toBe('ok');
  });

  it('keeps a replayed click on a link to another page from leaving the document', async () => {
    let seen = null;
    document.getElementById('away').addEventListener('click', (event) => { seen = event; });
    sendView({ inputs: [{ type: 'click', path: '#away' }], heading: '' });
    await waitFor(() => expect(applied()).toHaveLength(1));
    expect(seen).not.toBeNull();
    expect(seen.defaultPrevented).toBe(true);
  });
});
