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

export const ORG_ADMIN_ONLY_HINT = 'Only admins can share with the whole organization';

/* A skill shared with teams or the whole org is recalled when it's relevant
   to a task. Someone allowed to may make it "always on": part of every task
   for everyone it reaches. The server enforces who may; these mirror it. */
export const SHARING_NOTE = 'Anton uses a shared skill when it\'s relevant to the task, unless it\'s set to always on.';
export const ALWAYS_ON_LABEL = 'Always include in every task';
export const ALWAYS_ON_HELP = "Off: Anton uses it when it's relevant. On: it's part of every task for everyone it's shared with.";
export const ALWAYS_ON_ORG_ADMIN_HINT = 'Only admins can make an organization-wide skill always on';
export const ALWAYS_ON_EDITOR_HINT = 'Only people who can edit this skill can change this';
export const ALWAYS_ON_BADGE = 'Always on';
export const ALWAYS_ON_BADGE_HINT = "Part of every task for everyone it's shared with";

/** "Everyone at Kinaxis", or a generic label when the org has no name. */
export function everyoneAtLabel(orgName) {
  return orgName ? `Everyone at ${orgName}` : 'Everyone in your organization';
}

/** The org's name for running text, or "your organization". */
export function orgNameOrGeneric(orgName) {
  return orgName || 'your organization';
}

/** "People in Kinaxis" / "People in your organization". */
export function peopleInLabel(orgName) {
  return `People in ${orgNameOrGeneric(orgName)}`;
}

/** "People outside Kinaxis" / "People outside your organization". */
export function peopleOutsideLabel(orgName) {
  return `People outside ${orgNameOrGeneric(orgName)}`;
}

/** The domain of an email address, lowercased, or '' without one. */
export function emailDomain(email) {
  const text = String(email ?? '').trim().toLowerCase();
  const at = text.lastIndexOf('@');
  return at > 0 ? text.slice(at + 1) : '';
}

/**
 * Splits an artifact's existing `allowed_emails` between the "People in
 * ‹org›" and "People outside ‹org›" boxes of the Share panel.
 *
 * The access record keeps one flat email list, so which box an address was
 * added from is lost. Asking the hub about each address would cost a search
 * per email, so this guesses instead: an address on the signed-in person's
 * own email domain shows under "People in ‹org›", anything else (and
 * everything, when the person's email is unknown) under "People outside
 * ‹org›". It only decides where a chip is displayed; both boxes are sent
 * together as `allowed_emails`, so access is the same either way.
 */
export function splitEmailsByOrgDomain(emails, userEmail) {
  const domain = emailDomain(userEmail);
  const inside = [];
  const outside = [];
  for (const email of emails || []) {
    (domain && emailDomain(email) === domain ? inside : outside).push(email);
  }
  return { inside, outside };
}

/* Every org has a default team everyone is in ("All members"). The server
   maps it to org-wide, so sharing never lists it as a team: "Everyone at
   ‹org›" is that choice, and an audience naming it reads as org-wide. */

/** Whether a team (as fetchHubTeams returns it) is the org's default team. */
export function isDefaultTeam(team) {
  return team?.is_default === true || team?.isDefault === true;
}

/** The teams to offer when sharing: all but the default team. */
export function shareableTeams(teams) {
  return (teams || []).filter((team) => !isDefaultTeam(team));
}

/** Ids of the default team(s) among `teams`. */
export function defaultTeamIds(teams) {
  return (teams || []).filter(isDefaultTeam).map((team) => team.id);
}

/** Whether `teamIds` names the org's default team. */
export function namesDefaultTeam(teamIds, teams) {
  const ids = defaultTeamIds(teams);
  return ids.length > 0 && (teamIds || []).some((id) => ids.includes(id));
}

/** `teamIds` without the default team. */
export function withoutDefaultTeam(teamIds, teams) {
  const ids = defaultTeamIds(teams);
  return (teamIds || []).filter((id) => !ids.includes(id));
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
}

/** A skill's audience in one shape: `{ org, teamIds, emails, alwaysOn }`. */
export function skillAudience(skill) {
  const sharing = skill?.sharing;
  if (!sharing || typeof sharing !== 'object') return { org: false, teamIds: [], emails: [], alwaysOn: false };
  const audience = {
    org: sharing.org === true,
    teamIds: stringList(sharing.team_ids ?? sharing.teamIds),
    emails: stringList(sharing.emails),
    alwaysOn: (sharing.alwaysOn ?? sharing.always_on) === true,
  };
  if (!canBeAlwaysOn(audience)) audience.alwaysOn = false;
  return audience;
}

/** Always on needs the whole org or at least one team. */
export function canBeAlwaysOn(audience) {
  return audience.org === true || audience.teamIds.length > 0;
}

/** Whether a skill is part of every task for everyone it reaches. */
export function isSkillAlwaysOn(skill) {
  return skillAudience(skill).alwaysOn;
}

/**
 * Why the caller can't change "always on" for this audience, or null when
 * they can. Org-wide needs `can_share_org`; teams only need edit rights.
 */
export function alwaysOnLockReason(audience, { canShareOrg = false, canEdit = false } = {}) {
  if (audience.org) return canShareOrg ? null : ALWAYS_ON_ORG_ADMIN_HINT;
  if (audience.teamIds.length > 0) return canEdit ? null : ALWAYS_ON_EDITOR_HINT;
  return null;
}

/** Only me: nobody else is named. */
export function isPrivateAudience(audience) {
  return !audience.org && audience.teamIds.length === 0 && audience.emails.length === 0;
}

/** The body `PUT /skills/{slug}/sharing` takes. */
export function audiencePayload(audience) {
  return {
    org: audience.org === true,
    team_ids: [...audience.teamIds],
    emails: [...audience.emails],
    always_on: audience.alwaysOn === true && canBeAlwaysOn(audience),
  };
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
  // The default team is everyone at the org.
  if (audience.org || namesDefaultTeam(audience.teamIds, teams)) return everyoneAtLabel(orgName);
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
 * @returns {Array<{ id: string, title: string, skills: object[] }>}
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
    skills: buckets[id],
  }));
  groups.push({ id: 'builtin', title: 'Built-in', skills: buckets.builtin });
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
