/*
 * Which organization a person lands in on cloud (ENG-3787). Someone who
 * belongs to a company organization should start there rather than in their
 * personal one: the company org they used last, else the first one listed.
 *
 * Never against a choice: once the person picks an organization in this
 * session (personal included), landing leaves it alone, and it tries at most
 * once per session so a refused switch can't loop through reloads.
 */

import { useEffect } from 'react';
import { PLATFORM_UI } from '../../lib/deployment';

/**
 * The organization to land in, or null when there is no company organization.
 *
 * @param {Array<{ id: string, isPersonal?: boolean }>} orgs In listing order.
 * @param {{ lastUsedOrgId?: string | null, personalOrgId?: string | null }} options
 */
export function pickLandingOrg(orgs, { lastUsedOrgId = null, personalOrgId = null } = {}) {
  const company = (orgs || []).filter((org) => org && !org.isPersonal && org.id !== personalOrgId);
  if (company.length === 0) return null;
  return company.find((org) => org.id === lastUsedOrgId) ?? company[0];
}

/**
 * The organization to switch to now, or null to stay. Only a personal (or
 * unknown) active organization is moved, and never after a choice this
 * session.
 */
export function landingSwitchTarget(orgs, {
  activeOrgId = null,
  lastUsedOrgId = null,
  personalOrgId = null,
  explicitChoice = false,
} = {}) {
  if (explicitChoice || !Array.isArray(orgs) || orgs.length === 0) return null;
  const active = orgs.find((org) => org.id === activeOrgId);
  const activeIsPersonal = !active || active.isPersonal || active.id === personalOrgId;
  if (!activeIsPersonal) return null;
  const target = pickLandingOrg(orgs, { lastUsedOrgId, personalOrgId });
  return target && target.id !== activeOrgId ? target : null;
}

// ── What this browser remembers ──────────────────────────────────────
// Keyed by the account, so a shared machine never moves one person into
// another's organization. Storage can be missing or throw; landing then
// falls back to the first company organization.

const LAST_USED_KEY = 'anton.lastCompanyOrg:';
const CHOSEN_KEY = 'anton.orgChosenThisSession:';
const ATTEMPTED_KEY = 'anton.orgLandingTried:';

function read(store, key) {
  try { return globalThis[store]?.getItem(key) ?? null; } catch { return null; }
}

function write(store, key, value) {
  try { globalThis[store]?.setItem(key, value); } catch { /* best effort */ }
}

export function readLastUsedOrgId(sub) {
  return sub ? read('localStorage', LAST_USED_KEY + sub) : null;
}

export function rememberOrgUse(sub, org) {
  if (sub && org?.id && !org.isPersonal) write('localStorage', LAST_USED_KEY + sub, org.id);
}

/** The person picked an organization themselves in this session. */
export function markExplicitOrgChoice(sub) {
  if (sub) write('sessionStorage', CHOSEN_KEY + sub, '1');
}

export function hasExplicitOrgChoice(sub) {
  return !!sub && read('sessionStorage', CHOSEN_KEY + sub) === '1';
}

function claimLandingAttempt(sub) {
  if (!sub || read('sessionStorage', ATTEMPTED_KEY + sub) === '1') return false;
  write('sessionStorage', ATTEMPTED_KEY + sub, '1');
  return true;
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
      rememberOrgUse(sub, activeOrg);
      return;
    }
    const target = landingSwitchTarget(orgs, {
      activeOrgId,
      lastUsedOrgId: readLastUsedOrgId(sub),
      explicitChoice: hasExplicitOrgChoice(sub),
    });
    if (!target || !claimLandingAttempt(sub)) return;
    switchOrg(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub, orgs, activeOrgId]);
}
