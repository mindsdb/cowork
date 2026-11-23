export const HTML_COMPARISON_ATTRIBUTE = 'data-cowork-comparison-change';
export const HTML_COMPARISON_ACTIVE_ATTRIBUTE = 'data-cowork-comparison-active';
export const HTML_COMPARISON_SOURCE = 'cowork-artifact-comparison';
export const HTML_COMPARISON_PARENT_SOURCE = 'cowork-artifact-comparison-parent';
export const HTML_COMPARISON_HIGHLIGHT_MS = 1400;

// Runs first inside each opaque, sandboxed comparison frame, the same way the
// visual editor runtime does: the token stays in this closure and the script
// removes itself before artifact scripts run. The parent asks it to scroll to
// a numbered change; it reports Alt+Arrow presses back, since keys typed
// inside the frame never reach the parent window.
export function createHtmlComparisonRuntime(token) {
  const source = JSON.stringify(HTML_COMPARISON_SOURCE);
  const parentSource = JSON.stringify(HTML_COMPARISON_PARENT_SOURCE);
  const attribute = JSON.stringify(HTML_COMPARISON_ATTRIBUTE);
  const activeAttribute = JSON.stringify(HTML_COMPARISON_ACTIVE_ATTRIBUTE);
  const channelToken = JSON.stringify(token);

  return `(() => {
    const SOURCE = ${source};
    const PARENT_SOURCE = ${parentSource};
    const ATTRIBUTE = ${attribute};
    const ACTIVE = ${activeAttribute};
    const TOKEN = ${channelToken};
    const HIGHLIGHT_MS = ${HTML_COMPARISON_HIGHLIGHT_MS};
    const sendToParent = window.parent.postMessage.bind(window.parent);
    document.currentScript?.remove();

    let highlighted = null;
    let highlightTimer = 0;

    const clearHighlight = () => {
      clearTimeout(highlightTimer);
      highlighted?.removeAttribute(ACTIVE);
      highlighted = null;
    };

    const goto = (index) => {
      if (!Number.isInteger(index) || index < 0) return;
      const target = document.querySelector('[' + ATTRIBUTE + '="' + index + '"]');
      clearHighlight();
      if (!target) return;
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
      target.setAttribute(ACTIVE, '');
      highlighted = target;
      highlightTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
    };

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (
        !event.isTrusted
        || event.source !== window.parent
        || message?.source !== PARENT_SOURCE
        || message.token !== TOKEN
      ) return;
      if (message.type === 'goto') goto(message.index);
    });

    window.addEventListener('keydown', (event) => {
      if (!event.isTrusted || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const target = event.target;
      if (!direction || target?.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target?.tagName || '')) return;
      event.preventDefault();
      sendToParent({ source: SOURCE, token: TOKEN, type: 'step', direction }, '*');
    }, true);
  })();`;
}
