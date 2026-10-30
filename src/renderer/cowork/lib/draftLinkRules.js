import { DRAFT_LINK_ORIGINS } from '../../../shared/draft-link-origins';

// How long the server's links live (cowork-server DRAFT_TTL_SECONDS).
export const DRAFT_LINK_TTL_MS = 30 * 60 * 1000;

export class RefusedDraftLink extends Error {
  constructor() {
    super('The server returned no draft link.');
  }
}

// The frame's `src` and the new tab's address for a link from
// `createDraftLink`: an https URL on one of DRAFT_LINK_ORIGINS whose path
// starts at /_t/, rebuilt from that origin so nothing else in the server's
// string reaches a frame or a tab. Anything else is refused.
export function draftLinkUrl(link) {
  const raw = typeof link?.url === 'string' ? link.url : '';
  let parsed = null;
  try { parsed = new URL(raw); } catch { parsed = null; }
  const origin = parsed?.protocol === 'https:'
    ? DRAFT_LINK_ORIGINS.find((allowed) => allowed === parsed.origin)
    : undefined;
  if (!origin || !parsed.pathname.startsWith('/_t/')) throw new RefusedDraftLink();
  return `${origin}${parsed.pathname}${parsed.search}`;
}

// Why a failed link request means the page should stop asking for links and
// preview drafts through srcdoc, which the same server still serves; null when
// it does not. A link the page cannot frame is refused outright. A 404 means
// links are off only once /health says so (rolled back while the page was
// open): a deleted artifact answers 404 too. `readHealth` is
// host.checkConfigured.
export async function draftLinksWithdrawal(error, readHealth) {
  if (error instanceof RefusedDraftLink) return 'draft_link_refused';
  if (error?.status !== 404) return null;
  try {
    return (await readHealth()).draftLinks === true ? null : 'draft_links_off';
  } catch {
    return null;
  }
}

// Milliseconds until a link expires, by this page's clock. `expiresAt` is in
// seconds on the server's clock; when the two clocks disagree by more than a
// link's lifetime, the full lifetime from now is the better guess.
export function draftLinkLifetimeMs(expiresAt, now = Date.now()) {
  const left = Number(expiresAt) * 1000 - now;
  return Number.isFinite(left) && left > 0 && left <= DRAFT_LINK_TTL_MS ? left : DRAFT_LINK_TTL_MS;
}
