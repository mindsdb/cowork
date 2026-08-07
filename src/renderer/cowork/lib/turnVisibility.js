// Which rows of a conversation actually render (ENG-1304, PR #580 review).
//
// A turn that failed before producing output hydrates as an assistant
// message with no content and no steps, immediately followed by its error
// (or provider_required) row. ChatView skips that empty bubble — and the
// orphan check must agree, because the skipped bubble used to be the only
// row carrying the turn's delete affordance. One predicate, two callers,
// so the two rules can't drift apart.

export function isSkippedFailedAssistant(messages, atIdx) {
  const a = messages[atIdx];
  if (a?.role !== 'assistant') return false;
  if (a.content || a.steps?.length) return false;
  const next = messages[atIdx + 1]?.role;
  return next === 'error' || next === 'provider_required';
}

// Index of the last user/assistant row that actually renders — skipped
// failed-assistant bubbles don't count, so when the final turn fails the
// always-visible toolbar follows the user message instead of a null row.
export function lastVisibleTurnIdx(messages) {
  for (let j = messages.length - 1; j >= 0; j--) {
    const role = messages[j]?.role;
    if (role === 'user') return j;
    if (role === 'assistant' && !isSkippedFailedAssistant(messages, j)) return j;
  }
  return -1;
}

// A user message is an orphan when no assistant bubble will render for its
// turn — either none exists (stopped before any response) or the one that
// exists is skipped. Orphans carry their own delete affordance.
export function isOrphanUser(messages, atIdx) {
  for (let j = atIdx + 1; j < messages.length; j++) {
    const role = messages[j]?.role;
    if (role === 'user') return true;
    if (role === 'assistant') return isSkippedFailedAssistant(messages, j);
  }
  return true;
}
