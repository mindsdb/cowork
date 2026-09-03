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
const LAST_ACCOUNT_KEY = 'anton.lastAccount';

/**
 * Key PREFIXES, not exact keys, for two reasons: the conversation caches carry
 * one entry per conversation id, and the draft and settings caches append an
 * organization epoch (see storageKeyForOrganizationEpoch), so their live keys
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
 * Drop this origin's account-scoped state when the signed-in account changed,
 * and record the account either way. Returns true only when something was
 * actually removed.
 *
 * Signed out (`null`) is left alone on purpose: the same account usually signs
 * back in, and sign-out has already taken away the credentials this state is
 * useless without. The first run with no record purges nothing — there is no
 * previous account to have left anything behind.
 */
export function purgeStaleAccountState(accountId: string | null): boolean {
  if (!accountId) return false;

  let store: Storage | undefined;
  try {
    store = globalThis.localStorage;
    if (!store) return false;
  } catch {
    // Accessing localStorage itself throws in some privacy modes.
    return false;
  }

  try {
    const last = store.getItem(LAST_ACCOUNT_KEY);
    if (last === accountId) return false;

    let removed = 0;
    if (last !== null) {
      // Collect first: removeItem during the index walk reshuffles the keys.
      const doomed: string[] = [];
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key && isAccountScoped(key)) doomed.push(key);
      }
      for (const key of doomed) store.removeItem(key);
      removed = doomed.length;
    }
    store.setItem(LAST_ACCOUNT_KEY, accountId);
    return removed > 0;
  } catch {
    // Unavailable or over quota. Nothing here is recoverable and none of it is
    // worth failing a boot over.
    return false;
  }
}
