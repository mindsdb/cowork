// Decisions behind the Compare models screen, kept out of React so they can be
// tested directly. A "side" is one model's conversation; a "turn" is one user
// message and whatever the agent answered to it.

export const SIDE_LABELS = ['a', 'b'];

const FAILED_ROLES = new Set(['error', 'provider_required']);

/** Failures that mean the account could not pay for the turn, not that the
 *  model did badly: the paid balance ran out, or the free Air allowance did. */
export const CREDIT_FAILURE_CODES = new Set(['token_limit', 'included_allowance_exhausted']);

export function isCreditFailure(turn) {
  return turn?.reply === 'failed' && CREDIT_FAILURE_CODES.has(turn.failureCode);
}

/**
 * Split a side's messages into turns.
 *
 * `reply` is 'running' while the side is still answering, 'done' once an
 * answer landed, 'failed' when the turn ended in an error card, and 'none' for
 * a turn that ended with nothing (a cancelled send).
 */
export function turnsOf(messages = []) {
  const turns = [];
  for (const message of messages || []) {
    if (!message) continue;
    if (message.role === 'user') {
      turns.push({
        text: typeof message.content === 'string' ? message.content : '',
        userAt: message.created_at || null,
        reply: 'none',
        replyAt: null,
        failureCode: null,
      });
      continue;
    }
    const turn = turns[turns.length - 1];
    if (!turn) continue;
    if (message.role === '_streaming') {
      turn.reply = 'running';
    } else if (message.role === 'assistant') {
      turn.reply = 'done';
      turn.replyAt = message.created_at || turn.replyAt;
    } else if (FAILED_ROLES.has(message.role)) {
      turn.reply = 'failed';
      turn.replyAt = message.created_at || turn.replyAt;
      turn.failureCode = message.code || null;
    }
  }
  return turns;
}

/**
 * The first turn at which the two sides stop having been asked the same thing,
 * or null while every turn so far went to both. A follow-up sent to one side
 * shows up here as a turn the other side lacks, or asked differently.
 */
export function divergedAt(aTurns = [], bTurns = []) {
  const shared = Math.min(aTurns.length, bTurns.length);
  for (let i = 0; i < shared; i += 1) {
    if (aTurns[i].text !== bTurns[i].text) return i;
  }
  return aTurns.length === bTurns.length ? null : shared;
}

const FINISHED = new Set(['done', 'failed']);

/**
 * The latest turn both sides were asked and both have finished, or null.
 * Stops at the point the sides diverged: after it, the two are no longer
 * answering the same question.
 */
export function latestSharedTurn(aTurns = [], bTurns = []) {
  const diverged = divergedAt(aTurns, bTurns);
  const limit = diverged === null ? Math.min(aTurns.length, bTurns.length) : diverged;
  for (let i = limit - 1; i >= 0; i -= 1) {
    if (FINISHED.has(aTurns[i].reply) && FINISHED.has(bTurns[i].reply)) return i;
  }
  return null;
}

/**
 * The turn a "which was better?" verdict applies to, or null. It is the latest
 * shared turn, unless a side ran out of credits on it: that side never got to
 * answer, so the turn says nothing about the model and is not offered. An
 * earlier turn is not offered in its place -- asking about turn 1 under a turn
 * 2 that failed would read as a question about the wrong turn.
 */
export function judgeableTurn(aTurns = [], bTurns = []) {
  const turn = latestSharedTurn(aTurns, bTurns);
  if (turn === null) return null;
  if (isCreditFailure(aTurns[turn]) || isCreditFailure(bTurns[turn])) return null;
  return turn;
}

/**
 * Why the latest shared turn cannot be judged, or null when it can (or there
 * is none). Names the side by its model.
 */
export function unjudgeableReason(aTurns = [], bTurns = [], names = { a: 'A', b: 'B' }) {
  const turn = latestSharedTurn(aTurns, bTurns);
  if (turn === null) return null;
  const out = ['a', 'b'].filter((l) => isCreditFailure((l === 'a' ? aTurns : bTurns)[turn]));
  if (out.length === 0) return null;
  const who = out.length === 2 ? 'Both models' : names[out[0]];
  return `${who} ran out of credits before finishing, so this turn can't be judged.`;
}

/** How long a finished turn took, in ms, or null when either end is unknown. */
export function turnDurationMs(turn) {
  if (!turn?.userAt || !turn?.replyAt) return null;
  const start = Date.parse(turn.userAt);
  const end = Date.parse(turn.replyAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

/** Sum of the durations that are known, and how many turns contributed. */
export function totalDurationMs(turns = []) {
  let total = 0;
  let counted = 0;
  for (const turn of turns) {
    const ms = turnDurationMs(turn);
    if (ms !== null) {
      total += ms;
      counted += 1;
    }
  }
  return { total, counted };
}

/**
 * A continued side keeps talking in its real project, but the comparison shows
 * only what was compared: the first `turnCount` turns and their replies.
 */
export function messagesUpToTurn(messages = [], turnCount) {
  if (turnCount === null || turnCount === undefined) return messages;
  let seen = 0;
  const out = [];
  for (const message of messages) {
    if (message?.role === 'user') {
      if (seen === turnCount) break;
      seen += 1;
    }
    out.push(message);
  }
  return out;
}

/**
 * Which sides a message goes to. `target` is 'both', 'a' or 'b'. A continued
 * side is no longer part of the comparison, and a side that is still answering
 * cannot take a message; both are left out, so the caller can tell the user
 * which side it skipped.
 */
export function sendTargets(target, sides = {}) {
  const wanted = target === 'a' || target === 'b' ? [target] : SIDE_LABELS;
  return wanted.filter((label) => {
    const side = sides[label];
    return side && !side.continued && !side.busy;
  });
}

/** The first line of a prompt, shortened, for the comparison's title. */
export function titleFromPrompt(text, max = 80) {
  const line = String(text || '').trim().split('\n')[0].trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

/** "12s", "3m 04s", "1h 02m" -- a duration short enough for a pane header. */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * What each side is called wherever a person picks between them: its model's
 * name. Letters would make them translate back to models in their head. Two
 * sides on the same model are told apart by effort, and by letter only when
 * even that is the same.
 */
export function sideNames(a = {}, b = {}) {
  const nameA = a.name || 'A';
  const nameB = b.name || 'B';
  if (nameA !== nameB) return { a: nameA, b: nameB };
  if (a.effort && b.effort && a.effort !== b.effort) {
    return { a: `${nameA} · ${a.effort}`, b: `${nameB} · ${b.effort}` };
  }
  return { a: `${nameA} (A)`, b: `${nameB} (B)` };
}

export const VERDICT_ORDER = ['a', 'b', 'tie', 'neither'];

/** An option in "Which answer was better?": the model's name, or a non-answer. */
export function verdictLabel(winner, names = { a: 'A', b: 'B' }) {
  if (winner === 'a' || winner === 'b') return names[winner];
  if (winner === 'tie') return 'About the same';
  if (winner === 'neither') return 'Neither';
  return 'No verdict';
}

/**
 * What a side's header says about it, and the tone its status dot takes.
 * A continued side is no longer part of the comparison, whatever it is doing
 * in its project now.
 */
export function sideStatus(turns = [], { busy = false, continued = false } = {}) {
  if (continued) return { tone: 'muted', label: 'Continued as a task' };
  if (busy) return { tone: 'working', label: 'Working' };
  const last = turns[turns.length - 1];
  if (!last) return { tone: 'muted', label: 'Waiting' };
  if (last.reply === 'running') return { tone: 'working', label: 'Working' };
  if (last.reply === 'done') return { tone: 'done', label: 'Done' };
  if (isCreditFailure(last)) return { tone: 'failed', label: 'Out of credits' };
  if (last.reply === 'failed' && last.failureCode === 'rate_limited') return { tone: 'failed', label: 'Rate limited' };
  if (last.reply === 'failed') return { tone: 'failed', label: 'Failed' };
  return { tone: 'muted', label: 'Stopped' };
}

/**
 * Why the follow-up composer cannot send right now, or null when it can.
 * `canSwitch` is true when picking a different target would let the message
 * go out, so the caller keeps the target picker usable in that case.
 */
export function composerBlock(target, sides = {}, names = { a: 'A', b: 'B' }, { outOfCredits = [] } = {}) {
  // Both sides spend from one wallet, so once one side has stopped for want of
  // credits any follow-up would stop too. Blocks until the account can pay.
  if (outOfCredits.length > 0) {
    const who = outOfCredits.length === 2 ? 'Both models' : names[outOfCredits[0]];
    return {
      message: `${who} stopped because the balance ran out. Add funds to keep comparing.`,
      canSwitch: false,
      action: 'addFunds',
    };
  }
  const available = SIDE_LABELS.filter((l) => sides[l] && !sides[l].continued && !sides[l].busy);
  const wanted = target === 'a' || target === 'b' ? [target] : SIDE_LABELS;
  const blocked = wanted.filter((l) => !available.includes(l));
  if (blocked.length === 0) return null;
  const canSwitch = available.length > 0;
  const nameOf = (l) => names[l];
  if (!canSwitch) {
    const working = SIDE_LABELS.filter((l) => sides[l]?.busy && !sides[l]?.continued);
    if (working.length === 2) return { message: 'You can follow up when both models finish.', canSwitch };
    if (working.length === 1) return { message: `You can follow up when ${nameOf(working[0])} finishes.`, canSwitch };
    return { message: 'Both sides were continued as tasks, so this comparison takes no more messages.', canSwitch };
  }
  const [side] = blocked;
  const other = nameOf(available[0]);
  if (sides[side]?.continued) {
    return { message: `${nameOf(side)} was continued as a task. Send to ${other} only.`, canSwitch };
  }
  return { message: `${nameOf(side)} is still working. Send to ${other} only, or wait.`, canSwitch };
}

/** The text of the first user message, or '' when there is none yet. */
export function firstUserText(messages = []) {
  const first = (messages || []).find((m) => m?.role === 'user');
  return typeof first?.content === 'string' ? first.content : '';
}

/**
 * The messages with the first user message removed: the comparison's page
 * shows that prompt once, above both sides, instead of in each pane.
 */
export function withoutFirstPrompt(messages = []) {
  const index = (messages || []).findIndex((m) => m?.role === 'user');
  if (index === -1) return messages;
  return [...messages.slice(0, index), ...messages.slice(index + 1)];
}

/** A side still working but silent for this long gets a "no new activity" hint.
 *  The hint only informs: the server ends a turn that stays silent for ten
 *  minutes, and a slow model can still answer before then. */
export const STALL_HINT_MS = 2 * 60 * 1000;

/** How long a working side has been silent, when that is worth saying; else null. */
export function silentFor(lastEventAt, now, threshold = STALL_HINT_MS) {
  if (!Number.isFinite(lastEventAt) || !Number.isFinite(now)) return null;
  const gap = now - lastEventAt;
  return gap >= threshold ? gap : null;
}

const NOTICE_RANK = { danger: 3, warning: 2, info: 1 };

/**
 * One credits notice for a comparison, from the notice each side's model would
 * get on its own (lib/usageWarnings' deriveComposerWarning). The more severe
 * wins; resting figures are left out, since they are not warnings. `blocks` is
 * true when either side could not run at all. A low balance carries the reason
 * a comparison feels it first: it runs two models.
 */
export function compareCreditNotice(notices = []) {
  const ranked = notices
    // A resting figure's tone has no rank, so it drops out here.
    .filter((n) => n && NOTICE_RANK[n.tone])
    .sort((x, y) => NOTICE_RANK[y.tone] - NOTICE_RANK[x.tone]);
  const notice = ranked[0];
  if (!notice) return null;
  const blocks = notices.some((n) => n?.kind === 'balance_empty');
  const body = notice.kind === 'balance_low'
    ? `${notice.body} A comparison runs two models, so it uses about twice the credits of one task.`
    : notice.body;
  return { ...notice, body, blocks };
}
