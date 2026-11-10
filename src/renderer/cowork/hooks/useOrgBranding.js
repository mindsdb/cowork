import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubOrgIcons, fetchOrgBranding } from '../api';
import { mindshubBrandImages, mindshubOrgIconUris, onMindsHubAuthChanged } from '../../platform/host';
import { dataUriIcons, parseOrgIcons, setOrgIcons } from '../lib/orgIcons';
import { parseOrgBranding, withDesktopImages, withoutImages } from '../../lib/orgBranding';
import { cacheOrgBranding, loadCachedOrgBranding } from '../lib/orgBrandingCache';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';

/**
 * The org's branding (ENG-4020), read from GET /api/v1/org-branding: on web
 * from the hosted server, on desktop from the local server (which passes it
 * through to auth with the MindsHub credential). One contract, one resolver.
 *
 * Read at four moments only, never on a timer: when the app starts (which on
 * web is also sign-in and the reload after an org switch), when the
 * organization changes in place, when a sign-in or sign-out lands, and each
 * time Settings opens, which is where an admin goes to change it and where a
 * member would look for a change an admin just made.
 *
 * The first paint uses the last answer for this org (orgBrandingCache.js), so
 * a branded org never flashes the stock look. A failed read keeps whatever is
 * showing: a branded page going stock because one request failed would read
 * as the brand being removed.
 *
 * Desktop's page loads no remote images, so the image URLs go to the main
 * process, which downloads them from the auth host, sets the app icon, and
 * returns data: URIs (mindshubBrandImages). Its first paint uses the cached
 * look without images until those arrive.
 *
 * Neither web org mode nor desktop: the hook answers null, so self-hosted
 * builds look exactly as they did.
 */
export function useOrgBranding({ enabled, desktop = false, settingsOpen }) {
  const active = enabled || desktop;
  const [branding, setBranding] = useState(() => {
    const cached = loadCachedOrgBranding();
    return desktop ? withoutImages(cached) : cached;
  });
  // A read that resolves after a newer one started drops itself.
  const generation = useRef(0);
  const latest = useRef(branding);
  useEffect(() => { latest.current = branding; }, [branding]);

  // Desktop: swap the image URLs for main's data URIs, and set (or reset)
  // the app icon on the way.
  const withImages = useCallback(async (parsed) => {
    if (!desktop) return parsed;
    if (!parsed.enabled) {
      await mindshubBrandImages(null);
      return parsed;
    }
    const images = await mindshubBrandImages({
      iconUrl: parsed.iconUrl, logoUrl: parsed.logoUrl, logoDarkUrl: parsed.logoDarkUrl,
    });
    return withDesktopImages(parsed, images);
  }, [desktop]);

  // Each org's icon for the switcher, read with the branding. A failed read
  // keeps what the menu shows; it falls back to the Keycloak attribute anyway.
  const refreshOrgIcons = useCallback(async () => {
    try {
      const raw = await fetchHubOrgIcons();
      if (!raw) return;
      const urls = parseOrgIcons(raw);
      setOrgIcons(desktop ? dataUriIcons(await mindshubOrgIconUris(urls)) : urls);
    } catch {
      /* keep what is showing */
    }
  }, [desktop]);

  const refresh = useCallback(async () => {
    if (!active) return;
    generation.current += 1;
    const mine = generation.current;
    refreshOrgIcons();
    try {
      const parsed = parseOrgBranding(await fetchOrgBranding());
      if (generation.current !== mine) return;
      // The cache keeps the URLs; desktop converts them again on each read.
      cacheOrgBranding(parsed);
      const shown = await withImages(parsed);
      if (generation.current === mine) setBranding(shown);
    } catch {
      /* keep what is showing */
    }
  }, [active, withImages, refreshOrgIcons]);

  /**
   * Apply an answer the caller already has (an admin's save), with no read.
   * A save changes the look, not the images, so desktop keeps the images it
   * is showing.
   */
  const apply = useCallback((raw) => {
    generation.current += 1;
    const parsed = parseOrgBranding(raw);
    cacheOrgBranding(parsed);
    const shown = desktop && latest.current
      ? { ...parsed, iconUrl: latest.current.iconUrl, logoUrl: latest.current.logoUrl, logoDarkUrl: latest.current.logoDarkUrl }
      : parsed;
    setBranding(shown);
    return shown;
  }, [desktop]);

  // Startup, and org mode resolving after boot.
  useEffect(() => { refresh(); }, [refresh]);

  // An in-place org switch, and a sign-in or sign-out (desktop).
  useEffect(() => {
    if (!active) return undefined;
    const offOrg = subscribeOrganizationChanges(() => { refresh(); });
    const offAuth = onMindsHubAuthChanged(() => { refresh(); });
    return () => {
      offOrg();
      offAuth();
    };
  }, [active, refresh]);

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
