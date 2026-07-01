// Shared skills store — one source of truth for the skill list across the
// Skills page and the composer's "/" menu.
//
// The app has no React Query / global store; skills were page-local useState
// (SkillsView). That makes cross-surface sync impossible: saving a skill from
// a chat card, or deleting one on the Skills page, wouldn't update the "/"
// menu without a reload. This module is a tiny external store (a module-level
// cache + a subscriber set surfaced through React's useSyncExternalStore) so
// every consumer re-renders on any mutation — no reload, no prop-drilling
// through App.jsx.
//
// ponytail: deliberately ~50 lines instead of pulling in a query/state library
// for a single list. If skills ever need pagination/optimistic-cache merging,
// revisit React Query.

import { useSyncExternalStore } from 'react';

import { fetchSkills, saveSkill, deleteSkill } from '../api';

// `null` = never loaded yet (consumers can show a loading state); an array
// once a fetch has resolved (success → the skills, failure → kept as-is / []).
let _skills = null;
let _skillNames = new Set(); // derived; rebuilt once per reload, not per-consumer
let _inFlight = null; // de-dupe concurrent reloads
const _subscribers = new Set();

function _emit() {
  for (const notify of _subscribers) notify();
}

function _getSnapshot() {
  // Must return a stable reference between mutations or useSyncExternalStore
  // loops. `_skills` is only reassigned inside reloadSkills, so it is stable.
  return _skills;
}

/** Re-fetch the canonical skills list and notify every subscriber. Concurrent
 *  calls share one in-flight request. Throws are swallowed (the list is left
 *  as-is) so a transient fetch failure can't blank the UI — callers that need
 *  to surface mutation errors await the *AndSync wrappers, which do throw. */
export async function reloadSkills() {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    try {
      const data = await fetchSkills();
      _skills = Array.isArray(data?.skills) ? data.skills : [];
      _skillNames = new Set(_skills.map((s) => s.label).filter(Boolean));
    } catch {
      if (_skills === null) _skills = []; // first load failed → empty, not stuck loading
    } finally {
      _inFlight = null;
      _emit();
    }
  })();
  return _inFlight;
}

function _subscribe(notify) {
  _subscribers.add(notify);
  // Lazily load on first subscriber. Deferred so the fetch starts after the
  // current render cycle — firing reloadSkills() synchronously here (inside
  // useSyncExternalStore's subscribe call) can trigger a React "update during
  // render" warning if _emit() resolves before the tree finishes mounting.
  if (_skills === null && !_inFlight) queueMicrotask(reloadSkills);
  return () => _subscribers.delete(notify);
}

/**
 * React hook: the shared skills list + a reload trigger.
 * @returns {{ skills: Array|null, reload: () => Promise<void> }}
 *          `skills` is `null` until the first fetch resolves, then an array.
 */
export function useSkills() {
  const skills = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  return { skills, reload: reloadSkills };
}

/**
 * React hook: stable Set of known skill label strings, rebuilt once per reload.
 * Prefer this over useSkills() when you only need label membership (e.g. for
 * mention highlighting) — all consumers share one Set instead of each building
 * their own inside a useMemo.
 * @returns {Set<string>}
 */
export function useSkillNames() {
  return useSyncExternalStore(_subscribe, () => _skillNames, () => _skillNames);
}

/** Create/update a skill, then refresh the shared list so every surface (the
 *  Skills page AND the "/" menu) reflects it without a reload. Re-throws so the
 *  caller can surface a toast / handle a 409 collision. */
export async function saveSkillAndSync(payload, isEdit = false) {
  const saved = await saveSkill(payload, isEdit);
  await reloadSkills();
  return saved;
}

/** Delete a skill, then refresh the shared list. Re-throws on failure. */
export async function deleteSkillAndSync(label) {
  const res = await deleteSkill(label);
  await reloadSkills();
  return res;
}
