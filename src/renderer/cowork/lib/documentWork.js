/*
 * Whether the person has started work in this document: typed into any field
 * or sent a message. Anything that would replace the document on its own
 * initiative, such as landing in another organization, asks first, because the
 * reload would take that work off the screen.
 *
 * Document-local on purpose: a reload starts clean.
 */

let started = false;

export function markWorkStarted() {
  started = true;
}

// Typing is caught here, for every field at once, so a new composer is covered
// without opting in. Ticking a box is not work a reload would lose. Text set
// by code (a draft, an example prompt) fires no event and marks itself.
const NOT_TYPED = new Set(['checkbox', 'radio', 'range', 'color']);

function onInput(event) {
  const field = event.target;
  if (field?.tagName === 'INPUT' && NOT_TYPED.has(field.type)) return;
  started = true;
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', onInput, true);
}

export function hasWorkStarted() {
  return started;
}

export function __resetWorkStartedForTests() {
  started = false;
}
