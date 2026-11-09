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

import {
  fetchSkills, saveSkill, deleteSkill, setSkillSharing, setSkillAccess, setSkillEnabledForMe,
} from '../api';

// `null` = never loaded yet (consumers can show a loading state); an array
// once a fetch has settled. `_catalogueStatus` distinguishes a verified empty
// catalogue from the compatibility `[]` used after an initial fetch failure.
let _skills = null;
let _skillNames = new Set(); // derived; rebuilt once per reload, not per-consumer
let _inFlight = null; // de-dupe concurrent reloads
let _catalogueStatus = 'idle'; // idle | loading | loaded | error
/* The list's `canShare`: whether this caller may share their own skills, so
   whether a create asks "Who can use it". False until a load succeeds, and a
   failed refresh keeps the last answer, as it keeps the last list. */
let _canShare = false;
const _subscribers = new Set();

function _emit() {
  for (const notify of _subscribers) notify();
}

function _getSnapshot() {
  /* Must return a stable reference between mutations or useSyncExternalStore
     loops. `_skills` is reassigned only by a reload or the patches in
     setSkillSharingAndSync, setSkillAccessAndSync and
     setSkillEnabledForMeAndSync, and each emits, so it is stable between mutations. */
  return _skills;
}

function _getCatalogueStatusSnapshot() {
  return _catalogueStatus;
}

function _getCanShareSnapshot() {
  return _canShare;
}

/** Re-fetch the canonical skills list and notify every subscriber. Concurrent
 *  calls share one in-flight request. Throws are swallowed (the list is left
 *  as-is) so a transient fetch failure can't blank the UI — callers that need
 *  to surface mutation errors await the *AndSync wrappers, which do throw. */
export async function reloadSkills({ afterCurrent = false } = {}) {
  if (_inFlight) {
    if (!afterCurrent) return _inFlight;
    // Mutation-critical callers cannot accept a request which began before
    // their write. Let that request settle, then start (or join) the next one,
    // whose request boundary is necessarily after the mutation.
    await _inFlight;
    return reloadSkills();
  }
  _inFlight = (async () => {
    _catalogueStatus = 'loading';
    _emit();
    try {
      const data = await fetchSkills();
      if (!Array.isArray(data?.skills)) {
        throw new Error('The skills catalogue response was invalid.');
      }
      _skills = data.skills;
      _canShare = data.canShare === true;
      _skillNames = new Set(_skills.map((s) => s.label).filter(Boolean));
      _catalogueStatus = 'loaded';
      return { ok: true, skills: _skills };
    } catch (error) {
      if (_skills === null) _skills = []; // first load failed → empty, not stuck loading
      _catalogueStatus = 'error';
      return { ok: false, skills: _skills, error };
    } finally {
      _inFlight = null;
      _emit();
    }
  })();
  return _inFlight;
}

function _subscribe(notify) {
  _subscribers.add(notify);
  /* Lazily load on first subscriber. Deferred so the fetch starts after the
     current render cycle — firing reloadSkills() synchronously here (inside
     useSyncExternalStore's subscribe call) can trigger a React "update during
     render" warning if _emit() resolves before the tree finishes mounting.
     A failed load leaves an empty list behind, so retry on 'error' as well:
     without it one offline blip pins every consumer to an unverified
     catalogue until someone opens the Skills page, which reloads on mount.
     At most one retry is in flight, so a persistent outage costs one request
     per failed request, not one per subscriber. */
  if ((_skills === null || _catalogueStatus === 'error') && !_inFlight) {
    queueMicrotask(reloadSkills);
  }
  return () => _subscribers.delete(notify);
}

/**
 * React hook: the shared skills list + a reload trigger.
 * @returns {{ skills: Array|null, catalogueStatus: 'idle'|'loading'|'loaded'|'error',
 *             reload: (options?: { afterCurrent?: boolean }) =>
 *               Promise<{ ok: boolean, skills: Array, error?: unknown }>,
 *             canShare: boolean }}
 *          `catalogueStatus === 'loaded'` means the current absence/presence
 *          decision came from a valid server response. A refresh reports
 *          'loading' while the last settled list stays in place. `canShare`
 *          is the list's own flag: whether creating a skill asks who can use it.
 */
export function useSkills() {
  const skills = useSyncExternalStore(_subscribe, _getSnapshot, _getSnapshot);
  const catalogueStatus = useSyncExternalStore(
    _subscribe,
    _getCatalogueStatusSnapshot,
    _getCatalogueStatusSnapshot,
  );
  const canShare = useSyncExternalStore(_subscribe, _getCanShareSnapshot, _getCanShareSnapshot);
  return { skills, catalogueStatus, reload: reloadSkills, canShare };
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
  await reloadSkills({ afterCurrent: true });
  return saved;
}

/** Share the caller's own skill with everyone or stop sharing it, then refresh
 *  the shared list so its `shared` flag and Shared badge follow. Re-throws so
 *  the caller can revert the control and show the server's refusal. */
export async function setSkillSharingAndSync(label, shared) {
  const saved = await setSkillSharing(label, shared);
  /* The PUT succeeded, so the row's `shared` is settled even when the reload
     that would carry it can't run. Patch the cached row so the list badge, a
     reopened detail and the control's equality guard all read the same value;
     don't adopt `saved`, whose capabilities a mutation response may omit. */
  const refreshed = await reloadSkills({ afterCurrent: true });
  if (!refreshed.ok && Array.isArray(_skills)) {
    _skills = _skills.map((s) => (s.label === label ? { ...s, shared } : s));
    _emit();
  }
  return saved;
}

/** Set who an org skill reaches, then refresh the shared list so
 *  its section and badge follow. The PUT answers the skill's new `access`
 *  and `section`, so the cached row takes them at once and the skill moves
 *  section before the reload lands (and stays moved if the reload fails);
 *  nothing else is adopted from the response, whose capabilities a mutation
 *  response may omit. Re-throws, so the dialog can show a refusal. */
export async function setSkillAccessAndSync(slug, access) {
  const saved = await setSkillAccess(slug, access);
  const patch = {};
  if (saved?.access && typeof saved.access === 'object') patch.access = saved.access;
  if (typeof saved?.section === 'string') patch.section = saved.section;
  if (Object.keys(patch).length && Array.isArray(_skills)) {
    _skills = _skills.map((s) => (
      s.label === slug || s.slug === slug || s.id === slug ? { ...s, ...patch } : s
    ));
    _emit();
  }
  await reloadSkills({ afterCurrent: true });
  return saved;
}

/* Per skill, the number of the latest `enabledForMe` answer patched into the
   cached row, so an older request answering late never overwrites a newer
   one's value. */
let _forMeSeq = 0;
const _forMeApplied = new Map();

/** Turn a skill on or off for the caller alone, then refresh the
 *  shared list. The PUT succeeded, so the cached row takes the new
 *  `enabledForMe` at once and keeps it if the reload fails, unless a request
 *  sent later has already set it; nothing else is adopted from the response.
 *  Re-throws, so the switch can move back. */
export async function setSkillEnabledForMeAndSync(slug, enabled) {
  const seq = ++_forMeSeq;
  const saved = await setSkillEnabledForMe(slug, enabled);
  const enabledForMe = typeof saved?.enabledForMe === 'boolean' ? saved.enabledForMe : enabled;
  const stale = (_forMeApplied.get(slug) ?? 0) > seq;
  if (!stale) _forMeApplied.set(slug, seq);
  if (!stale && Array.isArray(_skills)) {
    _skills = _skills.map((s) => (
      s.label === slug || s.slug === slug || s.id === slug ? { ...s, enabledForMe } : s
    ));
    _emit();
  }
  await reloadSkills({ afterCurrent: true });
  return saved;
}

/** Delete a skill, then refresh the shared list. Re-throws on failure. */
export async function deleteSkillAndSync(label) {
  const res = await deleteSkill(label);
  await reloadSkills({ afterCurrent: true });
  return res;
}
