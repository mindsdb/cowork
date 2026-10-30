/*
 * Sharing skills and artifacts inside a hosted org (ENG-3787): with specific
 * people, with teams, or with everyone at the org. cowork-server decides who
 * may do what and reports it in `/skills/sharing-capabilities`; these helpers
 * only read the shapes it sends and decide what to show.
 *
 * Skills and artifacts name their audience the same way: everyone in the
 * org is `org_allowed`, teams are `allowed_team_ids`, people in the org are
 * `allowed_user_ids` (hub user ids), and, for artifacts only, people outside
 * the org are `allowed_emails`. Skills add `always_on`. The server may send
 * any of them snake_case or camelCase, so each reader accepts both.
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

/** Chip text for a person picked from the org: "Name (email)", the email
    alone, "Loading…" while their name is being looked up, or
    "Unknown person" for an id the hub doesn't know. */
export const UNKNOWN_PERSON = 'Unknown person';

export function personLabel(person) {
  if (!person) return UNKNOWN_PERSON;
  if (person.email) return person.name ? `${person.name} (${person.email})` : person.email;
  if (person.pending) return 'Loading…';
  return person.name || UNKNOWN_PERSON;
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

/**
 * The teams whose name matches `query` (case-insensitive substring). An empty
 * query returns every team. Ids in `keepIds` stay listed whatever the query.
 */
export function filterTeams(teams, query, keepIds = []) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return teams;
  return teams.filter((team) => keepIds.includes(team.id)
    || (team.display_name || '').toLowerCase().includes(q));
}

/** Up to two initials for a person's avatar: from the name, else the email. */
export function personInitials(person) {
  const name = (person?.name || '').trim();
  if (name) {
    const words = name.split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
    return letters.toUpperCase();
  }
  const email = (person?.email || '').trim();
  return email ? email[0].toUpperCase() : '?';
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The line under a recipient field: "2 teams · 1 person · 1 outside Kinaxis",
 * zero parts left out. `emailsOnly` (no org) counts addresses as people.
 */
export function recipientSummary({ teamIds = [], userIds = [], emails = [] } = {}, { orgName = null, emailsOnly = false, allowExternal = true } = {}) {
  if (emailsOnly) {
    return emails.length ? plural(emails.length, 'person', 'people') : 'Add at least one email.';
  }
  const parts = [];
  if (teamIds.length) parts.push(plural(teamIds.length, 'team', 'teams'));
  if (userIds.length) parts.push(plural(userIds.length, 'person', 'people'));
  if (emails.length) parts.push(`${emails.length} outside ${orgNameOrGeneric(orgName)}`);
  if (parts.length) return parts.join(' · ');
  return allowExternal ? 'Add at least one team, person or email.' : 'Add at least one team or person.';
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/** The audience of a skill shared with nobody. */
export const PRIVATE_ACCESS = Object.freeze({ orgAllowed: false, allowedTeamIds: [], allowedUserIds: [], alwaysOn: false });

/** A skill's `access` in one shape:
    `{ orgAllowed, allowedTeamIds, allowedUserIds, alwaysOn }`. */
export function skillAccess(skill) {
  const access = skill?.access;
  if (!access || typeof access !== 'object') return { ...PRIVATE_ACCESS, allowedTeamIds: [], allowedUserIds: [] };
  const out = {
    orgAllowed: firstDefined(access.orgAllowed, access.org_allowed) === true,
    allowedTeamIds: stringList(firstDefined(access.allowedTeamIds, access.allowed_team_ids)),
    allowedUserIds: stringList(firstDefined(access.allowedUserIds, access.allowed_user_ids)),
    alwaysOn: firstDefined(access.alwaysOn, access.always_on) === true,
  };
  if (!canBeAlwaysOn(out)) out.alwaysOn = false;
  return out;
}

/** Always on needs the whole org or at least one team. */
export function canBeAlwaysOn(access) {
  return access.orgAllowed === true || access.allowedTeamIds.length > 0;
}

/** Whether a skill is part of every task for everyone it reaches. */
export function isSkillAlwaysOn(skill) {
  return skillAccess(skill).alwaysOn;
}

/**
 * Why the caller can't change "always on" for this audience, or null when
 * they can. Org-wide needs `can_share_org`; teams only need edit rights.
 */
export function alwaysOnLockReason(access, { canShareOrg = false, canEdit = false } = {}) {
  if (access.orgAllowed) return canShareOrg ? null : ALWAYS_ON_ORG_ADMIN_HINT;
  if (access.allowedTeamIds.length > 0) return canEdit ? null : ALWAYS_ON_EDITOR_HINT;
  return null;
}

/** Only me: nobody else is named. */
export function isPrivateAccess(access) {
  return !access.orgAllowed && access.allowedTeamIds.length === 0 && access.allowedUserIds.length === 0;
}

/** The body `PUT /skills/{slug}/sharing` takes. */
export function skillAccessPayload(access) {
  return {
    org_allowed: access.orgAllowed === true,
    allowed_team_ids: [...access.allowedTeamIds],
    allowed_user_ids: [...access.allowedUserIds],
    always_on: access.alwaysOn === true && canBeAlwaysOn(access),
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
  const access = skillAccess(skill);
  // The default team is everyone at the org.
  if (access.orgAllowed || namesDefaultTeam(access.allowedTeamIds, teams)) return everyoneAtLabel(orgName);
  const parts = [];
  const teamIds = access.allowedTeamIds;
  if (teamIds.length === 1) {
    const team = teams.find((t) => t.id === teamIds[0]);
    parts.push(team ? `Team: ${team.display_name}` : '1 team');
  } else if (teamIds.length > 1) {
    parts.push(`${teamIds.length} teams`);
  }
  const people = access.allowedUserIds.length;
  if (people) parts.push(people === 1 ? '1 person' : `${people} people`);
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

/* Artifact access, as a publish answer or the access route reports it. */

/** Team ids an artifact's access names (`allowed_team_ids`). */
export function accessAllowedTeamIds(access) {
  return stringList(firstDefined(access?.allowed_team_ids, access?.allowedTeamIds));
}

/** User ids of the people in the org an artifact's access names
    (`allowed_user_ids`). */
export function accessAllowedUserIds(access) {
  return stringList(firstDefined(access?.allowed_user_ids, access?.allowedUserIds));
}

/** Whether an artifact's access lets the whole org in (`org_allowed`; older
    answers also said `org_wide`). */
export function accessOrgAllowed(access) {
  return !!firstDefined(access?.org_allowed, access?.orgAllowed, access?.org_wide, access?.orgWide);
}
