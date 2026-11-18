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
//
// A first visit can reload before the arrival is recorded: Cowork reloads when
// it clears another account's data from this browser, or when the organization
// changes. By then our mark is written, so a first visit is also kept in this
// tab for as long as a console link stays waiting, and a reload inside that
// window reads it back.

import { decodeJwtPayload } from './jwtClaims';

// The analytics merge marker's key, owned here so analytics.js and this module
// cannot drift apart.
export const ANALYTICS_MERGED_SUB_KEY = 'cowork_identity_merged_sub';

const VISITED_PREFIX = 'anton.coworkVisited:subject:';
const ACCOUNT_CACHE_PREFIXES = ['anton.settingsCache:', 'anton.composerDrafts:', 'anton.orgBrandingCache:'];

const FIRST_VISIT_KEY = 'anton.coworkFirstVisit';
// The console handoff's own lifetime (consoleHandoff.js), so a link that is
// still waiting is still read against the visit it arrived on.
const FIRST_VISIT_MAX_AGE_MS = 10 * 60 * 1000;

const decided = new Map();

const localStore = () => {
  try { return window.localStorage; } catch { return null; }
};
const sessionStore = () => {
  try { return window.sessionStorage; } catch { return null; }
};

function firstVisitKeptInTab(session, sub, now) {
  try {
    const kept = JSON.parse(session?.getItem(FIRST_VISIT_KEY) ?? 'null');
    return kept?.sub === sub && typeof kept.at === 'number' && kept.at <= now && now - kept.at <= FIRST_VISIT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

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
export function noteAccountVisit(accessToken, storage = localStore(), session = sessionStore(), now = Date.now()) {
  const sub = decodeJwtPayload(accessToken)?.sub;
  if (typeof sub !== 'string' || !sub || decided.has(sub)) return;
  let first = null;
  if (firstVisitKeptInTab(session, sub, now)) {
    first = true;
  } else {
    try {
      if (storage) first = !holdsAccountState(storage, sub);
    } catch {
      first = null;
    }
    if (first) {
      try { session?.setItem(FIRST_VISIT_KEY, JSON.stringify({ sub, at: now })); } catch {}
    }
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
