/*
 * Sharing skills and artifacts inside a hosted org (ENG-3787): with specific
 * people, with teams, or with everyone at the org. cowork-server decides who
 * may do what and reports it in `/skills/sharing-capabilities`; these helpers
 * only read the shapes it sends and decide what to show.
 *
 * The server's new fields are snake_case (`team_ids`, `can_edit`,
 * `allowed_team_ids`, `org_wide`) while older fields arrive camelCase, so each
 * reader accepts both spellings.
 */

import { isEmailShaped } from './emailAddress';
import { canUseSharedResource } from './sharedResourceAccess';

export const SKILL_SECTIONS = ['mine', 'shared_with_me', 'team', 'org'];

/* Team and org-wide skills are applied to every task by the server, so the
   people they reach can't turn them off. */
export const ALWAYS_APPLIED_HINT = 'Applied to every task';
export const ALWAYS_APPLIED_NOTE = "Skills shared with a team or the whole organization are applied to everyone's tasks automatically.";
export const ORG_ADMIN_ONLY_HINT = 'Only admins can share with the whole organization';

/** "Everyone at Kinaxis", or a generic label when the org has no name. */
export function everyoneAtLabel(orgName) {
  return orgName ? `Everyone at ${orgName}` : 'Everyone in your organization';
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
}

/** A skill's audience in one shape: `{ org, teamIds, emails }`. */
export function skillAudience(skill) {
  const sharing = skill?.sharing;
  if (!sharing || typeof sharing !== 'object') return { org: false, teamIds: [], emails: [] };
  return {
    org: sharing.org === true,
    teamIds: stringList(sharing.team_ids ?? sharing.teamIds),
    emails: stringList(sharing.emails),
  };
}

/** Only me: nobody else is named. */
export function isPrivateAudience(audience) {
  return !audience.org && audience.teamIds.length === 0 && audience.emails.length === 0;
}

/** The body `PUT /skills/{slug}/sharing` takes. */
export function audiencePayload(audience) {
  return { org: audience.org === true, team_ids: [...audience.teamIds], emails: [...audience.emails] };
}

/** Which section of the Skills page a skill sits in. A skill without one (an
    older server) is the caller's own. */
export function skillSection(skill) {
  const section = skill?.section;
  return SKILL_SECTIONS.includes(section) ? section : 'mine';
}

/** Whether the caller may change the skill: the server's `can_edit` when it
    sends one, else the older capabilities check. */
export function canEditSkill(skill) {
  const flag = skill?.can_edit ?? skill?.canEdit;
  if (typeof flag === 'boolean') return flag;
  return canUseSharedResource(skill, 'canEdit');
}

/** The owner's email, or null when the server didn't name them. */
export function skillOwnerEmail(skill) {
  const email = skill?.owner?.email;
  return typeof email === 'string' && email.trim() ? email.trim() : null;
}

/**
 * The small badge on a skill row. Null for Only me.
 *
 * @param {object} skill
 * @param {{ teams?: Array<{ id: string, display_name: string }>, orgName?: string | null }} context
 */
export function skillAudienceBadge(skill, { teams = [], orgName = null } = {}) {
  const audience = skillAudience(skill);
  if (audience.org) return everyoneAtLabel(orgName);
  const parts = [];
  if (audience.teamIds.length === 1) {
    const team = teams.find((t) => t.id === audience.teamIds[0]);
    parts.push(team ? `Team: ${team.display_name}` : '1 team');
  } else if (audience.teamIds.length > 1) {
    parts.push(`${audience.teamIds.length} teams`);
  }
  if (audience.emails.length) {
    parts.push(audience.emails.length === 1 ? '1 person' : `${audience.emails.length} people`);
  }
  return parts.length ? parts.join(' · ') : null;
}

const SECTION_TITLES = {
  mine: () => 'Only me',
  shared_with_me: () => 'Shared with me',
  team: () => 'My teams',
  org: (orgName) => everyoneAtLabel(orgName),
};

/**
 * The Skills page's groups, in page order, empty ones left out. Built-ins
 * carry no audience, so they keep a group of their own at the end.
 *
 * @returns {Array<{ id: string, title: string, hint: string | null, skills: object[] }>}
 */
export function groupSkillsBySection(skills, { orgName = null } = {}) {
  const buckets = { mine: [], shared_with_me: [], team: [], org: [], builtin: [] };
  for (const skill of skills || []) {
    if (skill?.isBuiltin) buckets.builtin.push(skill);
    else buckets[skillSection(skill)].push(skill);
  }
  const groups = SKILL_SECTIONS.map((id) => ({
    id,
    title: SECTION_TITLES[id](orgName),
    hint: id === 'team' || id === 'org' ? ALWAYS_APPLIED_HINT : null,
    skills: buckets[id],
  }));
  groups.push({ id: 'builtin', title: 'Built-in', hint: null, skills: buckets.builtin });
  return groups.filter((group) => group.skills.length > 0);
}

/**
 * Splits typed text into addresses: valid ones (lowercased, deduped against
 * `existing`) and the ones that aren't an email.
 */
export function parseEmailInput(text, existing = []) {
  const seen = new Set(existing.map((e) => e.toLowerCase()));
  const valid = [];
  const invalid = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!isEmailShaped(email)) { invalid.push(raw.trim()); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid };
}

/* Artifact access: the server sends `allowed_team_ids` and `org_wide` beside
   the older camelCase fields. */

/** Team ids an artifact's access names. */
export function accessTeamIds(access) {
  return stringList(access?.allowed_team_ids ?? access?.allowedTeamIds ?? access?.accessTeamIds);
}

/** Whether an artifact's access lets the whole org in. */
export function accessOrgWide(access) {
  return !!(access?.org_wide ?? access?.orgWide ?? access?.orgAllowed ?? access?.org_allowed);
}
