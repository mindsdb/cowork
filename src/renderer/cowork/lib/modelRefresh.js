/**
 * How long a model availability re-check counts as fresh. Short next to cowork-server's
 * 15s listing cache, which `refresh=true` skips anyway.
 */
export const MODEL_REFRESH_TTL_MS = 5000;

/** `all` forces every listing leg (picker opens); `minds` only MindsHub's (availability triggers). */
export const REFRESH_SCOPE = Object.freeze({ all: 'all', minds: 'minds' });
// Scopes the server says it honors (`refreshScopes`); kept out of settings so saves never carry it.
let advertisedRefreshScopes = [];
export function noteRefreshScopes(scopes) {
  advertisedRefreshScopes = Array.isArray(scopes) ? scopes : [];
}
export function serverHonorsRefreshScope(scope) {
  return advertisedRefreshScopes.includes(scope);
}

const broaderScope = (a, b) => (a === REFRESH_SCOPE.all || b === REFRESH_SCOPE.all ? REFRESH_SCOPE.all : REFRESH_SCOPE.minds);

/**
 * Runs `fn(arg)` at most once per `ms`. A call inside the window is not dropped: one run is
 * queued for the window's end, with the queued args combined by `merge`.
 */
export function createTrailingThrottle(fn, ms = MODEL_REFRESH_TTL_MS, now = () => performance.now(), merge = (_a, b) => b) {
  let last = -Infinity;
  let pending = null;
  let pendingArg;
  const run = (arg) => {
    last = now();
    return Promise.resolve().then(() => fn(arg)).catch(() => {});
  };
  return {
    call(arg) {
      const wait = last + ms - now();
      if (wait <= 0 && !pending) return run(arg);
      pendingArg = pending ? merge(pendingArg, arg) : arg;
      if (!pending) {
        pending = setTimeout(() => {
          pending = null;
          const queued = pendingArg;
          pendingArg = undefined;
          run(queued);
        }, Math.max(wait, 0));
      }
      return Promise.resolve();
    },
    cancel() {
      if (pending) clearTimeout(pending);
      pending = null;
      pendingArg = undefined;
    },
  };
}

/**
 * The one throttled availability re-check. Responses can overlap, so one that started before
 * the last applied response is dropped; a failed (null) response never counts as applied.
 */
export function createAvailabilityRefresher({ fetch, apply, ms = MODEL_REFRESH_TTL_MS, now = () => performance.now() }) {
  let issued = 0;
  let applied = 0;
  const throttle = createTrailingThrottle(async (scope) => {
    const seq = ++issued;
    const data = await fetch(scope);
    if (data == null || seq < applied) return;
    applied = seq;
    apply(data);
  }, ms, now, broaderScope);
  return {
    refresh: (scope = REFRESH_SCOPE.all) => throttle.call(scope),
    cancel: throttle.cancel,
  };
}

const deepEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
};

/** Whether every key of a merge result already deep-equals `prev`, so applying it is a no-op. */
export function mergeChangesNothing(prev, merged) {
  return Object.keys(merged).every((k) => deepEqual(prev?.[k], merged[k]));
}
