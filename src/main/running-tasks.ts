import { authHeader } from './server-auth';
import { getServerOrigin, isServerRunning } from './server-process';

// How many turns the sidecar is running right now (ENG-3291). Read before a
// restart that would stop the sidecar, so the renderer can ask first.
//
// The count comes from the sidecar, not the renderer's task list: scheduled
// runs and turns started in another window never stream through the asking
// renderer. Two kinds of turn can be running. Chat turns are in the in-flight
// list. Code turns live in the coding service and show as a session whose
// status is `running` or `awaiting_approval`; the stop that follows a restart
// interrupts them through /coding/runtime/prepare-shutdown, so they count the
// same. There is no endpoint for the coding service's live registry, so the
// persisted session status stands in. A stale `running` left by a crash
// over-counts, which asks once too often, never too seldom.
//
// The read is bounded, because on the 6 October incident every sidecar request
// queued behind leaked streams; a confirmation that never opens is worse than
// one that cannot give a number.

export const RUNNING_TASKS_TIMEOUT_MS = 2_000;

/** Code session statuses that a sidecar stop would interrupt. */
const ACTIVE_CODE_SESSION_STATUSES = new Set(['running', 'awaiting_approval']);

/** The sidecar's `in_flight` entries, or null when the body is not that shape. */
export function parseInFlightCount(body: unknown): number | null {
  const list = (body as { in_flight?: unknown } | null)?.in_flight;
  return Array.isArray(list) ? list.length : null;
}

/** Code sessions with a turn under way, or null when the body is not a session page. */
export function parseActiveCodeSessionCount(body: unknown): number | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items.filter((item) => (
    ACTIVE_CODE_SESSION_STATUSES.has(String((item as { status?: unknown } | null)?.status ?? ''))
  )).length;
}

async function readCount(
  path: string,
  parse: (body: unknown) => number | null,
  timeoutMs: number,
): Promise<number | null> {
  try {
    const response = await fetch(`${getServerOrigin()}${path}`, {
      headers: authHeader(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return parse(await response.json());
  } catch {
    return null;
  }
}

/** 0 when no sidecar is running (nothing a restart can interrupt); null when it
 *  is running but either read did not answer within the bound. Both reads run
 *  at once, so the bound is the total wait. */
export async function countRunningTasks(options: { timeoutMs?: number } = {}): Promise<number | null> {
  if (!isServerRunning()) return 0;
  const timeoutMs = options.timeoutMs ?? RUNNING_TASKS_TIMEOUT_MS;
  const [chat, code] = await Promise.all([
    readCount('/api/v1/responses/in-flight-list', parseInFlightCount, timeoutMs),
    readCount('/api/v1/coding/sessions', parseActiveCodeSessionCount, timeoutMs),
  ]);
  if (chat === null || code === null) return null;
  return chat + code;
}
