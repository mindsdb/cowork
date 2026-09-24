/**
 * Browser-local state belonging to one signed-in account.
 *
 * Pointing the sidecar at a per-account data root fixes the server side of an
 * account switch, but localStorage is per ORIGIN and survives both the sidecar
 * restart and the renderer reload — so the previous account's drafts, turn
 * payloads and picks would still render over the new account's empty stores.
 * This purges them on the first boot that sees a different account.
 *
 * Web gets the same protection: org mode scopes the server, but two accounts
 * used in one browser profile still share this origin's localStorage.
 */

// Which account the state in this origin belongs to.
const LAST_ACCOUNT_STORAGE_NAME = 'anton.lastAccount';

// Which organization the state in this origin belongs to. Separate from the
// account marker: one account works in several organizations, and their state
// must not survive a move between them any more than it survives a sign-out.
const LAST_ORGANIZATION_KEY = 'anton.lastOrganization';

/**
 * Key PREFIXES, not exact keys, for two reasons: the conversation caches carry
 * one entry per conversation id, and the draft and settings caches append an
 * organization identity (see lib/organizationCacheIdentity), so their live keys
 * are longer than the base name they are declared with.
 */
const ACCOUNT_SCOPED_PREFIXES = [
  'anton:conv-turns:', // conversationHistory.js — full step lists, per conversation
  'anton:conv-artifacts:', // conversationHistory.js — its legacy sibling
  'anton.composerDrafts', // draftStore.js — unsent message text
  'anton.settingsCache', // settingsCache.js — first-paint settings
  'anton:pinned-projects', // ProjectsView.jsx — which projects were pinned
  'mindshub-code:last-project', // useCodeProjects.ts — last code project opened
  'mindshub-code-terminal:', // TaskTerminal.tsx — per coding session, one each
];

function isAccountScoped(key: string): boolean {
  return ACCOUNT_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * What to do with a cache that carries no account marker at all.
 *
 * Only an unmarked cache needs this: a marked one names its owner, so a
 * mismatch is decided without asking. Unmarked means the state predates
 * per-account roots, and it therefore belongs to whoever owns the default data
 * root — which the renderer cannot work out for itself.
 *
 * `keep` = this session is on that root, so the state is its own. `purge` = it
 * is on its own root, so the state is someone else's. `undecided` = the person
 * has not yet answered who owns the data, so nothing is touched AND nothing is
 * stamped, leaving the choice to the reload that follows their answer.
 */
export type LegacyStateVerdict = 'keep' | 'purge' | 'undecided';

/** What the shell resolved at preload time, for the session it booted with. */
export interface ShellAccountSession {
  accountId: string | null;
  legacyState: LegacyStateVerdict;
}

/**
 * The verdict a caller may use for the account it is purging for.
 *
 * The shell resolves its verdict once, in preload, so it describes the session
 * the DOCUMENT booted with. A sign-in inside that document is a different
 * session, and carrying a stale `keep` into it stamps this account's name on a
 * cache nobody has ruled on, which is the one thing that makes the ownership
 * answer unenforceable afterwards. So a snapshot about anyone else defers, and
 * the reload that follows the sign-in rules on it properly.
 *
 * `null` is the web build: no shell, no shared data root to be ambiguous about,
 * and an unmarked cache there belongs to this origin's first account as it
 * always has.
 */
export function legacyVerdictForSession(
  accountId: string | null,
  shell: ShellAccountSession | null,
): LegacyStateVerdict {
  if (!shell) return 'keep';
  return shell.accountId === accountId ? shell.legacyState : 'undecided';
}

/**
 * Drop this origin's account-scoped state when it belongs to another account,
 * and record the account. Returns true only when something was removed.
 *
 * The verdict is required, and every caller passes the one the shell resolved:
 * defaulting it to `keep` made a caller that could not know stamp its own name
 * on an unmarked cache, which is the one thing that makes the ownership answer
 * unenforceable.
 *
 * Signed out (`null`) is left alone on purpose: the same account usually signs
 * back in, and sign-out has already taken away the credentials this state is
 * useless without.
 */
export function purgeStaleAccountState(
  accountId: string | null,
  legacyState: LegacyStateVerdict,
): boolean {
  if (!accountId) return false;

  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
    if (!store) return false;
  } catch {
    // Accessing localStorage itself throws in some privacy modes.
    return false;
  }

  // An unrecognised verdict defers rather than keeping: a caller that cannot
  // name one has not ruled on an unmarked cache, and the typed signature does
  // not reach the untyped JS call sites.
  const verdict: LegacyStateVerdict =
    legacyState === 'keep' || legacyState === 'purge' ? legacyState : 'undecided';

  try {
    const last = store.getItem(LAST_ACCOUNT_STORAGE_NAME);
    if (last === accountId) return false;

    // Stamping our name on an undecided cache would make it un-purgeable: the
    // reload after the ownership answer would read `last === accountId` and
    // stop here, and the previous user's drafts would be this account's
    // forever.
    if (last === null && verdict === 'undecided') return false;

    let removed = 0;
    if (last !== null || verdict === 'purge') {
      // Collect first: removeItem during the index walk reshuffles the keys.
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && isAccountScoped(key)) doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
      removed = doomed.length;
    }
    store.setItem(LAST_ACCOUNT_STORAGE_NAME, accountId);
    return removed > 0;
  } catch {
    // Unavailable or over quota. Nothing here is recoverable and none of it is
    // worth failing a boot over.
    return false;
  }
}

/**
 * Drop this origin's organization-scoped state when it belongs to another
 * organization, and record the organization. Returns true only when something
 * was removed.
 *
 * The same keys as the account purge: they are scoped to one working context,
 * and an organization switch changes that context exactly as a sign-in does.
 * A null organization is left alone, for the same reason a signed-out account
 * is: there is nothing to attribute the state to yet.
 */
export function purgeOrganizationScopedState(
  organizationId: string | null,
  unmarked: 'keep' | 'purge' = 'keep',
): boolean {
  if (!organizationId) return false;

  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
    if (!store) return false;
  } catch {
    return false;
  }

  try {
    const last = store.getItem(LAST_ORGANIZATION_KEY);
    if (last === organizationId) return false;

    let removed = 0;
    // An unmarked origin is kept at BOOT, because state with no organization
    // attributed to it belongs to whoever is using the install, and purging it
    // would throw away an existing user's own drafts on the first launch after
    // this ships.
    //
    // An explicit SWITCH is the opposite: the working context demonstrably
    // changed, so unmarked state belongs to the organization being left. Boot
    // can legitimately see no marker at all — it runs before the asynchronous
    // refresh writes the record, so it is handed null and stamps nothing — and
    // without this a switch in that same launch would keep every cache and
    // stamp it as the target's, which the next reload then reads as correct.
    if (last !== null || unmarked === 'purge') {
      // Collect first: removeItem during the index walk reshuffles the keys.
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && isAccountScoped(key)) doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
      removed = doomed.length;
    }
    store.setItem(LAST_ORGANIZATION_KEY, organizationId);
    return removed > 0;
  } catch {
    return false;
  }
}

/**
 * Whether a document that has rendered for `lastRendered` must reload now that
 * the account is `next`.
 *
 * `lastRendered` is the last account the document actually rendered for, never
 * null-in-between, so signing out and back in as someone else reads as the one
 * change it is rather than two non-changes.
 *
 * Clearing storage cannot substitute for this. The composer can already hold
 * the previous account's draft before the identity resolves, and that draft
 * lives in a module map and in component state under a home key every account
 * spells the same way, neither of which storage removal touches.
 *
 * `displacedAnotherAccount` is the second way in, and it exists because the
 * first one cannot see the signed-out window. A document that boots signed out
 * renders the composer while the identity is still unresolved, so the previous
 * account's cache hydrates into that module map before anyone can say whose it
 * was; when the identity finally arrives as someone else, this document has
 * rendered for nobody yet and the account-to-account test above is false. What
 * is true is that the purge just removed state belonging to another account
 * while this document was already on screen — which is the same displacement,
 * observed at the cache rather than at the identity.
 */
export function shouldReloadForAccountChange(
  lastRendered: string | null,
  next: string | null,
  displacedAnotherAccount = false,
): boolean {
  // A sign-out on its own has no account to show yet, so neither route applies.
  if (!next) return false;
  // Not the first identity a document resolves: that one is no change.
  if (lastRendered && lastRendered !== next) return true;
  return displacedAnotherAccount;
}
