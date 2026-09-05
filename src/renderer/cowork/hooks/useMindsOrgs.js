import { useCallback, useEffect, useRef, useState } from 'react';
import { mindshubListOrgs, mindshubSwitchOrg } from '../../platform/host';
import { prepareForOrganizationReload } from '../lib/organizationTransition';

/**
 * Read organizations when identity resolves; refresh after switching. Loading, sign-out and legacy
 * channels return an empty list.
 * Retry web reachable=false startup failures. A missing reachable is a definitive legacy desktop
 * answer, including empty fallback.
 */

const NONE = Object.freeze({ orgs: [], activeOrgId: null, subject: null });

/**
 * Three tries after the first, then stop. A bounded retry repairs a startup
 * race without turning the account menu into a background poller.
 */
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

/** One shape whatever came back, so nothing downstream guards a field. */
function normalize(payload, subject) {
  return {
    orgs: Array.isArray(payload?.orgs) ? payload.orgs : [],
    activeOrgId: payload?.activeOrgId ?? null,
    subject,
  };
}

export function useMindsOrgs(accountUser) {
  const [state, setState] = useState(NONE);
  const [switching, setSwitching] = useState(false);
  // Bumped on every identity change. A read that resolves after the identity
  // moved on compares its own generation and drops itself, which is what stops
  // the previous account's organizations landing in the new account's menu.
  const generation = useRef(0);

  // Keyed on the subject rather than the object: `useAccountUser` builds a
  // fresh object on every resolve, so depending on it directly would re-fetch
  // on any re-render that re-decoded the same token.
  const sub = accountUser?.sub ?? null;

  /**
   * One attempt only. The mounting effect owns automatic retries so callers of
   * `refresh` always get exactly the single re-read they asked for.
   */
  const load = useCallback(async () => {
    const mine = generation.current;
    if (!sub) {
      setState(NONE);
      return true;
    }
    try {
      const payload = await mindshubListOrgs();
      const settled = payload?.reachable !== false;
      if (generation.current === mine) {
        setState(settled ? normalize(payload, sub) : NONE);
      }
      return settled;
    } catch {
      if (generation.current === mine) setState(NONE);
      return false;
    }
  }, [sub]);

  useEffect(() => {
    generation.current += 1;
    /**
     * A switch belongs to the identity that started it. Do not hand a new
     * account the old one's disabled menu while that request finishes.
     */
    setSwitching(false);
    const mine = generation.current;
    let timer;
    const attempt = async (n) => {
      if (await load()) return;
      if (generation.current !== mine) return;
      const delay = RETRY_DELAYS_MS[n];
      if (delay === undefined) return;
      timer = setTimeout(() => attempt(n + 1), delay);
    };
    attempt(0);
    return () => {
      /**
       * Unmount changes no identity, so invalidate in-flight reads explicitly.
       * Otherwise a late failure can arm a retry after cleanup already ran.
       */
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [load]);

  /**
   * Return refusals for the caller to display. Apply only the host-confirmed result, never an
   * optimistic tenant switch.
   */
  const switchOrg = useCallback(async (organizationId) => {
    const mine = generation.current;
    setSwitching(true);
    try {
      const result = await mindshubSwitchOrg(organizationId);
      /**
       * Keycloak can change tenant before token refresh succeeds. Honor reloadRequired even after
       * unmount/identity change
       * so old tenant caches are cleared before reconciling the session.
       */
      if (result?.reloadRequired === true) {
        prepareForOrganizationReload({
          clearTenantState: result.clearTenantState !== false,
        });
        return result;
      }
      if (generation.current !== mine) return result;
      if (result?.ok) {
        /**
         * Electron switches its API-key-backed session in main and answers
         * without `reloadRequired`; retain its current in-place update.
         */
        setState((previous) => ({
          orgs: Array.isArray(result.orgs) && result.orgs.length ? result.orgs : previous.orgs,
          activeOrgId: result.activeOrgId ?? previous.activeOrgId,
          subject: sub,
        }));
      }
      return result;
    } finally {
      if (generation.current === mine) setSwitching(false);
    }
  }, [sub]);

  /**
   * Hide a prior subject's snapshot during render, before the effect can clear it, to avoid
   * exposing their organization names.
   */
  const visibleState = state.subject === sub ? state : NONE;
  const activeOrg = visibleState.orgs.find((org) => org.id === visibleState.activeOrgId) ?? null;

  return {
    orgs: visibleState.orgs,
    activeOrgId: visibleState.activeOrgId,
    activeOrg,
    switching,
    switchOrg,
    refresh: load,
  };
}
