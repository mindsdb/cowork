import { useCallback, useEffect, useRef, useState } from 'react';
import { mindshubListOrgs, mindshubSwitchOrg } from '../../platform/host';

// The MindsHub organizations this person belongs to, and which one this install
// mints its API key in.
//
// Read when the signed-in identity resolves rather than on every menu open. The
// list comes from Keycloak through the main process and rarely moves within a
// session, while the account menu is mounted for the whole of one — a fetch per
// open would mostly re-answer the same question. `refresh` covers the case that
// actually changes it, which is a switch.
//
// Every failure resolves to no organizations, and that is the resting state
// too: while the read is in flight, when the person is signed out, and when the
// installed main process predates these channels. The account menu then renders
// exactly as it does today. There is no loading affordance for the same reason
// the workspace selector has none — a group that appeared, flickered and
// vanished reads worse than one that appears a beat late.

const NONE = Object.freeze({ orgs: [], activeOrgId: null });

/** One shape whatever came back, so nothing downstream guards a field. */
function normalize(payload) {
  return {
    orgs: Array.isArray(payload?.orgs) ? payload.orgs : [],
    activeOrgId: payload?.activeOrgId ?? null,
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

  const load = useCallback(async () => {
    const mine = generation.current;
    if (!sub) {
      setState(NONE);
      return;
    }
    const payload = await mindshubListOrgs();
    if (generation.current === mine) setState(normalize(payload));
  }, [sub]);

  useEffect(() => {
    generation.current += 1;
    load();
  }, [load]);

  // Resolves to the result rather than throwing, because a refusal is an
  // outcome the caller has to render and not an exception it has to translate.
  // Nothing is applied optimistically: main decides whether the switch happened
  // and what the organization list looks like afterwards, so painting the check
  // on a row it then refuses is how the app ends up disagreeing with the
  // organization its own key belongs to.
  const switchOrg = useCallback(async (organizationId) => {
    setSwitching(true);
    try {
      const result = await mindshubSwitchOrg(organizationId);
      if (result?.ok) {
        setState((previous) => ({
          orgs: Array.isArray(result.orgs) && result.orgs.length ? result.orgs : previous.orgs,
          activeOrgId: result.activeOrgId ?? previous.activeOrgId,
        }));
      }
      return result;
    } finally {
      setSwitching(false);
    }
  }, []);

  const activeOrg = state.orgs.find((org) => org.id === state.activeOrgId) ?? null;

  return { ...state, activeOrg, switching, switchOrg, refresh: load };
}
