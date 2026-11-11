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

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const IMAGE_DIRECTIVE = 'img-src';

function directiveName(part: string): string {
  return part.trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Lets the web page show org brand images: appends the auth hosts to the
 * img-src directive of the page's CSP meta tag (img-src also governs the tab
 * icon) and changes nothing else. Only the hosted web build applies it
 * (vite.config.ts), with its environment's origins, so self-hosted and
 * white-label pages never name them.
 *
 * Refuses a missing or duplicate meta tag or directive, and a host the policy
 * already lists, so a changed template fails the build.
 */
export function withOrgBrandImageSources(html: string, origins: readonly string[] = orgBrandImageOrigins(undefined)): string {
  const metaTags = html.match(/http-equiv="Content-Security-Policy"/gi) ?? [];
  const meta = CSP_META.exec(html);
  if (metaTags.length !== 1 || !meta) {
    throw new Error('The web page needs exactly one Content-Security-Policy meta tag to take the brand image hosts.');
  }
  const policy = meta[2];
  for (const origin of origins) {
    if (policy.includes(origin)) {
      throw new Error(`The web page's Content-Security-Policy already lists ${origin}.`);
    }
  }
  const parts = policy.split(';');
  if (parts.filter((part) => directiveName(part) === IMAGE_DIRECTIVE).length !== 1) {
    throw new Error(`The web page's Content-Security-Policy needs exactly one ${IMAGE_DIRECTIVE} directive to take the brand image hosts.`);
  }
  const sources = origins.join(' ');
  const widened = parts
    .map((part) => {
      if (directiveName(part) !== IMAGE_DIRECTIVE) return part;
      const body = part.trimEnd();
      return `${body} ${sources}${part.slice(body.length)}`;
    })
    .join(';');
  return html.replace(CSP_META, (_tag, start: string, _policy: string, end: string) => `${start}${widened}${end}`);
}
