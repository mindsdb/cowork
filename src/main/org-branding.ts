// Company branding on desktop: the org's logo and icon, down to
// the dock/taskbar icon.
//
// The renderer reads the org's branding from its local server's
// GET /api/v1/org-branding, exactly as the web app reads the hosted one, and
// hands the image URLs it got there to this module. Here they are downloaded
// only from the configured auth host (shared/brand-image-url.ts), checked by
// their bytes (PNG, JPEG or WebP, at most 1 MB), and cached on disk keyed by
// URL, so an unchanged image (same `?v=` hash) is never fetched twice. The
// renderer gets data: URIs back, since its CSP loads no remote images, and the
// icon becomes the app icon.
//
// No icon, no org, or any failure: the stock icon. Read on demand only
// (launch, sign-in, org switch, Settings open), never on a timer.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron';
import { trustedAuthImageUrl } from '../shared/brand-image-url';
import { MINDS_AUTH_HOST } from './minds-urls';

/** The org's image URLs, as the renderer got them from org-branding. */
export interface BrandImageUrls {
  iconUrl?: unknown;
  logoUrl?: unknown;
  logoDarkUrl?: unknown;
}

/** The same images as data: URIs, each null when unset or not loadable. */
export interface BrandImages {
  iconUrl: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

export interface BrandImageDeps {
  /** The stock window/dock icon for this build channel. */
  stockIconPath: string;
  /** Where images are cached on disk. */
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
  cacheRoot: string,
  fetchImpl: typeof fetch = fetch,
  authHost: string | null = AUTH_HOST,
): Promise<{ bytes: Buffer; type: ImageType } | null> {
  const url = trustedAuthImageUrl(value, authHost);
  if (!url) return null;
  // One entry per org and kind: the URL's path names both, and its `?v=`
  // names the content. A new upload replaces the entry rather than adding
  // one, so the cache stays bounded by the orgs and kinds seen.
  const dir = cacheRoot;
  const slot = new URL(url);
  slot.search = '';
  const key = crypto.createHash('sha256').update(slot.toString()).digest('hex').slice(0, 32);
  const file = path.join(dir, `${key}.img`);
  const source = path.join(dir, `${key}.src`);
  try {
    if (fs.readFileSync(source, 'utf8') === url) {
      const cached = fs.readFileSync(file);
      const type = sniffImageType(cached);
      if (type && cached.length <= MAX_IMAGE_BYTES) return { bytes: cached, type };
    }
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
      fs.writeFileSync(source, url);
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

let generation = 0;

/**
 * Load the org's images from the URLs the renderer got, set the app icon from
 * the icon (the stock one when there is none or it fails), and return them as
 * data: URIs. With null (no org branding, signed out) it just puts the stock
 * icon back. A call overtaken by a newer one changes nothing.
 */
export async function loadDesktopBrandImages(urls: BrandImageUrls | null, deps: BrandImageDeps): Promise<BrandImages | null> {
  generation += 1;
  const mine = generation;
  const fetchImpl = deps.fetchImpl ?? fetch;
  if (!urls) {
    applyAppIcon(null, deps.stockIconPath);
    return null;
  }
  const [icon, logo, logoDark] = await Promise.all([
    loadBrandImage(urls.iconUrl, deps.cacheRoot, fetchImpl),
    loadBrandImage(urls.logoUrl, deps.cacheRoot, fetchImpl),
    loadBrandImage(urls.logoDarkUrl, deps.cacheRoot, fetchImpl),
  ]);
  if (mine !== generation) return null;
  applyAppIcon(icon ? nativeImage.createFromBuffer(icon.bytes) : null, deps.stockIconPath);
  return { iconUrl: dataUri(icon), logoUrl: dataUri(logo), logoDarkUrl: dataUri(logoDark) };
}

/**
 * Each organization's icon for the org switcher, as data: URIs (org id →
 * URI), from the URLs the renderer got from /hub/org-icons. Same download
 * rules and cache as the org's own images; no app-icon change. An icon that
 * can't be loaded is left out.
 */
export async function loadOrgIconDataUris(
  urls: unknown,
  deps: Pick<BrandImageDeps, 'cacheRoot' | 'fetchImpl'>,
): Promise<Record<string, string>> {
  if (!urls || typeof urls !== 'object' || Array.isArray(urls)) return {};
  const entries = Object.entries(urls as Record<string, unknown>).slice(0, 100);
  const loaded = await Promise.all(entries.map(async ([id, url]) => [
    id, dataUri(await loadBrandImage(url, deps.cacheRoot, deps.fetchImpl ?? fetch)),
  ] as const));
  return Object.fromEntries(loaded.filter((entry): entry is [string, string] => entry[1] !== null));
}

/** Test hook: forget overtaken calls. */
export function __resetOrgBrandingForTests(): void {
  generation = 0;
}
