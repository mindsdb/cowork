// The draft-preview hosts, where the web preview frame and "open in a browser
// tab" load a signed draft link: production, staging and dev, all listed
// because one build serves every environment.
export const DRAFT_LINK_ORIGINS: readonly string[] = [
  'https://draft.mindshub.co',
  'https://draft-staging.mindshub.co',
  'https://draft-dev.mindshub.co',
];

const CSP_META = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i;
const FRAME_DIRECTIVES = ['frame-src', 'child-src'];

function directiveName(part: string): string {
  return part.trim().split(/\s+/)[0].toLowerCase();
}

/**
 * Lets the web page's preview frame load the draft hosts: appends them to the
 * frame-src and child-src directives of the page's CSP meta tag and changes
 * nothing else. Only the hosted web build applies it (vite.config.ts), so the
 * self-hosted and white-label pages built from the same template never name
 * these hosts.
 *
 * Refuses a missing or duplicate meta tag or directive, and a draft host the
 * policy already lists, so a changed template fails the build instead of
 * shipping a page that cannot frame drafts.
 */
export function withDraftLinkFrameSources(html: string): string {
  const metaTags = html.match(/http-equiv="Content-Security-Policy"/gi) ?? [];
  const meta = CSP_META.exec(html);
  if (metaTags.length !== 1 || !meta) {
    throw new Error('The web page needs exactly one Content-Security-Policy meta tag to take the draft hosts.');
  }
  const policy = meta[2];
  for (const origin of DRAFT_LINK_ORIGINS) {
    if (policy.includes(origin)) {
      throw new Error(`The web page's Content-Security-Policy already lists ${origin}.`);
    }
  }
  const parts = policy.split(';');
  for (const name of FRAME_DIRECTIVES) {
    if (parts.filter((part) => directiveName(part) === name).length !== 1) {
      throw new Error(`The web page's Content-Security-Policy needs exactly one ${name} directive to take the draft hosts.`);
    }
  }

  const sources = DRAFT_LINK_ORIGINS.join(' ');
  const widened = parts
    .map((part) => {
      if (!FRAME_DIRECTIVES.includes(directiveName(part))) return part;
      const body = part.trimEnd();
      return `${body} ${sources}${part.slice(body.length)}`;
    })
    .join(';');
  return html.replace(CSP_META, (_tag, start: string, _policy: string, end: string) => `${start}${widened}${end}`);
}
