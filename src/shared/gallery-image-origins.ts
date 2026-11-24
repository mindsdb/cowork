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

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const IMAGE_DIRECTIVE = 'img-src';

const directiveName = (part: string): string => part.trim().split(/\s+/)[0].toLowerCase();

/**
 * Appends the console hosts to the img-src directive of the page's CSP meta
 * tag and changes nothing else. Only the hosted web build applies it
 * (vite.config.ts); self-hosted and white-label pages have no console.
 *
 * Refuses a missing or duplicate meta tag or directive, so a changed template
 * fails the build.
 */
export function withGalleryImageSources(html: string, origins: readonly string[] = GALLERY_CONSOLE_ORIGINS): string {
  const metaTags = html.match(/http-equiv="Content-Security-Policy"/gi) ?? [];
  const meta = CSP_META.exec(html);
  if (metaTags.length !== 1 || !meta) {
    throw new Error('The web page needs exactly one Content-Security-Policy meta tag to take the gallery image hosts.');
  }
  const parts = meta[2].split(';');
  const images = parts.filter((part) => directiveName(part) === IMAGE_DIRECTIVE);
  if (images.length !== 1) {
    throw new Error(`The web page's Content-Security-Policy needs exactly one ${IMAGE_DIRECTIVE} directive to take the gallery image hosts.`);
  }
  // A host already there is left as it is: in development the org brand
  // images use the same dev wildcard (org-brand-image-origins.ts).
  const listed = images[0].trim().split(/\s+/);
  const added = origins.filter((origin) => !listed.includes(origin));
  if (!added.length) return html;
  const widened = parts
    .map((part) => {
      if (directiveName(part) !== IMAGE_DIRECTIVE) return part;
      const body = part.trimEnd();
      return `${body} ${added.join(' ')}${part.slice(body.length)}`;
    })
    .join(';');
  return html.replace(CSP_META, (_tag, start: string, _policy: string, end: string) => `${start}${widened}${end}`);
}
