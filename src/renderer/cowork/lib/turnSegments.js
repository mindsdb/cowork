// Split one assistant turn into render segments around its ask_user
// questions, so work done after an answer renders below that answer's card
// instead of above it (ENG-2981). Pure: same steps in, same segments out.
//
// `expired` is derived PER QUESTION, not per conversation. Conversation-level
// liveness ("this chat has something in flight") is the wrong granularity: it
// renders an unanswered card from an EARLIER turn with live buttons for as long
// as any new stream runs on the same conversation, and clicking it 404s — which
// then retires whatever question the new turn is actually blocked on.
//
// Two rules:
//   - an answered question is never expired; the card renders its outcome, and
//     the generic "no longer active" line would be noise on top of it
//   - only the LAST unanswered question of a LIVE turn can still be answered
//
// That last rule leans on an invariant owned by anton, not by this repo: the
// `ask_user` tool blocks the turn, so anton never publishes a second question
// while one is outstanding, and it always retires the outstanding one (answer,
// cancel, or the server's 300 s timeout) before the turn ends. This repo can
// neither see nor enforce that cross-repo contract, so an earlier unanswered
// card is treated as expired rather than trusted to still be answerable.

const isQuestion = (step) => step?.badge === 'AskUser';

/**
 * Returns, in event order:
 *   { kind: 'steps', key, steps, startedAt }
 *   { kind: 'question', key, step, expired }
 * Always starts and ends with a steps segment, and puts one (possibly empty)
 * between any two questions, so callers can always pick the live one.
 */
export function splitTurnSegments(steps, { startedAt = null, conversationLive = false } = {}) {
  const list = Array.isArray(steps) ? steps : [];
  let lastUnansweredId = null;
  for (const step of list) {
    if (isQuestion(step) && !step.data?.answer) lastUnansweredId = step.id;
  }

  const segments = [];
  // Work after a question starts when the user answered it; without an
  // answer time, when its first step started.
  const pushSteps = (seg, isFirst) => {
    if (!isFirst && seg.startedAt == null) seg.startedAt = seg.steps[0]?.startedAt ?? null;
    segments.push(seg);
  };
  let current = { kind: 'steps', key: 'seg-0', steps: [], startedAt };
  let isFirst = true;
  for (const step of list) {
    if (!isQuestion(step)) {
      current.steps.push(step);
      continue;
    }
    pushSteps(current, isFirst);
    isFirst = false;
    segments.push({
      kind: 'question',
      key: step.id,
      step,
      expired: !step.data?.answer && !(conversationLive && step.id === lastUnansweredId),
    });
    current = { kind: 'steps', key: `seg-${segments.length}`, steps: [], startedAt: step.completedAt ?? null };
  }
  pushSteps(current, isFirst);
  return segments;
}

/**
 * Index of the steps segment that carries a live turn's in-flight header.
 * While the last question waits on the user, the header stays above its card
 * (the segment right before it) so nothing renders below a pending card; once
 * it is answered — or timed out / cancelled, which also sets `answer` — the
 * header moves to the last segment, below the card.
 */
export function liveSegmentIndex(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return -1;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    if (segments[i].kind !== 'question') continue;
    return segments[i].step.data?.answer ? segments.length - 1 : i - 1;
  }
  return segments.length - 1;
}
