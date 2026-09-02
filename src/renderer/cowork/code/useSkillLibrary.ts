import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';

import { codingApi, type SkillLibraryPage } from './api';

// Keyed by the account identity (skillScopeKey) so one organisation's skills
// never render under another after a sign-out or identity change.
export const SkillScopeContext = createContext('signed-out');

const EMPTY_LIBRARY: SkillLibraryPage = { sources: [], items: [] };
const STALE_AFTER_MS = 30_000;

interface CacheEntry {
  page: SkillLibraryPage;
  loadedAt: number;
}

const entries = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SkillLibraryPage>>();
const forcedInFlight = new Map<string, Promise<SkillLibraryPage>>();
const subscribers = new Map<string, Set<() => void>>();
let cacheGeneration = 0;

function cacheKey(scopeKey: string, projectId?: string | null): string {
  return `${scopeKey}\n${projectId || ''}`;
}

function subscribe(key: string, listener: () => void): () => void {
  const keyed = subscribers.get(key) ?? new Set<() => void>();
  keyed.add(listener);
  subscribers.set(key, keyed);
  return () => {
    keyed.delete(listener);
    if (!keyed.size) subscribers.delete(key);
  };
}

function notify(key: string): void {
  for (const listener of subscribers.get(key) ?? []) listener();
}

function readSkillLibrary(scopeKey: string, projectId?: string | null): SkillLibraryPage | null {
  return entries.get(cacheKey(scopeKey, projectId))?.page ?? null;
}

function loadSkillLibrary(
  scopeKey: string,
  projectId?: string | null,
  { force = false }: { force?: boolean } = {},
): Promise<SkillLibraryPage> {
  const generation = cacheGeneration;
  const key = cacheKey(scopeKey, projectId);
  const entry = entries.get(key);
  if (!force && entry && Date.now() - entry.loadedAt < STALE_AFTER_MS) return Promise.resolve(entry.page);
  const pending = inFlight.get(key);
  if (pending) {
    if (!force) return pending;
    const queued = forcedInFlight.get(key);
    if (queued) return queued;
    // A user-requested refresh is stronger than the background request it
    // overlaps. Wait for that request to settle, then fetch again; returning
    // the existing promise would incorrectly report that stale response as a
    // completed forced reload and leave sibling projections fresh in cache.
    const refresh = pending
      .then(() => undefined, () => undefined)
      .then(() => (
        generation === cacheGeneration
          ? loadSkillLibrary(scopeKey, projectId, { force: true })
          : EMPTY_LIBRARY
      ))
      .finally(() => {
        if (forcedInFlight.get(key) === refresh) forcedInFlight.delete(key);
      });
    forcedInFlight.set(key, refresh);
    return refresh;
  }
  const request = codingApi.skillLibrary(projectId).then((page) => {
    // Cache resets are lifecycle boundaries. A request or queued forced
    // refresh from the previous generation may still settle afterwards, but
    // must not repopulate the cache or invalidate projections in the next
    // account/session.
    if (generation !== cacheGeneration) return page;
    // Keep catalogues from other identities keyed but intact. Purging them
    // here lets an older request that resolves late delete the catalogue a
    // newly signed-in account has already loaded. The scope key is the
    // isolation boundary; retaining an unreachable entry cannot render it for
    // another account, and avoids that response-order race entirely.
    entries.set(key, { page, loadedAt: Date.now() });
    notify(key);
    if (force) {
      for (const [otherKey, other] of entries) {
        if (otherKey === key || !otherKey.startsWith(`${scopeKey}\n`)) continue;
        other.loadedAt = 0;
        if (subscribers.has(otherKey)) {
          void loadSkillLibrary(scopeKey, otherKey.slice(scopeKey.length + 1) || null).catch(() => {});
        }
      }
    }
    return page;
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key);
  });
  inFlight.set(key, request);
  return request;
}

export function resetSkillLibraryCache(): void {
  cacheGeneration += 1;
  entries.clear();
  inFlight.clear();
  forcedInFlight.clear();
}

function loadErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Could not load the Skills Library.';
}

export function useSkillLibrary(projectId?: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  const scopeKey = useContext(SkillScopeContext);
  const key = cacheKey(scopeKey, projectId);
  const page = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => readSkillLibrary(scopeKey, projectId),
  );
  const [status, setStatus] = useState({ key: '', loading: false, error: '' });
  // Responses carry the key they were requested under, so a late result for
  // a previous identity or project can never update the current one.
  const settle = useCallback((next: { key: string; loading: boolean; error: string }) => {
    setStatus((current) => (current.key === next.key ? next : current));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setStatus({ key, loading: readSkillLibrary(scopeKey, projectId) == null, error: '' });
    loadSkillLibrary(scopeKey, projectId)
      .then(() => settle({ key, loading: false, error: '' }))
      .catch((reason) => settle({ key, loading: false, error: loadErrorMessage(reason) }));
  }, [enabled, key, projectId, scopeKey, settle]);

  const reload = useCallback(async () => {
    try {
      await loadSkillLibrary(scopeKey, projectId, { force: true });
      settle({ key, loading: false, error: '' });
    } catch (reason) {
      settle({ key, loading: false, error: loadErrorMessage(reason) });
    }
  }, [key, projectId, scopeKey, settle]);

  const current = status.key === key ? status : { loading: enabled && page == null, error: '' };
  return { page: page ?? EMPTY_LIBRARY, loading: current.loading, error: current.error, reload };
}
