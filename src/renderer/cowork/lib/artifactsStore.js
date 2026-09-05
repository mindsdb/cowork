// Shared liveness state for chat cards; App’s artifact snapshot does not refresh after every
// delete.
// _index=null means unknown, distinct from a loaded empty index. Session tombstones never expire.
// _born protects new artifacts until a successful index request started after their creation;
// retaining it longer would mask external deletions.

import { useSyncExternalStore } from 'react';

import { deleteArtifact, fetchArtifactsStrict } from '../api';
import {
  buildArtifactIndex,
  emptyArtifactIndex,
  isArtifactDeleted,
  matchesIndex,
  mergeArtifactIndex,
} from './artifactLiveness';

const GLOBAL_SCOPE_KEY = 'g:';

function globalScope() {
  return { kind: 'global', projectId: '', projectPath: '' };
}

let _scope = globalScope();
let _scopeKey = GLOBAL_SCOPE_KEY;
let _index = null;
let _tombstones = emptyArtifactIndex();
let _born = emptyArtifactIndex();
// Born entries the in-flight load has promised to account for. Dropped when it
// succeeds; folded back into `_born` when it fails or is superseded.
let _bornPending = null;
// `_born` ∪ `_bornPending`, precomputed so the hook's getSnapshot allocates
// nothing (it runs on every render of every card).
let _bornEffective = _born;
let _inFlight = null;
// Bumped by every load and every scope change, so a resolved-but-superseded
// request cannot write a stale index.
let _loadGen = 0;
const _subscribers = new Set();

function _recomputeBorn() {
  _bornEffective = _bornPending ? mergeArtifactIndex(_born, _bornPending) : _born;
}

function _emit() {
  for (const notify of _subscribers) notify();
}

/** Stable string identity of a scope, so an equal-valued object is not a change. */
export function scopeKeyOf(scope) {
  const projectId = scope?.projectId ? String(scope.projectId) : '';
  const projectPath = scope?.projectPath ? String(scope.projectPath) : '';
  if (projectId) return `p:${projectId}`;
  if (projectPath) return `d:${projectPath}`;
  return GLOBAL_SCOPE_KEY;
}

async function _load() {
  if (_inFlight) return _inFlight;
  const gen = _loadGen + 1;
  _loadGen = gen;
  const scopeAtStart = _scope;
  // Whatever is born so far will be covered by this load's result — IF it
  // succeeds. Anything born while it runs lands in the fresh `_born` and
  // survives, because this load's snapshot cannot contain it.
  _bornPending = _bornPending ? mergeArtifactIndex(_bornPending, _born) : _born;
  _born = emptyArtifactIndex();
  _recomputeBorn();
  _inFlight = (async () => {
    try {
      const cards = await fetchArtifactsStrict({
        projectId: scopeAtStart.projectId,
        projectPath: scopeAtStart.projectPath,
      });
      if (gen !== _loadGen) return;
      _index = buildArtifactIndex(cards);
      _bornPending = null;
    } catch {
      if (gen !== _loadGen) return;
      // Fail open. Keep whatever index we had (null on a first failure) and give
      // the born entries their cover back — this load established nothing.
      _born = mergeArtifactIndex(_born, _bornPending);
      _bornPending = null;
    } finally {
      if (gen === _loadGen) {
        _inFlight = null;
        _recomputeBorn();
        _emit();
      }
    }
  })();
  return _inFlight;
}

/** Which project's artifacts the index should describe. Called from an effect,
 *  never during render — it emits. */
export function setArtifactsScope(scope) {
  const key = scopeKeyOf(scope);
  if (key === _scopeKey) return;
  _scopeKey = key;
  _scope = {
    kind: key === GLOBAL_SCOPE_KEY ? 'global' : 'project',
    projectId: scope?.projectId ? String(scope.projectId) : '',
    projectPath: scope?.projectPath ? String(scope.projectPath) : '',
  };
  // Abandon the in-flight load: its result describes the old scope, and its
  // promise to account for `_bornPending` dies with it.
  _loadGen += 1;
  _inFlight = null;
  _born = mergeArtifactIndex(_born, _bornPending);
  _bornPending = null;
  _index = null;
  _recomputeBorn();
  _emit();
  if (_subscribers.size > 0) queueMicrotask(_load);
}

/** Re-fetch the index. Concurrent callers share one request. */
export function revalidate() {
  return _load();
}

/** Record a successful deletion. Takes the card the deleting surface holds — a
 *  server card, whose `folder` is what makes it match a chat card's file path. */
export function noteArtifactDeleted(card) {
  if (!card) return;
  _tombstones = mergeArtifactIndex(_tombstones, buildArtifactIndex([card]));
  _emit();
}

/** Record an artifact the agent just made, so a stale index cannot bury it. */
export function noteArtifactCreated(card) {
  // Idempotent short-circuit: this runs on every event of a live stream, and an
  // unconditional _emit() there would re-render every card of the conversation
  // per token.
  if (!card || matchesIndex(card, _bornEffective)) return;
  _born = mergeArtifactIndex(_born, buildArtifactIndex([card]));
  _recomputeBorn();
  _emit();
}

/** Feed a live turn's steps in. Non-Artifact steps and step-less entries are
 *  ignored, so callers can pass the whole array. */
export function noteArtifactsFromSteps(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (step?.badge === 'Artifact' && step.data) noteArtifactCreated(step.data);
  }
}

/** Delete, then make every surface agree. Tombstones ONLY after the server
 *  confirms — a failed delete must not bury a live artifact. Rethrows so the
 *  caller keeps showing its toast and rolling its optimistic removal back. */
export async function deleteArtifactAndSync(artifact) {
  const result = await deleteArtifact(artifact);
  noteArtifactDeleted(artifact);
  revalidate().catch(() => {});
  return result;
}

/** The decision, outside React. */
export function artifactDeletedNow(card, { live = false } = {}) {
  return isArtifactDeleted(card, {
    index: _index,
    tombstones: _tombstones,
    born: _bornEffective,
    scope: _scope,
    live,
  });
}

function _subscribe(notify) {
  _subscribers.add(notify);
  // Lazy first load, deferred out of the current render cycle — calling _load()
  // synchronously inside useSyncExternalStore's subscribe can emit before the
  // tree finishes mounting (same reason skillsStore._subscribe defers).
  if (_index === null && !_inFlight) queueMicrotask(_load);
  return () => _subscribers.delete(notify);
}

/**
 * Return false when deletion is uncertain: unloaded/failed index, out-of-scope card, or no usable
 * key.
 */
export function useArtifactLiveness(card, { live = false } = {}) {
  return useSyncExternalStore(
    _subscribe,
    () => artifactDeletedNow(card, { live }),
    () => false,
  );
}

export function __resetForTests() {
  _scope = globalScope();
  _scopeKey = GLOBAL_SCOPE_KEY;
  _index = null;
  _tombstones = emptyArtifactIndex();
  _born = emptyArtifactIndex();
  _bornPending = null;
  _inFlight = null;
  _loadGen += 1;
  _recomputeBorn();
  _subscribers.clear();
}
