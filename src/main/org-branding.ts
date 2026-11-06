// Company branding on desktop (ENG-4020): when the signed-in MindsHub account
// is in a company organization that has a logo or icon, the app shows them,
// down to the dock/taskbar icon.
//
// The images live in auth. Their URLs come from
// `GET /v1/organizations/current/branding/` with the user's MindsHub token
// (the same credential and call path minds-auth.ts uses for /authenticate/),
// and the images themselves are public. They are downloaded here, in main,
// only from the configured auth host (shared/brand-image-url.ts), checked by
// their bytes (PNG, JPEG or WebP, at most 1 MB), and cached on disk per org
// keyed by URL, so an unchanged image (same `?v=` hash) is never fetched
// twice. The renderer gets data: URIs, since its CSP loads no remote images.
//
// The org's look (colors, sidebar title, member choice) is stored by the
// hosted cowork-server, which the desktop does not call; see the PR notes.
//
// Everything falls back to the stock icon: signed out, a personal
// organization, no icon, or any failure along the way. Read on demand only
// (launch, sign-in, org switch, Settings open), never on a timer.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import { trustedAuthImageUrl } from '../shared/brand-image-url';
import { organizationLabel, type MindsOrgList } from '../shared/minds-orgs';
import { MINDS_AUTH_HOST, MINDS_AUTH_SERVICE_URL } from './minds-urls';

/** What the renderer gets: the active company org's images as data: URIs. */
export interface DesktopOrgBranding {
  orgId: string;
  orgName: string | null;
  iconUrl: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

export interface OrgBrandingDeps {
  freshAccessToken: () => Promise<string | null>;
  listMindsOrgs: () => Promise<MindsOrgList>;
  /** The stock window/dock icon for this build channel. */
  stockIconPath: string;
  /** Where per-org images are cached on disk. */
  cacheRoot: string;
  fetchImpl?: typeof fetch;
}

const AUTH_HOST = hostOf(MINDS_AUTH_HOST);
const MAX_IMAGE_BYTES = 1_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

function hostOf(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/** The image type from its first bytes; anything else (SVG, GIF, HTML) is refused. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) return 'image/webp';
  return null;
}

/** A trusted image's bytes, from the disk cache or downloaded into it; null on any failure. */
export async function loadBrandImage(
  value: unknown,
  orgId: string,
  cacheRoot: string,
  fetchImpl: typeof fetch = fetch,
  authHost: string | null = AUTH_HOST,
): Promise<{ bytes: Buffer; type: ImageType } | null> {
  const url = trustedAuthImageUrl(value, authHost);
  if (!url) return null;
  const dir = path.join(cacheRoot, crypto.createHash('sha256').update(orgId).digest('hex').slice(0, 32));
  const file = path.join(dir, `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}.img`);
  try {
    const cached = fs.readFileSync(file);
    const type = sniffImageType(cached);
    if (type && cached.length <= MAX_IMAGE_BYTES) return { bytes: cached, type };
  } catch { /* not cached yet */ }
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
    const type = sniffImageType(bytes);
    if (!type) return null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, bytes);
    } catch { /* a cache that can't be written just means a fetch next time */ }
    return { bytes, type };
  } catch {
    return null;
  }
}

function dataUri(image: { bytes: Buffer; type: ImageType } | null): string | null {
  return image ? `data:${image.type};base64,${image.bytes.toString('base64')}` : null;
}

/**
 * Show `image` as the app icon (macOS dock, every window's taskbar icon), or
 * with null the stock icon for this build channel.
 */
export function applyAppIcon(image: NativeImage | null, stockIconPath: string): void {
  const icon = image && !image.isEmpty() ? image : nativeImage.createFromPath(stockIconPath);
  try { app.dock?.setIcon(icon); } catch { /* no dock on this platform */ }
  for (const win of BrowserWindow.getAllWindows()) {
    try { if (!win.isDestroyed()) win.setIcon(icon); } catch { /* macOS windows have no own icon */ }
  }
}

async function fetchBranding(token: string, fetchImpl: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchImpl(`${MINDS_AUTH_SERVICE_URL}/organizations/current/branding/`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json() as unknown;
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

let generation = 0;

/**
 * Read the active org's branding, set the app icon from it, and return what
 * the renderer shows. Null, with the stock icon back, whenever there is no
 * company org branding to show. A read overtaken by a newer one changes
 * nothing.
 */
export async function refreshDesktopOrgBranding(deps: OrgBrandingDeps): Promise<DesktopOrgBranding | null> {
  generation += 1;
  const mine = generation;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const settle = (result: DesktopOrgBranding | null, icon: NativeImage | null) => {
    if (mine !== generation) return null;
    applyAppIcon(icon, deps.stockIconPath);
    return result;
  };

  const token = await deps.freshAccessToken().catch(() => null);
  if (!token) return settle(null, null);
  const list = await deps.listMindsOrgs().catch(() => null);
  const active = list?.orgs.find((org) => org.id === list.activeOrgId) ?? null;
  if (!active || active.isPersonal) return settle(null, null);

  const body = await fetchBranding(token, fetchImpl);
  if (!body) return settle(null, null);
  const [icon, logo, logoDark] = await Promise.all([
    loadBrandImage(body.icon_url, active.id, deps.cacheRoot, fetchImpl),
    loadBrandImage(body.logo_url, active.id, deps.cacheRoot, fetchImpl),
    loadBrandImage(body.logo_dark_url, active.id, deps.cacheRoot, fetchImpl),
  ]);
  if (!icon && !logo && !logoDark) return settle(null, null);
  return settle(
    {
      orgId: active.id,
      orgName: organizationLabel(active),
      iconUrl: dataUri(icon),
      logoUrl: dataUri(logo),
      logoDarkUrl: dataUri(logoDark),
    },
    icon ? nativeImage.createFromBuffer(icon.bytes) : null,
  );
}

/** Test hook: forget overtaken reads. */
export function __resetOrgBrandingForTests(): void {
  generation = 0;
}
