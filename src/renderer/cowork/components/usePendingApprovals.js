import { useEffect, useState } from 'react';
import { fetchPendingApprovals } from '../api';

// Pending approvals, shared: boot fetch + interval poll + focus refetch.
// One implementation for the Sidebar badge and the native pulse (D6) so
// they can't drift. Quiet by design — a down server means empty, not errors.
export function usePendingApprovals(intervalMs = 45000) {
  const [approvals, setApprovals] = useState([]);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchPendingApprovals();
        if (!alive) return;
        setApprovals(list);
        setLoadedAt(Date.now());
      } catch { /* server down — stay quiet */ }
    };
    load();
    const t = setInterval(load, intervalMs);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [intervalMs]);

  return { approvals, count: approvals.length, loadedAt };
}

// Pure: which of these approvals are new since prevIds (a Set, or null for
// "first load" — which is baseline, never news). Kept pure for tests.
export function diffNewApprovals(prevIds, list) {
  if (prevIds === null) return { baseline: true, fresh: [], ids: new Set(list.map((a) => a.id)) };
  const ids = new Set(list.map((a) => a.id));
  return { baseline: false, fresh: list.filter((a) => !prevIds.has(a.id)), ids };
}
