/*
 * Which organization a person lands in with MindsHub UI on: the one they
 * used last. That is the last one they picked from the menu, personal
 * included, or a company organization they were in since. Someone with no
 * such record starts in the first company organization listed rather than
 * in their personal one.
 *
 * The record is per account and per browser, so a pick holds in every tab
 * and window. Landing tries at most once per session, so a refused switch
 * can't loop through reloads, and not at all once the person has started
 * work in the page.
 */

import { useEffect } from 'react';
import { PLATFORM_UI } from '../../lib/deployment';
import { sharedTranslator } from '../../lib/i18n';
import { hasWorkStarted } from './documentWork';

/**
 * The organization to land in: the one used last while it is still listed,
 * else the first company organization, else null.
 *
 * @param {Array<{ id: string, isPersonal?: boolean }>} orgs In listing order.
 * @param {{ lastOrgId?: string | null, personalOrgId?: string | null }} options
 */
export function pickLandingOrg(orgs, { lastOrgId = null, personalOrgId = null } = {}) {
  const listed = (orgs || []).filter(Boolean);
  return listed.find((org) => org.id === lastOrgId)
    ?? listed.find((org) => !org.isPersonal && org.id !== personalOrgId)
    ?? null;
}

/**
 * The organization to switch to now, or null to stay. Only a personal (or
 * unknown) active organization is moved, and never away from the one the
 * person used last.
 */
export function landingSwitchTarget(orgs, {
  activeOrgId = null,
  lastOrgId = null,
  personalOrgId = null,
} = {}) {
  if (!Array.isArray(orgs) || orgs.length === 0) return null;
  const active = orgs.find((org) => org.id === activeOrgId);
  const activeIsPersonal = !active || active.isPersonal || active.id === personalOrgId;
  if (!activeIsPersonal) return null;
  const target = pickLandingOrg(orgs, { lastOrgId, personalOrgId });
  return target && target.id !== activeOrgId ? target : null;
}

// ── What this browser remembers ──────────────────────────────────────
// Keyed by the account, so a shared machine never moves one person into
// another's organization. Storage can be missing or throw; landing then
// falls back to the first company organization.

const LAST_ORG_KEY = 'anton.lastOrg:';
const ATTEMPTED_KEY = 'anton.orgLandingTried:';

function read(store, key) {
  try { return globalThis[store]?.getItem(key) ?? null; } catch { return null; }
}

function write(store, key, value) {
  try { globalThis[store]?.setItem(key, value); } catch { /* best effort */ }
}

export function readLastOrgId(sub) {
  return sub ? read('localStorage', LAST_ORG_KEY + sub) : null;
}

/**
 * Records the organization the person used last: one they pick from the
 * menu, personal included, or a company organization they are in. Being in
 * a personal organization records nothing by itself, since that is where a
 * new session starts.
 */
export function rememberLastOrg(sub, orgId) {
  if (sub && orgId) write('localStorage', LAST_ORG_KEY + sub, orgId);
}

function claimLandingAttempt(sub) {
  if (!sub || read('sessionStorage', ATTEMPTED_KEY + sub) === '1') return false;
  write('sessionStorage', ATTEMPTED_KEY + sub, '1');
  return true;
}

// A native modal makes the whole document inert synchronously, including the
// currently focused composer. Keep it across menu remounts and queued reloads.
async function landInOrganization(targetId, switchOrg) {
  const dialog = document.createElement('dialog');
  const label = sharedTranslator('shell')('userMenu.changingOrg');
  dialog.textContent = label;
  dialog.setAttribute('aria-label', label);
  dialog.className = 'm-auto rounded-lg p-4';
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  document.body.append(dialog);
  const release = () => {
    dialog.close();
    dialog.remove();
    window.removeEventListener('pagehide', release);
  };
  let reloading = false;
  try {
    dialog.showModal();
    window.addEventListener('pagehide', release);
    const result = await switchOrg(targetId);
    reloading = result?.reloadRequired === true && result.reloadQueued !== false;
  } finally {
    if (!reloading) release();
  }
}

/**
 * Remembers the company organization in use and, once the list is in, moves
 * a person who sits in their personal organization to a company one.
 *
 * @param {{ sub: string | null, orgs: object[], activeOrg: object | null, switchOrg: (id: string) => Promise<unknown> }} args
 */
export function useOrgLanding({ sub, orgs, activeOrg, switchOrg }) {
  const activeOrgId = activeOrg?.id ?? null;
  useEffect(() => {
    if (!PLATFORM_UI || !sub || !orgs?.length) return;
    if (activeOrg && !activeOrg.isPersonal) {
      rememberLastOrg(sub, activeOrg.id);
      return;
    }
    const target = landingSwitchTarget(orgs, { activeOrgId, lastOrgId: readLastOrgId(sub) });
    // The list can arrive late (its read retries for up to 40 s), and the
    // switch reloads into the other organization: a task already started here
    // would vanish from view and a draft would be cleared. Stay put, without
    // claiming the attempt, so the next load lands instead.
    if (!target || hasWorkStarted() || !claimLandingAttempt(sub)) return;
    void landInOrganization(target.id, switchOrg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, orgs, activeOrgId]);
}
