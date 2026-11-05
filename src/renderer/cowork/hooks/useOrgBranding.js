import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOrgBranding } from '../api';
import { onMindsHubAuthChanged } from '../../platform/host';
import { parseOrgBranding } from '../../lib/orgBranding';
import { cacheOrgBranding, loadCachedOrgBranding } from '../lib/orgBrandingCache';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';

/**
 * The org's branding (ENG-4020), read from GET /api/v1/org-branding.
 *
 * Read at four moments only, never on a timer: when the app starts (which on
 * web is also sign-in and the reload after an org switch), when the
 * organization changes in place, when a sign-in lands, and each time Settings
 * opens, which is where an admin goes to change it and where a member would
 * look for a change an admin just made.
 *
 * The first paint uses the last answer for this org (orgBrandingCache.js), so
 * a branded org never flashes the stock look. A failed read keeps whatever is
 * showing: a branded page going stock because one request failed would read
 * as the brand being removed.
 *
 * `enabled` is false outside hosted org mode, and the hook then answers null,
 * so desktop and self-hosted builds look exactly as they did.
 */
export function useOrgBranding({ enabled, settingsOpen }) {
  const [branding, setBranding] = useState(loadCachedOrgBranding);
  // A read that resolves after a newer one started drops itself.
  const generation = useRef(0);

  const remember = useCallback((raw) => {
    const parsed = parseOrgBranding(raw);
    setBranding(parsed);
    cacheOrgBranding(parsed);
    return parsed;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    generation.current += 1;
    const mine = generation.current;
    try {
      const raw = await fetchOrgBranding();
      if (generation.current === mine) remember(raw);
    } catch {
      /* keep what is showing */
    }
  }, [enabled, remember]);

  /** Apply an answer the caller already has (an admin's save), with no read. */
  const apply = useCallback((raw) => {
    generation.current += 1;
    return remember(raw);
  }, [remember]);

  // Startup, and org mode resolving after boot.
  useEffect(() => { refresh(); }, [refresh]);

  // An in-place org switch, and a sign-in.
  useEffect(() => {
    if (!enabled) return undefined;
    const offOrg = subscribeOrganizationChanges(() => { refresh(); });
    const offAuth = onMindsHubAuthChanged(({ authenticated } = {}) => {
      if (authenticated) refresh();
    });
    return () => {
      offOrg();
      offAuth();
    };
  }, [enabled, refresh]);

  // Each time Settings opens.
  const wasOpen = useRef(settingsOpen);
  useEffect(() => {
    if (settingsOpen && !wasOpen.current) refresh();
    wasOpen.current = settingsOpen;
  }, [settingsOpen, refresh]);

  return {
    branding: enabled ? branding : null,
    refresh,
    apply,
  };
}
