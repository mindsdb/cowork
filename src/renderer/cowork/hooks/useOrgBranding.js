import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHubOrgIcons, fetchOrgBranding } from '../api';
import { getAccessToken, mindshubBrandImages, mindshubOrgIconUris, onMindsHubAuthChanged } from '../../platform/host';
import { parseOrgBranding, withDesktopImages, withoutImages } from '../../lib/orgBranding';
import { cacheOrgBranding, forgetCachedOrgBranding, loadCachedOrgBranding } from '../lib/orgBrandingCache';
import { subscribeOrganizationChanges } from '../lib/organizationChanges';
import { accountUserFromToken } from '../lib/accountUser';
import { dataUriIcons, parseOrgIcons, setOrgIcons } from '../lib/orgIcons';

/**
 * The org's branding, read from GET /api/v1/org-branding: on web from the
 * hosted server, on desktop from the local server (which passes it through
 * to auth with the MindsHub credential). One contract, one resolver.
 *
 * Read at four moments only, never on a timer: when the app starts (which on
 * web is also sign-in and the reload after an org switch), when the
 * organization changes in place, when the signed-in account or org changes
 * (a silent token refresh is neither), and each time Settings opens, which is
 * where an admin goes to change it and where a member would look for a change
 * an admin just made.
 *
 * The first paint uses the last answer for this org (orgBrandingCache.js), so
 * a branded org never flashes the stock look. A failed read, or an answer
 * that says the server couldn't reach auth (`reachable: false`), keeps what is
 * showing and isn't cached: a branded page going stock because one request
 * failed would read as the brand being removed. That holds only within one
 * org: on an org change the previous org's look is dropped at once, so the
 * stock look shows until the new org's answer lands and org A's look never
 * shows in org B.
 *
 * Desktop's page loads no remote images, so the image URLs go to the main
 * process, which downloads them from the auth host, sets the app icon, and
 * returns data: URIs (mindshubBrandImages). Its first paint uses the cached
 * look without images until those arrive.
 *
 * Neither web org mode nor desktop: the hook answers null, so self-hosted
 * builds look exactly as they did.
 */

/** Who and which org the current token is for; a token refresh keeps it. */
async function identityKey() {
  try {
    const user = accountUserFromToken(await getAccessToken());
    return user ? `${user.sub ?? ''}|${user.orgId ?? ''}` : 'signed-out';
  } catch {
    return 'unknown';
  }
}

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
      if (!raw || raw.reachable === false) return;
      const urls = parseOrgIcons(raw);
      setOrgIcons(desktop ? dataUriIcons(await mindshubOrgIconUris(urls)) : urls);
    } catch {
      /* keep what is showing */
    }
  }, [desktop]);

  const refresh = useCallback(async ({ orgChanged = false } = {}) => {
    if (!active) return;
    generation.current += 1;
    const mine = generation.current;
    if (orgChanged) {
      // Never keep the org being left: stock until the new org answers.
      setBranding(null);
      forgetCachedOrgBranding();
      if (desktop) mindshubBrandImages(null);
    }
    refreshOrgIcons();
    try {
      const raw = await fetchOrgBranding();
      // The server couldn't ask auth: not an answer about this org's brand.
      if (raw && typeof raw === 'object' && raw.reachable === false) return;
      const parsed = parseOrgBranding(raw);
      if (generation.current !== mine) return;
      // The cache keeps the URLs; desktop converts them again on each read.
      cacheOrgBranding(parsed);
      const shown = await withImages(parsed);
      if (generation.current === mine) setBranding(shown);
    } catch {
      /* keep what is showing */
    }
  }, [active, desktop, withImages, refreshOrgIcons]);

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

  // An in-place org switch, and a change of signed-in account or org. The
  // auth event also fires on every silent token refresh, so it reads again
  // only when who or which org actually changed.
  const lastIdentity = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    identityKey().then((key) => { if (live && lastIdentity.current === null) lastIdentity.current = key; });
    const offOrg = subscribeOrganizationChanges(() => { refresh({ orgChanged: true }); });
    const offAuth = onMindsHubAuthChanged(async () => {
      const key = await identityKey();
      if (!live || key === lastIdentity.current) return;
      lastIdentity.current = key;
      refresh({ orgChanged: true });
    });
    return () => {
      live = false;
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
