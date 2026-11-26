import { withImageSources } from './csp-image-sources';

// The console hosts the Use Case Gallery's pictures come from
// (`<console>/gallery-examples/thumbs/…`). Images only: the gallery never
// frames a console page, because the shell policies keep our own app domains
// out of frame-src (shellCsp.test.ts), so a live example opens in the browser.
//
// Each hosted web image is built for one environment (VITE_BRAND_ENV), so its
// page names only that environment's console. Development covers the per-PR
// consoles, which need the dev wildcard. The desktop shell is one bundle for
// every build kind, so its template names production and staging, never dev.

const ORIGINS_BY_ENV: Record<string, readonly string[]> = {
  production: ['https://console.mindshub.ai'],
  staging: ['https://console.staging.mindshub.ai'],
  development: ['https://*.dev.mindshub.ai'],
};

/** Production and staging: a build that names no environment, and the desktop shell. */
export const GALLERY_CONSOLE_ORIGINS: readonly string[] = ['https://console.mindshub.ai', 'https://console.staging.mindshub.ai'];

/** The console origins a hosted web build for `env` may load gallery pictures from. */
export function galleryImageOrigins(env: string | undefined | null): readonly string[] {
  const key = (env ?? '').trim().toLowerCase();
  return ORIGINS_BY_ENV[key] ?? GALLERY_CONSOLE_ORIGINS;
}

/**
 * Appends the console hosts to the img-src directive of the page's CSP meta
 * tag and changes nothing else. Only the hosted web build applies it
 * (vite.config.ts); self-hosted and white-label pages have no console.
 */
export function withGalleryImageSources(html: string, origins: readonly string[] = GALLERY_CONSOLE_ORIGINS): string {
  return withImageSources(html, origins, 'gallery image hosts');
}
