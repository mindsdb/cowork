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

// Milliseconds until `margin` before a link expires, by this page's clock.
// `expiresAt` is in seconds on the server's clock. When the two clocks
// disagree by more than a link's lifetime (less than the margin left, or more
// than `cap`), the full lifetime from now is the better guess.
export function draftLinkLifetimeMs(expiresAt, now = Date.now(), { cap = DRAFT_LINK_TTL_MS, margin = 0 } = {}) {
  const left = Number(expiresAt) * 1000 - now;
  const trusted = Number.isFinite(left) && left - margin > 0 && left <= cap;
  return trusted ? left - margin : cap - margin;
}

// A published full-stack app's frame token (the view host's _cowork_token)
// lives an hour. Its preview asks for a reload this long before, so the
// overlay is up before the app's first request fails.
export const PUBLISHED_FRAME_TTL_MS = 60 * 60 * 1000;
export const PUBLISHED_FRAME_MARGIN_MS = 90 * 1000;

export function publishedFrameLifetimeMs(expiresAt, now = Date.now()) {
  return draftLinkLifetimeMs(expiresAt, now, { cap: PUBLISHED_FRAME_TTL_MS, margin: PUBLISHED_FRAME_MARGIN_MS });
}
