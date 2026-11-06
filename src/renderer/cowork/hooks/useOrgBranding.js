import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchOrgBranding } from '../api';
import { mindshubOrgBranding, onMindsHubAuthChanged } from '../../platform/host';
import { desktopOrgBranding, parseOrgBranding } from '../../lib/orgBranding';
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
 * `enabled` is hosted org mode. `desktop` is the desktop app, which reads the
 * active company org's logo and icon through the main process (and gets no
 * org look: that lives in the hosted cowork-server). Neither: the hook
 * answers null, so self-hosted builds look exactly as they did. Desktop is
 * not cached here: main keeps the images on disk.
 */
export function useOrgBranding({ enabled, desktop = false, settingsOpen }) {
  const [branding, setBranding] = useState(() => (desktop ? null : loadCachedOrgBranding()));
  const active = enabled || desktop;
  // A read that resolves after a newer one started drops itself.
  const generation = useRef(0);

  const remember = useCallback((raw) => {
    const parsed = parseOrgBranding(raw);
    setBranding(parsed);
    cacheOrgBranding(parsed);
    return parsed;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled && !desktop) return;
    generation.current += 1;
    const mine = generation.current;
    if (desktop && !enabled) {
      // null is a real answer here (signed out, personal org, no images).
      try {
        const raw = await mindshubOrgBranding();
        if (generation.current === mine) setBranding(desktopOrgBranding(raw));
      } catch {
        /* keep what is showing */
      }
      return;
    }
    try {
      const raw = await fetchOrgBranding();
      if (generation.current === mine) remember(raw);
    } catch {
      /* keep what is showing */
    }
  }, [enabled, desktop, remember]);

  /** Apply an answer the caller already has (an admin's save), with no read. */
  const apply = useCallback((raw) => {
    generation.current += 1;
    return remember(raw);
  }, [remember]);

  // Startup, and org mode resolving after boot.
  useEffect(() => { refresh(); }, [refresh]);

  // An in-place org switch, and a sign-in.
  useEffect(() => {
    if (!active) return undefined;
    const offOrg = subscribeOrganizationChanges(() => { refresh(); });
    // Sign-in reads again; on desktop sign-out does too, which clears the
    // images and puts the stock app icon back.
    const offAuth = onMindsHubAuthChanged(({ authenticated } = {}) => {
      if (authenticated || desktop) refresh();
    });
    return () => {
      offOrg();
      offAuth();
    };
  }, [active, desktop, refresh]);

  // Each time Settings opens.
  const wasOpen = useRef(settingsOpen);
  useEffect(() => {
    if (settingsOpen && !wasOpen.current) refresh();
    wasOpen.current = settingsOpen;
  }, [settingsOpen, refresh]);

  return {
    branding: active ? branding : null,
    refresh,
    apply,
  };
}
