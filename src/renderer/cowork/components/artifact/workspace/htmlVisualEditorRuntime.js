export const HTML_VISUAL_EDITOR_ATTRIBUTE = 'data-cowork-editable-id';
export const HTML_VISUAL_EDITOR_SOURCE = 'cowork-artifact-visual-editor';
export const HTML_VISUAL_EDITOR_PARENT_SOURCE = 'cowork-artifact-visual-editor-parent';
// What a replayed view may hold. The preview shim caps the same values
// (cowork-server cowork/services/preview_shim.js); previewView.js validates
// them on the way in, and this runtime checks them again.
export const VIEW_LIMITS = Object.freeze({
  inputs: 50,
  steps: 32,
  path: 300,
  hash: 512,
  heading: 120,
  label: 80,
});
// The keys a deck moves with, and the legacy keyCode older decks read.
export const VIEW_KEY_CODES = Object.freeze({
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ' ': 32,
});

// This runs first inside the opaque, sandboxed artifact frame. The channel
// token stays in this closure and the script removes itself before artifact
// scripts run, so artifact code cannot impersonate an editing gesture.
export function createHtmlVisualEditorRuntime(token) {
  const source = JSON.stringify(HTML_VISUAL_EDITOR_SOURCE);
  const parentSource = JSON.stringify(HTML_VISUAL_EDITOR_PARENT_SOURCE);
  const attribute = JSON.stringify(HTML_VISUAL_EDITOR_ATTRIBUTE);
  const channelToken = JSON.stringify(token);
  const limits = JSON.stringify(VIEW_LIMITS);
  const keyCodes = JSON.stringify(VIEW_KEY_CODES);

  return `(() => {
    const SOURCE = ${source};
    const PARENT_SOURCE = ${parentSource};
    const ATTRIBUTE = ${attribute};
    const TOKEN = ${channelToken};
    const LIMITS = ${limits};
    const KEY_CODES = ${keyCodes};
    const sendToParent = window.parent.postMessage.bind(window.parent);
    document.currentScript?.remove();

    let active = null;
    let originalHtml = '';

    const send = (type, detail = {}) => {
      sendToParent({ source: SOURCE, token: TOKEN, type, ...detail }, '*');
    };

    const editableFrom = (target) => {
      if (!(target instanceof Element)) return null;
      return target.closest('[' + ATTRIBUTE + ']');
    };

    // Controls the replay below can click by their label. tabindex is not a
    // sign of a control: the editor adds it to every editable element.
    const INTERACTIVE = 'a[href], button, summary, label, select, [role="button"], [role="tab"], '
      + '[role="link"], [role="menuitem"], [role="option"], [onclick]';
    // The parent's Navigate / Edit switch (ENG-4383). 'navigate': the page is
    // the page, every click and key its own, nothing outlined or editable.
    // 'edit': the page holds still, no click reaches it and no link opens,
    // and any text, a button's or a link's included, is edited on click.
    // The CSS keys on the attribute (htmlVisualEditorDocument EDITOR_STYLE).
    let mode = 'edit';
    const setMode = (next) => {
      if (next !== 'edit' && next !== 'navigate') return;
      if (next !== mode) finish();
      mode = next;
      document.documentElement.setAttribute('data-cowork-editor-mode', mode);
    };
    // A click focuses what it lands on after pointerdown; that focus must not
    // start editing a second time. Keyboard focus (Tab) still does.
    let pointerFocus = false;

    const labelFor = (element) => {
      const explicit = element.getAttribute('aria-label');
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) return 'Heading';
      if (tag === 'p') return 'Paragraph';
      if (tag === 'li') return 'List item';
      if (tag === 'button') return 'Button label';
      if (tag === 'figcaption' || tag === 'caption') return 'Caption';
      return 'Text';
    };

    const reportSelection = () => {
      send('selection', active ? {
        elementId: active.getAttribute(ATTRIBUTE),
        label: labelFor(active),
      } : { elementId: null, label: null });
    };

    const finish = () => {
      if (!active) return;
      active.removeAttribute('contenteditable');
      active.removeAttribute('spellcheck');
      active.removeAttribute('data-cowork-editor-selected');
      active = null;
      originalHtml = '';
      reportSelection();
    };

    const activate = (element, placeCaret = false) => {
      if (active === element) return;
      finish();
      active = element;
      originalHtml = element.innerHTML;
      element.setAttribute('contenteditable', 'true');
      element.setAttribute('spellcheck', 'true');
      element.setAttribute('data-cowork-editor-selected', '');
      if (placeCaret) {
        element.focus({ preventScroll: true });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      reportSelection();
    };

    const reportChange = () => {
      if (!active) return;
      send('change', {
        elementId: active.getAttribute(ATTRIBUTE),
        html: active.innerHTML,
      });
    };

    const moveSelection = (direction) => {
      const elements = [...document.querySelectorAll('[' + ATTRIBUTE + ']')];
      const index = elements.indexOf(active);
      const next = elements[index + direction];
      if (next) {
        activate(next, true);
        return true;
      }
      finish();
      return false;
    };

    // Opening on the preview's view. The parent sends, once per document, what
    // the preview shim saw: hash, scroll, the user's navigation inputs since
    // load, and the heading on screen. The inputs are replayed as untrusted
    // events, which every editing handler above and below ignores, and the
    // heading checks the replay landed where the preview is. Until it is done
    // the user's own gestures are held back, so editing starts on the right
    // slide and nothing moves the page under the replay.
    const REPLAY_BUDGET_MS = 8000;
    const STEP_WAIT_MS = 1000;
    const PATH_STEP = /^(?:#[A-Za-z][A-Za-z0-9_.:-]{0,99}|[A-Za-z][A-Za-z0-9-]{0,63}:[0-9]{1,4})$/;
    let syncing = false;
    let viewApplied = false;

    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    const clipText = (value, limit) => String(value == null ? '' : value)
      .replace(/\\s+/g, ' ').trim().slice(0, limit);
    const offset = (value) => (
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, 1e7) : 0
    );

    const nextFrame = () => new Promise((resolve) => {
      let done = false;
      const settled = () => { if (!done) { done = true; resolve(); } };
      try { requestAnimationFrame(() => requestAnimationFrame(settled)); } catch { /* no frames */ }
      setTimeout(settled, 50);
    });

    // After an input: a frame for the page to react, then any short CSS
    // transition it started (decks often ignore input mid-transition).
    const settle = async () => {
      await nextFrame();
      let running = [];
      try {
        running = (document.getAnimations?.() || []).filter((animation) => {
          if (animation.playState !== 'running') return false;
          const end = animation.effect?.getComputedTiming?.().endTime;
          const left = Number(end) - (Number(animation.currentTime) || 0);
          return Number.isFinite(left) && left <= 1500;
        });
      } catch { running = []; }
      if (running.length) {
        await Promise.race([Promise.allSettled(running.map((animation) => animation.finished)), wait(STEP_WAIT_MS)]);
      }
      await wait(30);
    };

    const loaded = () => (document.readyState === 'complete'
      ? Promise.resolve()
      : new Promise((resolve) => { window.addEventListener('load', resolve, { once: true }); }));

    // The shim's element path: tag:index steps (index among same-tag
    // siblings) from <body>, or from an element id as the first step.
    const resolvePath = (path) => {
      if (typeof path !== 'string' || !path || path.length > LIMITS.path) return null;
      const steps = path.split('/');
      if (steps.length > LIMITS.steps || !steps.every((step) => PATH_STEP.test(step))) return null;
      let element = document.body;
      for (let i = 0; i < steps.length && element; i += 1) {
        const step = steps[i];
        if (step[0] === '#') {
          if (i !== 0) return null;
          element = document.getElementById(step.slice(1));
          continue;
        }
        const colon = step.lastIndexOf(':');
        const tag = step.slice(0, colon);
        const index = Number(step.slice(colon + 1));
        let seen = -1;
        let found = null;
        for (const child of element.children) {
          if (child.localName === tag) {
            seen += 1;
            if (seen === index) { found = child; break; }
          }
        }
        element = found;
      }
      return element || null;
    };

    // The topmost heading on screen; the shim runs the same rule.
    const visibleHeading = () => {
      let best = null;
      let bestTop = 0;
      let bestLeft = 0;
      const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
      for (let i = 0; i < nodes.length && i < 500; i += 1) {
        const node = nodes[i];
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.right <= 0
          || rect.top >= window.innerHeight || rect.left >= window.innerWidth) continue;
        if (node.checkVisibility && !node.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        if (!best || rect.top < bestTop - 1 || (Math.abs(rect.top - bestTop) <= 1 && rect.left < bestLeft)) {
          best = node;
          bestTop = rect.top;
          bestLeft = rect.left;
        }
      }
      return best ? clipText(best.textContent, LIMITS.heading) : '';
    };

    // A heading the change itself rewrote ("retitle this slide") is gone from
    // the page and can't be checked; one still on the page but not on screen
    // means the replay went somewhere else.
    const headingOnPage = (text) => {
      const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
      for (let i = 0; i < nodes.length && i < 500; i += 1) {
        if (clipText(nodes[i].textContent, LIMITS.heading) === text) return true;
      }
      return false;
    };

    const replayKey = (input) => {
      const key = input.key;
      if (typeof key !== 'string' || !Object.hasOwn(KEY_CODES, key)) return false;
      const keyCode = KEY_CODES[key];
      const target = document.body || document.documentElement;
      for (const type of ['keydown', 'keyup']) {
        const event = new KeyboardEvent(type, {
          key,
          code: key === ' ' ? 'Space' : key,
          shiftKey: input.shiftKey === true,
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
        });
        // The constructor drops keyCode; decks written against it still read it.
        try {
          Object.defineProperty(event, 'keyCode', { get: () => keyCode });
          Object.defineProperty(event, 'which', { get: () => keyCode });
        } catch { /* keep key alone */ }
        target.dispatchEvent(event);
      }
      return true;
    };

    // By its path, or, when the path finds nothing (the page built its DOM a
    // little differently this time), by the one control with the same label.
    const clickTarget = (input) => {
      const element = resolvePath(input.path);
      if (element) return element;
      const label = typeof input.label === 'string' ? clipText(input.label, LIMITS.label) : '';
      if (!label) return null;
      const matches = [...document.querySelectorAll(INTERACTIVE)]
        .filter((control) => clipText(control.textContent, LIMITS.label) === label);
      return matches.length === 1 ? matches[0] : null;
    };

    const replayClick = (input) => {
      const element = clickTarget(input);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      const Pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      element.dispatchEvent(new Pointer('pointerdown', { ...init, pointerId: 1, isPrimary: true }));
      element.dispatchEvent(new MouseEvent('mousedown', init));
      element.dispatchEvent(new Pointer('pointerup', { ...init, pointerId: 1, isPrimary: true }));
      element.dispatchEvent(new MouseEvent('mouseup', init));
      element.dispatchEvent(new MouseEvent('click', init));
      return true;
    };

    const restoreScroll = (view) => {
      const container = view.container;
      if (container && typeof container === 'object') {
        const element = resolvePath(container.path);
        if (element) {
          element.scrollTop = offset(container.top);
          element.scrollLeft = offset(container.left);
        }
      }
      try { window.scrollTo(offset(view.scrollX), offset(view.scrollY)); } catch { /* no scrolling */ }
    };

    const applyView = async (view) => {
      if (viewApplied || !view || typeof view !== 'object') return;
      viewApplied = true;
      syncing = true;
      finish();
      let status = 'ok';
      let done = 0;
      const replayed = [];
      try {
        await Promise.race([loaded(), wait(5000)]);
        await settle();
        const inputs = Array.isArray(view.inputs) ? view.inputs.slice(0, LIMITS.inputs) : [];
        const deadline = Date.now() + REPLAY_BUDGET_MS;
        let moved = false;
        let missed = false;
        for (const input of inputs) {
          if (Date.now() > deadline) { missed = true; break; }
          let ok = false;
          if (input?.type === 'key') ok = replayKey(input);
          else if (input?.type === 'click') ok = replayClick(input);
          if (!ok) { missed = true; break; }
          moved = true;
          done += 1;
          await settle();
        }
        const hash = typeof view.hash === 'string' && view.hash[0] === '#'
          ? view.hash.slice(0, LIMITS.hash) : '';
        if (hash && hash !== window.location.hash) {
          window.location.hash = hash;
          moved = true;
          await settle();
        }
        restoreScroll(view);
        const expected = typeof view.heading === 'string' ? clipText(view.heading, LIMITS.heading) : '';
        if (expected && (moved || missed)) {
          status = visibleHeading() === expected || (!missed && !headingOnPage(expected)) ? 'ok' : 'mismatch';
        } else if (missed) {
          status = 'mismatch';
        }
        if (status === 'ok') replayed.push(...inputs.slice(0, done));
      } catch {
        status = 'mismatch';
      } finally {
        syncing = false;
      }
      send('view-applied', { status });
      if (status === 'ok') adoptReplayedView(replayed);
    };

    // Registered on window before any artifact script runs, so these see a
    // gesture first. While a view is replayed the user's own input waits.
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'keydown'].forEach((type) => {
      window.addEventListener(type, (event) => {
        if (!syncing || !event.isTrusted) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });
    // A replayed click on a link to another page would take the editor
    // frame off the document. Same-page (#) links still move.
    window.addEventListener('click', (event) => {
      if (!syncing || event.isTrusted || !(event.target instanceof Element)) return;
      const link = event.target.closest('a[href], area[href]');
      if (link && !(link.getAttribute('href') || '').startsWith('#')) event.preventDefault();
    });


    // ---- View recorder (ENG-4383) -------------------------------------------
    // Where the user is in this canvas, reported to the parent so a rebuild
    // (a quick edit or an agent change landed, a save changed the source, a
    // discard) reopens on the same slide, and so a save made from Live edit
    // keeps the Preview there too. The same record the preview shim keeps
    // (cowork-server preview_shim.js): hash, scroll, the last scrolled
    // container, the heading on screen, and the user's navigation inputs
    // since load — a trusted key or click is kept only when the page changed
    // its DOM within SETTLE_MS. Changes the editor makes itself (selecting,
    // typing, the mode attribute) are not the page reacting. Kept apart from
    // the editing handlers on purpose; it only reads the mode.
    const NAV_SETTLE_MS = 250;
    const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
    const EDITOR_ATTRIBUTES = new Set([
      'contenteditable', 'spellcheck', 'data-cowork-editor-selected', 'data-cowork-editor-mode', 'tabindex', ATTRIBUTE,
    ]);
    const ID_RE = /^[A-Za-z][\\w.:-]{0,99}$/;
    let viewInputs = [];
    let viewOverflow = false;
    let scrolledElement = null;
    let lastViewText = '';
    let viewTimers = [];
    let scrollTimer = 0;

    const pathOf = (start) => {
      const steps = [];
      let element = start;
      while (element && element.nodeType === 1 && element !== document.body) {
        if (steps.length >= LIMITS.steps) return '';
        const id = element.id;
        if (id && ID_RE.test(id) && document.getElementById(id) === element) {
          steps.unshift('#' + id);
          break;
        }
        const tag = element.localName;
        let index = 0;
        for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (sibling.localName === tag) index += 1;
        }
        steps.unshift(tag + ':' + index);
        element = element.parentElement;
      }
      if (!element || !steps.length || (element !== document.body && steps[0][0] !== '#')) return '';
      const path = steps.join('/');
      return path.length <= LIMITS.path ? path : '';
    };

    const sendEditorView = () => {
      if (syncing) return;
      const view = {
        type: 'view',
        hash: String(window.location.hash || '').slice(0, LIMITS.hash),
        scrollX: Math.round(window.scrollX || 0),
        scrollY: Math.round(window.scrollY || 0),
        container: null,
        inputs: viewOverflow ? [] : viewInputs.slice(),
        overflow: viewOverflow,
        heading: visibleHeading(),
      };
      if (scrolledElement && scrolledElement.isConnected) {
        const where = pathOf(scrolledElement);
        if (where) {
          view.container = {
            path: where,
            top: Math.round(scrolledElement.scrollTop || 0),
            left: Math.round(scrolledElement.scrollLeft || 0),
          };
        }
      }
      const text = JSON.stringify(view);
      if (text === lastViewText) return;
      lastViewText = text;
      send('view', { view });
    };

    const scheduleEditorView = () => {
      viewTimers.forEach((timer) => clearTimeout(timer));
      viewTimers = [setTimeout(sendEditorView, 150), setTimeout(sendEditorView, 900)];
    };

    // After a replay that landed, the canvas is where those inputs lead: they
    // are its own from here on, so the next rebuild replays the whole way.
    const adoptReplayedView = (inputs) => {
      viewInputs = inputs.slice(0, LIMITS.inputs);
      viewOverflow = false;
      lastViewText = '';
      sendEditorView();
    };

    const pageReacted = (records) => records.some((record) => {
      const target = record.target;
      if (active && (target === active || active.contains(target))) return false;
      if (record.type === 'attributes' && EDITOR_ATTRIBUTES.has(record.attributeName)) return false;
      return true;
    });

    const recordInput = (input) => {
      if (viewOverflow || typeof MutationObserver !== 'function' || !document.body) return;
      let changed = false;
      const observer = new MutationObserver((records) => {
        if (!changed && pageReacted(records)) changed = true;
      });
      observer.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
      setTimeout(() => {
        observer.disconnect();
        if (!changed) return;
        if (viewInputs.length >= LIMITS.inputs) {
          viewOverflow = true;
          viewInputs = [];
        } else {
          viewInputs.push(input);
        }
        scheduleEditorView();
      }, NAV_SETTLE_MS);
    };

    // On window, ahead of the editing handlers below (which stop events):
    // the recorder only looks.
    window.addEventListener('keydown', (event) => {
      try {
        if (syncing || !event.isTrusted || active) return;
        if (event.ctrlKey || event.metaKey || event.altKey || !Object.hasOwn(KEY_CODES, event.key)) return;
        const target = event.target;
        // Typing in a field is not navigation; Space or Enter on a control
        // also clicks it, which is recorded on its own.
        if (target instanceof Element && (target.closest(FIELD) || target.closest(INTERACTIVE))) return;
        recordInput({ type: 'key', key: event.key, shiftKey: !!event.shiftKey });
      } catch { /* never break the page */ }
    }, true);

    window.addEventListener('click', (event) => {
      try {
        // In Edit mode a click edits and never reaches the page.
        if (syncing || !event.isTrusted || event.button !== 0 || mode !== 'navigate') return;
        if (!(event.target instanceof Element)) return;
        const control = event.target.closest(INTERACTIVE) || event.target;
        const where = pathOf(control);
        if (!where) return;
        recordInput({ type: 'click', path: where, label: clipText(control.textContent, LIMITS.label) });
      } catch { /* never break the page */ }
    }, true);

    window.addEventListener('hashchange', () => {
      try { scheduleEditorView(); } catch { /* never break the page */ }
    });

    window.addEventListener('scroll', (event) => {
      try {
        if (event.target instanceof Element) scrolledElement = event.target;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(sendEditorView, 200);
      } catch { /* never break the page */ }
    }, { capture: true, passive: true });
    // ---- end view recorder ---------------------------------------------------

    // Edit mode holds the page still: on window, ahead of any listener the
    // artifact adds, a person's pointer goes to the editor and never on to
    // the page. Caret placement is the default action, so it still happens;
    // a link's or a form's is not, so neither navigates.
    window.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || syncing || mode !== 'edit') return;
      const next = editableFrom(event.target);
      pointerFocus = true;
      setTimeout(() => { pointerFocus = false; }, 0);
      if (next) activate(next);
      else finish();
      event.stopImmediatePropagation();
    }, true);
    ['mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'submit'].forEach((type) => {
      window.addEventListener(type, (event) => {
        if (!event.isTrusted || syncing || mode !== 'edit') return;
        // The caret is placed on mousedown, so cancelling the click costs
        // the editing nothing and keeps a link, or a button in a form, still.
        if (type === 'click' || type === 'auxclick' || type === 'submit') event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    });

    // Keys typed into the text being edited are the editor's alone: on
    // window, ahead of the artifact's listeners, so an arrow key moves the
    // caret and never the deck. With nothing being edited, keys are the
    // page's, in either mode.
    window.addEventListener('keydown', (event) => {
      if (!event.isTrusted || syncing || !active) return;
      event.stopImmediatePropagation();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 's') {
        event.preventDefault();
        send('save');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        active.innerHTML = originalHtml;
        send('cancel', { elementId: active.getAttribute(ATTRIBUTE) });
        finish();
        return;
      }
      if (event.key === 'Tab') {
        if (moveSelection(event.shiftKey ? -1 : 1)) event.preventDefault();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        document.execCommand('insertLineBreak');
        reportChange();
      }
    }, true);

    const setup = () => {
      const elements = document.querySelectorAll('[' + ATTRIBUTE + ']');
      setMode(mode);
      const readyDetail = () => ({ editableCount: elements.length });
      send('ready', readyDetail());

      document.addEventListener('focusin', (event) => {
        if (!event.isTrusted || pointerFocus || mode !== 'edit') return;
        const next = editableFrom(event.target);
        if (next && next !== active) activate(next, true);
      }, true);

      document.addEventListener('input', (event) => {
        if (!event.isTrusted || !active || !active.contains(event.target)) return;
        reportChange();
        event.stopImmediatePropagation();
      }, true);

      document.addEventListener('paste', (event) => {
        if (!event.isTrusted || !active || !active.contains(event.target)) return;
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
        reportChange();
      }, true);

      document.addEventListener('drop', (event) => {
        if (!active || !active.contains(event.target)) return;
        event.preventDefault();
      }, true);


      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!event.isTrusted || event.source !== window.parent || message?.source !== PARENT_SOURCE) return;
        if (message.type === 'finish') {
          active?.blur();
          finish();
        } else if (message.type === 'status') {
          send('ready', readyDetail());
        } else if (message.type === 'view') {
          applyView(message.view);
        } else if (message.type === 'mode') {
          setMode(message.mode);
        }
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setup, { once: true });
    } else {
      setup();
    }
  })();`;
}
