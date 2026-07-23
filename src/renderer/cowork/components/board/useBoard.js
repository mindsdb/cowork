import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchInFlightList,
  fetchSchedules,
  fetchResolvedApprovals,
  fetchExpiredApprovals,
} from '../../api';
import { usePendingApprovals } from '../usePendingApprovals';

// Mission Control board composition — one hook that assembles the four
// columns from the existing feeds:
//   Needs You  pending approvals (shared usePendingApprovals subscription —
//              the same one feeding the sidebar badge + native pulse, so the
//              surfaces can never drift)
//   Running    server in-flight conversations, topics resolved from App's
//              tasks (a conversation the renderer hasn't loaded still shows,
//              just with the generic fallback title)
//   Scheduled  digest/scheduled tasks
//   Shipped    recently resolved approvals, grouped "today" vs older
// Plus `expired` — approvals that lapsed while the user was away, which the
// view collapses into a single quiet row.

const RUNNING_POLL_MS = 10000;

// Pure (exported for tests): pair each in-flight record with its task topic.
// The wire shape is snake_case (`conversation_id`); tolerate camelCase too.
export function enrichRunning(inFlight, tasks) {
  const topicById = new Map((tasks || []).map((t) => [t.id, t.title]));
  return (Array.isArray(inFlight) ? inFlight : [])
    .map((it) => {
      const conversationId = it?.conversation_id || it?.conversationId || null;
      if (!conversationId) return null;
      return {
        conversationId,
        topic: topicById.get(conversationId) || 'Untitled task',
        startedAt: it?.started_at || it?.startedAt || null,
      };
    })
    .filter(Boolean);
}

// Pure (exported for tests): split resolved approvals into "today" (resolved
// since local midnight) and everything older. Unparseable timestamps land in
// `older` rather than guessing.
export function groupShipped(list, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const cutoff = start.getTime();
  const today = [];
  const older = [];
  for (const a of Array.isArray(list) ? list : []) {
    const t = Date.parse(a?.resolvedAt || a?.createdAt || '');
    if (Number.isFinite(t) && t >= cutoff) today.push(a);
    else older.push(a);
  }
  return { today, older };
}

export function useBoard({ tasks = [] } = {}) {
  const { approvals: needsYou } = usePendingApprovals();

  const [runningRaw, setRunningRaw] = useState([]);
  const [scheduled, setScheduled] = useState([]);
  const [shippedRaw, setShippedRaw] = useState([]);
  const [expired, setExpired] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [inFlight, scheds, resolved, expiredList] = await Promise.all([
      fetchInFlightList(),
      fetchSchedules(),
      fetchResolvedApprovals(),
      fetchExpiredApprovals(),
    ]);
    setRunningRaw(Array.isArray(inFlight) ? inFlight : []);
    setScheduled(Array.isArray(scheds?.schedules) ? scheds.schedules : []);
    setShippedRaw(Array.isArray(resolved) ? resolved : []);
    setExpired(Array.isArray(expiredList) ? expiredList : []);
    setLoading(false);
    try {
      // Ambient reliability readout (M4) — never blocks the board.
      setMetrics(await fetchApprovalMetrics());
    } catch { /* server down or old build: the row just hides */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll only while something is running — same idle-costs-zero rule as
  // App's in-flight heartbeat. Needs-You polling stays on its own (slower)
  // shared subscription.
  useEffect(() => {
    if (runningRaw.length === 0) return undefined;
    const timer = setInterval(refresh, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [runningRaw.length, refresh]);

  const running = useMemo(() => enrichRunning(runningRaw, tasks), [runningRaw, tasks]);
  const shipped = useMemo(() => groupShipped(shippedRaw), [shippedRaw]);

  return { needsYou, running, scheduled, shipped, expired, metrics, loading, refresh };
}
