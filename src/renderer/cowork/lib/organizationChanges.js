// Desktop switches organization in place after the credential handoff succeeds.
// Notify mounted organization-scoped readers without waiting for a new subject
// or a reload. The subject keeps a late switch out of another account's state.
const listeners = new Set();

export function subscribeOrganizationChanges(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Errors are contained per listener, not allowed to escape the loop.
 *
 * A reader that throws used to take the whole notification with it, and on
 * desktop this is called next to the reload that moves the document onto the
 * new organization's stores — so one bad listener could strand the document on
 * the previous organization's data with nothing in the console to say why.
 * Containing it also keeps the listeners after the thrower subscribed.
 */
export function notifyOrganizationChanged(subject) {
  for (const listener of listeners) {
    try {
      listener(subject);
    } catch (err) {
      console.error('[organization] a change listener threw', err);
    }
  }
}
