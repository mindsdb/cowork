const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const IMAGE_DIRECTIVE = 'img-src';

const directiveName = (part: string): string => part.trim().split(/\s+/)[0].toLowerCase();

/**
 * Appends `origins` to the img-src directive of the page's CSP meta tag and
 * changes nothing else. A host img-src already lists is left as it is, so
 * transforms that share a host (the dev wildcard) give the same page in
 * either order.
 *
 * Refuses a missing or duplicate meta tag or img-src directive, so a changed
 * template fails the build. `what` names the hosts in the error.
 */
export function withImageSources(html: string, origins: readonly string[], what: string): string {
  const metaTags = html.match(/http-equiv="Content-Security-Policy"/gi) ?? [];
  const meta = CSP_META.exec(html);
  if (metaTags.length !== 1 || !meta) {
    throw new Error(`The web page needs exactly one Content-Security-Policy meta tag to take the ${what}.`);
  }
  const parts = meta[2].split(';');
  const images = parts.filter((part) => directiveName(part) === IMAGE_DIRECTIVE);
  if (images.length !== 1) {
    throw new Error(`The web page's Content-Security-Policy needs exactly one ${IMAGE_DIRECTIVE} directive to take the ${what}.`);
  }
  const listed = images[0].trim().split(/\s+/);
  const added = origins.filter((origin, i) => !listed.includes(origin) && origins.indexOf(origin) === i);
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
