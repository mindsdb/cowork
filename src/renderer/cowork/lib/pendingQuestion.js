import { isAutoApprovedCard } from './browserApproval';

/**
 * The question a turn is currently blocked on, or null.
 *
 * Derived from the live stream steps rather than tracked separately, so it
 * cannot drift: the answered state arrives on an event and clears this by
 * construction.
 *
 * `allow_custom` travels with it because the composer has to know whether typed
 * text can be an answer at all. Absent means true — the same permissive default
 * the adapter applies (`event.allow_custom !== false`), so only an explicit
 * `false` counts as select-only.
 */
export function pendingQuestionFor(steps) {
  const pending = (steps || []).filter(
    // A position card is answered by the app itself, never by typed text.
    (s) => s.badge === 'AskUser' && !s.data?.answer && !isAutoApprovedCard(s.data),
  );
  if (pending.length === 0) return null;
  const last = pending[pending.length - 1];
  return {
    question_id: last.data.question_id,
    allow_custom: last.data.allow_custom !== false,
  };
}
