/**
 * Each organization's icon for the org switcher and account menu,
 * from GET /api/v1/hub/org-icons: `{ reachable, orgs: [{ id, iconUrl }] }`.
 *
 * A tiny module store rather than props: the read happens with the
 * org-branding read (useOrgBranding: startup, org switch, sign-in, Settings
 * open, never polled), and the account menu that shows the icons sits deep in
 * the sidebar. Only https URLs on the auth host are kept; on desktop, whose
 * page loads no remote images, main turns them into data: URIs first.
 */
import { useSyncExternalStore } from 'react';
import { trustedBrandImageUrl } from '../../lib/orgBranding';

const NONE = Object.freeze({});
let icons = NONE;
const listeners = new Set();

const BRAND_DATA_URI = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** org id → trusted icon URL, from the endpoint's answer; {} for anything unusable. */
export function parseOrgIcons(raw) {
  const rows = raw && typeof raw === 'object' && Array.isArray(raw.orgs) ? raw.orgs : [];
  const out = {};
  for (const row of rows) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    const url = trustedBrandImageUrl(row?.iconUrl);
    if (id && url) out[id] = url;
  }
  return out;
}

/** Keep only PNG, JPEG or WebP data URIs (desktop, after main converted them). */
export function dataUriIcons(map) {
  const out = {};
  for (const [id, uri] of Object.entries(map && typeof map === 'object' ? map : {})) {
    if (typeof uri === 'string' && BRAND_DATA_URI.test(uri)) out[id] = uri;
  }
  return out;
}

export function setOrgIcons(next) {
  icons = next && Object.keys(next).length ? Object.freeze({ ...next }) : NONE;
  for (const listener of listeners) listener();
}

export function getOrgIcons() {
  return icons;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The current org id → icon map; re-renders when a read lands. */
export function useOrgIcons() {
  return useSyncExternalStore(subscribe, getOrgIcons, getOrgIcons);
}
