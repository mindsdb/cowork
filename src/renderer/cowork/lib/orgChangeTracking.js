/*
 * Reports when this device finds the account in a different organization than
 * it last saw, and why.
 *
 * The active organization is one value per account, shared by every tab,
 * window and app the person is signed in to. Any of them can move it, so a
 * page can load into an organization nobody on this device chose. The event
 * counts those moves and separates the ones this app made (a menu pick, the
 * landing step) from the ones that happened somewhere else.
 *
 * Both records are per account and per browser. Storage can be missing or
 * throw; a move is then simply not reported.
 */

import { useEffect } from 'react';
import { PLATFORM_UI } from '../../lib/deployment';
import { trackOrganizationChanged } from './analytics';

const LAST_SEEN_KEY = 'anton.lastSeenOrg:';
const INTENT_KEY = 'anton.orgSwitchIntent:';

// A switch reloads within seconds. An intent older than this was refused or
// abandoned, and must not claim a later move made elsewhere.
const INTENT_MAX_AGE_MS = 2 * 60 * 1000;

function readJson(key) {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

function remove(key) {
  try { globalThis.localStorage?.removeItem(key); } catch { /* best effort */ }
}

const kindOf = (isPersonal) => (isPersonal ? 'personal' : 'company');

/**
 * Records that this app is about to move the account to `orgId`, so the load
 * that follows can name the cause. Call it before the switch: the switch
 * reloads the document.
 *
 * @param {string | null} sub
 * @param {string} orgId
 * @param {'menu' | 'landing'} cause
 */
export function noteOrgSwitchIntent(sub, orgId, cause) {
  if (sub && orgId) writeJson(INTENT_KEY + sub, { to: orgId, cause, at: Date.now() });
}

/**
 * Compares the active organization with the one this device last saw.
 *
 * @returns {{ fromKind: string, toKind: string, cause: string } | null} The
 *   move to report, or null when there is none or nothing to compare with.
 */
export function observeActiveOrg(sub, activeOrg, now = Date.now()) {
  if (!sub || !activeOrg?.id) return null;
  const seen = readJson(LAST_SEEN_KEY + sub);
  const intent = readJson(INTENT_KEY + sub);
  const personal = Boolean(activeOrg.isPersonal);
  if (seen?.id !== activeOrg.id || seen?.personal !== personal) {
    writeJson(LAST_SEEN_KEY + sub, { id: activeOrg.id, personal });
  }
  if (intent) remove(INTENT_KEY + sub);
  if (!seen?.id || seen.id === activeOrg.id) return null;
  const intended = intent?.to === activeOrg.id && now - Number(intent.at) <= INTENT_MAX_AGE_MS;
  return {
    fromKind: kindOf(seen.personal),
    toKind: kindOf(personal),
    cause: intended && typeof intent.cause === 'string' ? intent.cause : 'outside_app',
  };
}

/**
 * Reports a move of the active organization once the list has named it.
 *
 * @param {{ sub: string | null, activeOrg: { id: string, isPersonal?: boolean } | null }} args
 */
export function useOrgChangeTracking({ sub, activeOrg }) {
  const activeOrgId = activeOrg?.id ?? null;
  useEffect(() => {
    if (!PLATFORM_UI) return;
    const change = observeActiveOrg(sub, activeOrg);
    if (change) trackOrganizationChanged(change);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, activeOrgId]);
}
