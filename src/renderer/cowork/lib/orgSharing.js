/*
 * Sharing skills and artifacts inside a hosted org (ENG-3787): with specific
 * people, with teams, or with everyone at the org. cowork-server decides who
 * may do what and reports it in `/skills/sharing-capabilities`; these helpers
 * only read the shapes it sends and decide what to show.
 *
 * Skills and artifacts name their audience the same way: everyone in the
 * org is `org_allowed`, teams are `allowed_team_ids`, people in the org are
 * `allowed_user_ids` (hub user ids), and, for artifacts only, people outside
 * the org are `allowed_emails`. Skills add `always_on`. A skill arrives
 * serialized camelCase (`access.orgAllowed`, `canEdit`).
 */

import { canUseSharedResource } from './sharedResourceAccess';

/** What org sharing allows on a build without it, and until the server says:
    nothing, so every sharing surface stays hidden. */
export const SHARING_OFF = Object.freeze({ enabled: false, can_share_org: false, can_write_org: false, org_name: null });

/** "1 person", "3 people". */
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const SKILL_SECTIONS = ['mine', 'shared_with_me', 'team', 'org'];

export const ORG_ADMIN_ONLY_HINT = 'Only admins can share with the whole organization';

/* A skill shared with teams or the whole org is recalled when it's relevant
   to a task. Someone allowed to may make it "always on": part of every task
   for everyone it reaches. The server enforces who may; these mirror it. */
export const ALWAYS_ON_LABEL = 'Always include in every task';
/** What "always on" does for a skill (`name`), on or off: the switch's help
    line, and the toast once a save changes only it. */
export const alwaysOnHelp = (on, name = 'this skill') => (on
  ? `Anton will include ${name} in every task.`
  : `Anton will use ${name} only when it's relevant.`);
export const ALWAYS_ON_ORG_ADMIN_HINT = 'Only admins can make an organization-wide skill always on';
export const ALWAYS_ON_EDITOR_HINT = 'Only people who can edit this skill can change this';
export const ALWAYS_ON_BADGE = 'Always on';
export const ALWAYS_ON_BADGE_HINT = "Part of every task for everyone it's shared with";

/** "Everyone at Acme", or a generic label when the org has no name. */
export function everyoneAtLabel(orgName) {
  return orgName ? `Everyone at ${orgName}` : 'Everyone in your organization';
}

/** The second line under "Everyone at ‹org›", wherever it shows. */
export const EVERYONE_AT_DESC = 'Anyone in your organization';

/** The org's name for running text, or "your organization". */
export function orgNameOrGeneric(orgName) {
  return orgName || 'your organization';
}

/** The primary line of a person the hub doesn't know. */
export const UNKNOWN_PERSON = 'Unknown person';

/* Every org has a default team everyone is in ("All members"). The server
   maps it to org-wide, so sharing never lists it as a team: "Everyone at
   ‹org›" is that choice, and an audience naming it reads as org-wide. */

/** Whether a team (as fetchHubTeams returns it) is the org's default team. */
export function isDefaultTeam(team) {
  return team?.is_default === true;
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

/** Text folded for a local search: lower case, accents dropped
    ("López" finds "lopez" and the other way round). */
export function foldForSearch(text) {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Whether any of `fields` contains `query`, folded (an empty query matches). */
export function matchesQuery(query, ...fields) {
  const q = foldForSearch(query);
  if (!q) return true;
  return fields.some((field) => foldForSearch(field).includes(q));
}

/**
 * The teams whose name matches `query` (case- and accent-insensitive
 * substring). An empty query returns every team. Ids in `keepIds` stay listed
 * whatever the query.
 */
export function filterTeams(teams, query, keepIds = []) {
  if (!foldForSearch(query)) return teams;
  return teams.filter((team) => keepIds.includes(team.id) || matchesQuery(query, team.display_name));
}

/** The people whose name or email matches `query`, folded. */
export function filterPeople(people, query) {
  if (!foldForSearch(query)) return people;
  return people.filter((person) => matchesQuery(query, person.name, person.email));
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

/**
 * The line under a recipient field: "2 teams · 1 person · 1 outside Acme",
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
    orgAllowed: access.orgAllowed === true,
    allowedTeamIds: stringList(access.allowedTeamIds),
    allowedUserIds: stringList(access.allowedUserIds),
    alwaysOn: access.alwaysOn === true,
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

/** Whether the caller may switch "always on" for a skill as it is shared
    now: one they can edit, that the org or a team reaches, and only where
    `alwaysOnLockReason` lets them (`canShareOrg` for org-wide). A member of
    one of its teams may, though only the owner or an admin changes who it
    reaches (`canChangeSkillAudience`). Never a built-in. */
export function canChangeSkillAlwaysOn(skill, { canShareOrg = false } = {}) {
  if (skill?.isBuiltin || !canEditSkill(skill)) return false;
  const access = skillAccess(skill);
  return canBeAlwaysOn(access) && alwaysOnLockReason(access, { canShareOrg, canEdit: true }) === null;
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

/** Whether two `PUT /skills/{slug}/sharing` bodies let the same org, teams
    and people use the skill, whatever order the ids come in. */
export function sameSkillAudience(a, b) {
  const ids = (list) => [...list].sort().join(',');
  return a.org_allowed === b.org_allowed
    && ids(a.allowed_team_ids) === ids(b.allowed_team_ids)
    && ids(a.allowed_user_ids) === ids(b.allowed_user_ids);
}

/** Whether two `PUT /skills/{slug}/sharing` bodies are the same: the same
    audience and the same `always_on`. */
export function sameSkillAccessPayload(a, b) {
  return sameSkillAudience(a, b) && a.always_on === b.always_on;
}

/** Which section of the Skills page a skill sits in. A skill without one (an
    older server) is the caller's own. */
export function skillSection(skill) {
  const section = skill?.section;
  return SKILL_SECTIONS.includes(section) ? section : 'mine';
}

/** Whether the caller may change the skill: the server's `canEdit` when it
    sends one, else the older capabilities check. */
export function canEditSkill(skill) {
  const flag = skill?.canEdit;
  if (typeof flag === 'boolean') return flag;
  return canUseSharedResource(skill, 'canEdit');
}

/** Who may change who can use a skill, for the Share dropdown and the Edit
    dialog alike: its owner or an admin, which the server already folds into
    the skill's own `capabilities.canShare`. Never a built-in. */
export function canChangeSkillAudience(skill) {
  if (skill?.isBuiltin || !canEditSkill(skill)) return false;
  return skill?.capabilities?.canShare !== false;
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

/* Sections follow who a skill reaches, the caller's own included (the
   server's `section`): org-wide, else a team, else "Yours" (the caller's own,
   shared with nobody or only with people), else "Shared with me". */
const SECTION_TITLES = {
  mine: () => 'Yours',
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

/** Whether an artifact's access lets the whole org in (`org_allowed`). */
export function accessOrgAllowed(access) {
  return !!firstDefined(access?.org_allowed, access?.orgAllowed);
}

/* ── "Share" or "Shared" (ENG-3787) ─────────────────────────────────────
   A Share button reads "Shared" once something reaches anyone besides its
   owner, with an icon for how and a tooltip saying who. */

/** "2 teams and 3 people", "1 team, 2 people and 1 outside email"; null for none. */
export function audienceCountsPhrase({ teams = 0, people = 0, outside = 0 } = {}) {
  const parts = [];
  if (teams) parts.push(plural(teams, 'team', 'teams'));
  if (people) parts.push(plural(people, 'person', 'people'));
  if (outside) parts.push(plural(outside, 'outside email', 'outside emails'));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Shared with everyone at Acme" / "… in your organization". */
export function sharedWithEveryoneHint(orgName) {
  return orgName ? `Shared with everyone at ${orgName}` : 'Shared with everyone in your organization';
}

/**
 * Whether a skill is shared and how, for its Share button:
 * `{ shared, kind: 'private' | 'org' | 'specific', hint }`. The default team
 * reads as the whole org.
 */
export function skillShareState(skill, { teams = [], orgName = null } = {}) {
  const access = skillAccess(skill);
  if (access.orgAllowed || namesDefaultTeam(access.allowedTeamIds, teams)) {
    return { shared: true, kind: 'org', hint: sharedWithEveryoneHint(orgName) };
  }
  const phrase = audienceCountsPhrase({
    teams: withoutDefaultTeam(access.allowedTeamIds, teams).length,
    people: access.allowedUserIds.length,
  });
  if (!phrase) return { shared: false, kind: 'private', hint: 'Only you can use it' };
  return { shared: true, kind: 'specific', hint: `Shared with ${phrase}` };
}

/**
 * The same for a published artifact (its publish controller or artifact):
 * `kind` 'private' | 'public' | 'password' | 'org' | 'specific'.
 */
export function artifactShareState(artifact, { orgSharing = false, orgName = null, teams = [] } = {}) {
  if (!artifact?.publishedUrl) return { shared: false, kind: 'private', hint: 'Not shared yet' };
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : 'public');
  if (mode === 'public') return { shared: true, kind: 'public', hint: 'Public link: anyone with the URL can open it' };
  if (mode === 'password') return { shared: true, kind: 'password', hint: 'Password protected' };
  const teamIds = artifact.allowedTeamIds || [];
  const userIds = artifact.allowedUserIds || [];
  const emails = artifact.accessEmails || [];
  const ownerOnly = artifact.ownerOnly != null
    ? !!artifact.ownerOnly
    : (!artifact.orgAllowed && teamIds.length + userIds.length + emails.length === 0);
  if (ownerOnly) return { shared: false, kind: 'private', hint: 'Only you can open it' };
  if (orgSharing && (artifact.orgAllowed || namesDefaultTeam(teamIds, teams))) {
    return { shared: true, kind: 'org', hint: sharedWithEveryoneHint(orgName) };
  }
  const phrase = orgSharing
    ? audienceCountsPhrase({ teams: withoutDefaultTeam(teamIds, teams).length, people: userIds.length, outside: emails.length })
    : audienceCountsPhrase({ people: emails.length });
  return { shared: true, kind: 'specific', hint: phrase ? `Shared with ${phrase}` : 'Shared' };
}
