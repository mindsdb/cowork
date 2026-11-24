/*
 * Whether the person has started work in this document: typed into a composer
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

export function hasWorkStarted() {
  return started;
}

export function __resetWorkStartedForTests() {
  started = false;
}
