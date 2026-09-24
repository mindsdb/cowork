// Decisions behind the Compare models screen, kept out of React so they can be
// tested directly. A "side" is one model's conversation; a "turn" is one user
// message and whatever the agent answered to it.

export const SIDE_LABELS = ['a', 'b'];

const FAILED_ROLES = new Set(['error', 'provider_required']);

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
 * The turn a "which was better?" verdict applies to: the latest turn both
 * sides were asked and both have finished. Null when there is none yet, or
 * once the sides have diverged before any such turn -- after that point the
 * two are no longer answering the same question.
 */
export function judgeableTurn(aTurns = [], bTurns = []) {
  const diverged = divergedAt(aTurns, bTurns);
  const limit = diverged === null ? Math.min(aTurns.length, bTurns.length) : diverged;
  for (let i = limit - 1; i >= 0; i -= 1) {
    if (FINISHED.has(aTurns[i].reply) && FINISHED.has(bTurns[i].reply)) return i;
  }
  return null;
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

export const VERDICT_LABELS = {
  a: 'A was better',
  b: 'B was better',
  tie: 'About the same',
  neither: 'Neither did it',
};
