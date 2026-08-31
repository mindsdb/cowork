import { useCallback, useEffect, useRef, useState } from 'react';
import { mindshubListOrgs, mindshubSwitchOrg } from '../../platform/host';
import { prepareForOrganizationReload } from '../lib/organizationTransition';

/**
 * The MindsHub organizations this person belongs to, and which one is active in
 * their authenticated Cowork session.
 *
 * Read when the signed-in identity resolves rather than on every menu open. The
 * list comes from Keycloak through the platform host and rarely moves within a
 * session, while the account menu is mounted for the whole of one — a fetch per
 * open would mostly re-answer the same question. `refresh` covers the case that
 * actually changes it, which is a switch.
 *
 * Every failure resolves to no organizations, and that is the resting state
 * too: while the read is in flight, when the person is signed out, and when the
 * installed main process predates these channels. The account menu then renders
 * exactly as it does today. There is no loading affordance for the same reason
 * the workspace selector has none — a group that appeared, flickered and
 * vanished reads worse than one that appears a beat late.
 *
 * Web reads identify a transient failure with `reachable: false`. Retry those:
 * the first request can race authentication settling, and one miss must not hide
 * the organization group for the whole session. The desktop bridge predates the
 * field, so a missing `reachable` is a definite legacy answer, including its
 * intentional empty fallback when an older main process has no such channel.
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
   * Resolves to the result rather than throwing, because a refusal is an
   * outcome the caller has to render and not an exception it has to translate.
   * Nothing is applied optimistically: the host decides whether the switch
   * happened and what the organization list looks like afterwards, so painting
   * the check on a row it then refuses is how the app ends up disagreeing with
   * the organization its requests are scoped to.
   */
  const switchOrg = useCallback(async (organizationId) => {
    const mine = generation.current;
    setSwitching(true);
    try {
      const result = await mindshubSwitchOrg(organizationId);
      /**
       * On web, Keycloak may change the server-side tenant before its forced
       * token refresh succeeds. Either outcome then carries `reloadRequired`:
       * old org-scoped caches must be gone before a hard reload reconciles the
       * session. This runs even after identity change or unmount, because a
       * responsive shell swap must not cancel a tenant-safety reload.
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
   * React renders with the new subject before its effect can clear the old
   * snapshot. Key it here so the previous person's organization names never
   * survive even that one render while the replacement read is pending.
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
