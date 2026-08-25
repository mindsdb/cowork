export const HTML_VISUAL_EDITOR_ATTRIBUTE = 'data-cowork-editable-id';
export const HTML_VISUAL_EDITOR_SOURCE = 'cowork-artifact-visual-editor';
export const HTML_VISUAL_EDITOR_PARENT_SOURCE = 'cowork-artifact-visual-editor-parent';

// This runs first inside the opaque, sandboxed artifact frame. The channel
// token stays in this closure and the script removes itself before artifact
// scripts run, so artifact code cannot impersonate an editing gesture.
export function createHtmlVisualEditorRuntime(token) {
  const source = JSON.stringify(HTML_VISUAL_EDITOR_SOURCE);
  const parentSource = JSON.stringify(HTML_VISUAL_EDITOR_PARENT_SOURCE);
  const attribute = JSON.stringify(HTML_VISUAL_EDITOR_ATTRIBUTE);
  const channelToken = JSON.stringify(token);

  return `(() => {
    const SOURCE = ${source};
    const PARENT_SOURCE = ${parentSource};
    const ATTRIBUTE = ${attribute};
    const TOKEN = ${channelToken};
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

    const setup = () => {
      const elements = document.querySelectorAll('[' + ATTRIBUTE + ']');
      send('ready', { editableCount: elements.length });

      document.addEventListener('pointerdown', (event) => {
        if (!event.isTrusted) return;
        const next = editableFrom(event.target);
        if (next) {
          activate(next);
          event.stopImmediatePropagation();
        } else {
          finish();
        }
      }, true);

      document.addEventListener('click', (event) => {
        if (!event.isTrusted || !editableFrom(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);

      document.addEventListener('focusin', (event) => {
        if (!event.isTrusted) return;
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

      document.addEventListener('keydown', (event) => {
        if (!event.isTrusted || !active) return;
        const modifier = event.metaKey || event.ctrlKey;
        if (modifier && event.key.toLowerCase() === 's') {
          event.preventDefault();
          send('save');
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          active.innerHTML = originalHtml;
          reportChange();
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

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!event.isTrusted || event.source !== window.parent || message?.source !== PARENT_SOURCE) return;
        if (message.type === 'finish') {
          active?.blur();
          finish();
        } else if (message.type === 'status') {
          send('ready', { editableCount: elements.length });
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
