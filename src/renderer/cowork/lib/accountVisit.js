// Whether this is the first time an account has opened Cowork web in this
// browser, for the `first_visit` property on the console arrival.
//
// Decided once per account per document, from the first token web-main sees,
// before the app can write anything for that account. The answer is "first"
// only when this browser holds nothing of the account's:
//
//   - our own mark, written here on every signed-in web load;
//   - the per-account caches the web app has kept since organization-scoped
//     storage shipped (anton.settingsCache, anton.composerDrafts,
//     anton.orgBrandingCache), whose keys carry `subject:<sub>:organization:`;
//   - the analytics merge marker, which holds the last account that signed in
//     here (cleared on sign-out).
//
// The caches mean an account that used Cowork web before our mark existed
// still reads as returning. It is still "this browser" only: a new browser,
// a private window or cleared site data reads as a first visit.

import { decodeJwtPayload } from './jwtClaims';

// The analytics merge marker's key, owned here so analytics.js and this module
// cannot drift apart.
export const ANALYTICS_MERGED_SUB_KEY = 'cowork_identity_merged_sub';

const VISITED_PREFIX = 'anton.coworkVisited:subject:';
const ACCOUNT_CACHE_PREFIXES = ['anton.settingsCache:', 'anton.composerDrafts:', 'anton.orgBrandingCache:'];

const decided = new Map();

const localStore = () => {
  try { return window.localStorage; } catch { return null; }
};

function holdsAccountState(storage, sub) {
  const subject = encodeURIComponent(sub);
  if (storage.getItem(`${VISITED_PREFIX}${subject}`) === '1') return true;
  if (storage.getItem(ANALYTICS_MERGED_SUB_KEY) === sub) return true;
  const scope = `subject:${subject}:organization:`;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && ACCOUNT_CACHE_PREFIXES.some((p) => key.startsWith(p)) && key.includes(scope)) return true;
  }
  return false;
}

/** Record that the token's account opened Cowork web here. The first call per
    account decides `first_visit` for this document; later calls (a refreshed
    token) change nothing. Unknown when storage cannot be read. Never throws. */
export function noteAccountVisit(accessToken, storage = localStore()) {
  const sub = decodeJwtPayload(accessToken)?.sub;
  if (typeof sub !== 'string' || !sub || decided.has(sub)) return;
  let first = null;
  try {
    if (storage) first = !holdsAccountState(storage, sub);
  } catch {
    first = null;
  }
  decided.set(sub, first);
  try { storage?.setItem(`${VISITED_PREFIX}${encodeURIComponent(sub)}`, '1'); } catch {}
}

/** true or false once decided for this account in this document, otherwise
    undefined (Desktop, or storage unreadable), so the property is left off. */
export function isFirstVisit(sub) {
  const first = decided.get(sub);
  return typeof first === 'boolean' ? first : undefined;
}

export function __resetAccountVisitForTests() {
  decided.clear();
}
