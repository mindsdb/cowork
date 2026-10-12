// App's system-wide artifact list: the pure updates applied to it and the
// loader that refreshes it from the server.

import { belongsToProject } from './artifactProject';

// Returns the same list when nothing is dropped, so React can skip the update.
function withoutMatching(list, matches) {
  const next = list.filter((a) => !matches(a));
  return next.length === list.length ? list : next;
}

export function withoutArtifact(list, path) {
  return path ? withoutMatching(list, (a) => a.path === path) : list;
}

export function withoutProjectArtifacts(list, project) {
  return project ? withoutMatching(list, (a) => belongsToProject(a, project)) : list;
}

export function withArtifactChange(list, updated) {
  const i = updated?.path ? list.findIndex((a) => a.path === updated.path) : -1;
  if (i < 0) return list;
  const next = list.slice();
  next[i] = { ...next[i], ...updated };
  return next;
}

/**
 * Latest-wins reloads. A response is applied only if no reload started after
 * it, so an older listing cannot bring back an artifact a newer one dropped.
 * A failed load leaves the list alone: an error is not an empty list.
 */
export function createLatestLoader(load, apply) {
  let gen = 0;
  let pending = false;
  const reload = () => {
    const ticket = ++gen;
    pending = true;
    return Promise.resolve()
      .then(() => load())
      .then((data) => { if (ticket === gen) apply(data); })
      .catch(() => {})
      .finally(() => { if (ticket === gen) pending = false; });
  };
  return {
    reload,
    /** Run a local change. A reload in flight may have listed the server state
     *  from before it, so that reload is superseded by a fresh one. */
    change(fn) {
      fn();
      if (pending) reload();
    },
  };
}
