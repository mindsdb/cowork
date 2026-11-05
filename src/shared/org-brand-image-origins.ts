// The hosts an org's logo and icon (ENG-4020) are served from: auth's public
// branding route, `https://<auth host>/v1/organizations/{id}/branding/{kind}`.
// Production, staging and dev are listed, plus the dev domain's per-PR auth
// hosts (`auth-<env>.dev.mindshub.ai`), because one hosted build serves every
// environment. The renderer still shows an image only from the one auth host
// this build talks to (renderer/lib/orgBranding.ts trustedBrandImageUrl); this
// list only lets the browser load it.
export const ORG_BRAND_IMAGE_ORIGINS: readonly string[] = [
  'https://auth.mindshub.ai',
  'https://auth.staging.mindshub.ai',
  'https://*.dev.mindshub.ai',
];

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const IMAGE_DIRECTIVE = 'img-src';

function directiveName(part: string): string {
  return part.trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Lets the web page show org brand images: appends the auth hosts to the
 * img-src directive of the page's CSP meta tag (img-src also governs the tab
 * icon) and changes nothing else. Only the hosted web build applies it
 * (vite.config.ts), so self-hosted and white-label pages never name them.
 *
 * Refuses a missing or duplicate meta tag or directive, and a host the policy
 * already lists, so a changed template fails the build.
 */
export function withOrgBrandImageSources(html: string): string {
  const metaTags = html.match(/http-equiv="Content-Security-Policy"/gi) ?? [];
  const meta = CSP_META.exec(html);
  if (metaTags.length !== 1 || !meta) {
    throw new Error('The web page needs exactly one Content-Security-Policy meta tag to take the brand image hosts.');
  }
  const policy = meta[2];
  for (const origin of ORG_BRAND_IMAGE_ORIGINS) {
    if (policy.includes(origin)) {
      throw new Error(`The web page's Content-Security-Policy already lists ${origin}.`);
    }
  }
  const parts = policy.split(';');
  if (parts.filter((part) => directiveName(part) === IMAGE_DIRECTIVE).length !== 1) {
    throw new Error(`The web page's Content-Security-Policy needs exactly one ${IMAGE_DIRECTIVE} directive to take the brand image hosts.`);
  }
  const sources = ORG_BRAND_IMAGE_ORIGINS.join(' ');
  const widened = parts
    .map((part) => {
      if (directiveName(part) !== IMAGE_DIRECTIVE) return part;
      const body = part.trimEnd();
      return `${body} ${sources}${part.slice(body.length)}`;
    })
    .join(';');
  return html.replace(CSP_META, (_tag, start: string, _policy: string, end: string) => `${start}${widened}${end}`);
}
