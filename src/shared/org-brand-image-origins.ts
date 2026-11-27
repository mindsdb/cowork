import { withImageSources } from './csp-image-sources';

// The hosts an org's logo and icon are served from: auth's public branding
// route, `https://<auth host>/v1/organizations/{id}/branding/{kind}`. Each
// hosted image is built for one environment (build-deploy.yml passes its
// build-environment as VITE_BRAND_ENV), so its page names only that
// environment's auth host: production never allows a staging or dev host.
// Development covers the per-PR auth hosts (`auth-<env>.dev.mindshub.ai`),
// which need the dev wildcard. The renderer still shows an image only from
// the one auth host it talks to (shared/brand-image-url.ts); this list only
// lets the browser load it.
const ORIGINS_BY_ENV: Record<string, readonly string[]> = {
  production: ['https://auth.mindshub.ai'],
  staging: ['https://auth.staging.mindshub.ai'],
  development: ['https://*.dev.mindshub.ai'],
};

/** A build that names no environment (local `vite build`) gets prod and staging, never dev. */
const UNNAMED_ENV: readonly string[] = ['https://auth.mindshub.ai', 'https://auth.staging.mindshub.ai'];

/** The image origins a build for `env` may load org brand images from. */
export function orgBrandImageOrigins(env: string | undefined | null): readonly string[] {
  const key = (env ?? '').trim().toLowerCase();
  return ORIGINS_BY_ENV[key] ?? UNNAMED_ENV;
}

/**
 * Lets the web page show org brand images: appends the auth hosts to the
 * img-src directive of the page's CSP meta tag (img-src also governs the tab
 * icon) and changes nothing else. Only the hosted web build applies it
 * (vite.config.ts), with its environment's origins, so self-hosted and
 * white-label pages never name them.
 */
export function withOrgBrandImageSources(html: string, origins: readonly string[] = orgBrandImageOrigins(undefined)): string {
  return withImageSources(html, origins, 'brand image hosts');
}
