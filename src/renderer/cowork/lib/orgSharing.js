/*
 * Sharing skills and artifacts inside an org in MindsHub mode: with specific
 * people, with teams, or with everyone at the org. cowork-server decides who
 * may do what and reports it in `/skills/sharing-capabilities`; these helpers
 * only read the shapes it sends and decide what to show.
 *
 * Skills and artifacts name their audience the same way: everyone in the
 * org, teams, people in the org (MindsHub user ids), and, for artifacts only,
 * people outside the org by email. Skills add "always on". The field names
 * and their readers and builders live in lib/sharingContract.
 */

import { isIdOrganizationName, organizationLabel } from '../../../shared/minds-orgs';
import { canUseSharedResource } from './sharedResourceAccess';
import {
  MINDSHUB_ERROR_CODE,
  readArtifactAudience,
  readAudienceAnswer,
  readAudienceRequest,
  skillAccessRequest,
} from './sharingContract';
import i18n from '../../lib/i18n';

/** Sharing copy in the reader's language, read when it is shown. */
const tr = (key, vars) => i18n.t(`messages.orgSharing.${key}`, { ns: 'projects', ...vars });

/** What sharing allows on a build without it, and until the server says:
    nothing, so every sharing surface stays hidden. Nothing about it is
    unknown, so no surface says MindsHub couldn't be reached. */
export const SHARING_OFF = Object.freeze({
  enabled: false,
  canShareSkillsOrg: false,
  canWriteSkillsOrg: false,
  canShareArtifactsOrg: false,
  permissionsKnown: true,
  teamsKnown: true,
});

/** Whether sharing inside the org is on, from a capabilities answer. */
export function isOrgSharingOn(capabilities) {
  return capabilities?.enabled === true;
}

/**
 * The name sharing copy gives the active organization ("Everyone at Acme"),
 * from where the account menu reads it: the app's own organization list
 * (useMindsOrgs' `activeOrg`, organizationLabel), else the access token's
 * organization claim (useAccountUser's `org`). The list is read only where
 * organization switching is on; the claim is there whenever MindsHub signed
 * the viewer in, and carries the organization's Keycloak name, which can
 * differ from its display name. Null when neither names an organization, for
 * a personal one, whose label ("Personal") names nobody to share with, and
 * for a claim whose Keycloak name is an id (isIdOrganizationName: an
 * organization MindsHub's staff created, `staff-org-<uuid>`, or someone's
 * personal organization, `personal_<uuid>`): the copy then says "the
 * organization".
 */
export function sharingOrgName(activeOrg, accountUser = null) {
  if (activeOrg) return activeOrg.isPersonal ? null : organizationLabel(activeOrg);
  if (!accountUser || accountUser.orgIsPersonal || isIdOrganizationName(accountUser.org)) return null;
  return accountUser.org || null;
}

/** Whether cowork-server couldn't ask MindsHub for the caller's permissions,
    so the capabilities' "no" means "couldn't ask". */
export function permissionsUnknown(capabilities) {
  return capabilities?.permissionsKnown === false;
}

/** Whether cowork-server couldn't ask MindsHub for the caller's teams. */
export function teamsUnknown(capabilities) {
  return capabilities?.teamsKnown === false;
}

/** "1 person", "3 people": `what` is teams, people or outsideEmails. */
const plural = (count, what) => tr(`counts.${what}`, { count });

export const SKILL_SECTIONS = ['mine', 'shared_with_me', 'team', 'org'];

export const ORG_ADMIN_ONLY_HINT = 'Only admins can share with everyone in the organization';
export const orgAdminOnlyHint = () => tr('orgAdminOnlyHint');

/** Every built-in role may share an artifact with everyone; only a custom role
    that withholds `artifacts.share_org` locks it, so the lock names no role. */
export const ORG_ARTIFACT_SHARE_WITHHELD_HINT = "Your role can't share with everyone in the organization";
export const orgArtifactShareWithheldHint = () => tr('orgArtifactShareWithheldHint');

/** The lock on a control MindsHub has to allow, while it couldn't be asked. */
export const MINDSHUB_UNREACHABLE_HINT = "Couldn't reach MindsHub";
export const mindsHubUnreachableHint = () => tr('mindsHubUnreachableHint');

/** The page-level line for the same, with Retry beside it. */
export const MINDSHUB_UNREACHABLE_PERMISSIONS = "Couldn't reach MindsHub to check what you can share.";
export const mindsHubUnreachablePermissions = () => tr('mindsHubUnreachablePermissions');

/** The detail note on a skill shared with everyone that the caller can't
    change while their permissions couldn't be read. */
export const MINDSHUB_UNREACHABLE_EDIT = "Couldn't reach MindsHub to check whether you can change it.";
export const mindsHubUnreachableEdit = () => tr('mindsHubUnreachableEdit');

/** The Skills page's line while the caller's teams couldn't be read: the
    skills shared with their teams are left out until they can. */
export const MINDSHUB_UNREACHABLE_TEAMS = "Couldn't reach MindsHub to load your teams, so skills shared with them aren't listed.";
export const mindsHubUnreachableTeams = () => tr('mindsHubUnreachableTeams');

/** A MindsHub read's line while MindsHub limits how often the caller asks. */
export const MINDSHUB_THROTTLED = 'MindsHub is limiting requests. Try again in a minute.';
export const mindsHubThrottled = () => tr('mindsHubThrottled');

/**
 * What a surface says about a MindsHub read that got no answer, by why
 * (`failure`, a MINDSHUB_ERROR_CODE): its own sentence for an outage
 * (`unreachable`, also for no `failure` at all) and for a refusal
 * (`refused`), and MINDSHUB_THROTTLED for a throttle unless it passes its
 * own (`throttled`).
 *
 * @param {import('./sharingContract').MindsHubFailure | null | undefined} failure
 * @param {{ unreachable: string, refused: string, throttled?: string }} copy
 */
export function mindsHubFailureText(failure, { unreachable, refused, throttled = mindsHubThrottled() }) {
  if (failure === MINDSHUB_ERROR_CODE.THROTTLED) return throttled;
  if (failure === MINDSHUB_ERROR_CODE.REFUSED) return refused;
  return unreachable;
}

/** Whether asking MindsHub again can help: not after a refusal, which it
    gives again. */
export function mindsHubRetryHelps(failure) {
  return failure !== MINDSHUB_ERROR_CODE.REFUSED;
}

/** What sharing with everyone at the org needs, per kind of thing shared. */
export const SHARED_KIND = Object.freeze({ SKILL: 'skill', ARTIFACT: 'artifact' });

/** Whether the caller may share `kind` with everyone at the org:
    `canShareSkillsOrg` for a skill, `canShareArtifactsOrg` for an artifact. */
export function canShareWithOrg(capabilities, kind) {
  return kind === SHARED_KIND.ARTIFACT
    ? capabilities?.canShareArtifactsOrg === true
    : capabilities?.canShareSkillsOrg === true;
}

/** Why "Everyone at ‹org›" is locked for `kind`, or null when it isn't:
    MindsHub couldn't be asked, or the caller lacks the permission. */
export function orgShareLockReason(capabilities, kind) {
  if (canShareWithOrg(capabilities, kind)) return null;
  if (permissionsUnknown(capabilities)) return mindsHubUnreachableHint();
  return kind === SHARED_KIND.ARTIFACT ? orgArtifactShareWithheldHint() : orgAdminOnlyHint();
}

/* The audience cards both Share panels offer, private → public. The same
   values name the same choice on a skill and on an artifact; an artifact
   adds Password and Public. */
export const AUDIENCE_CHOICE = Object.freeze({
  PRIVATE: 'private',
  ORG: 'org',
  SPECIFIC: 'specific',
  PASSWORD: 'password',
  PUBLIC: 'public',
});

/** The private choice's title, on every surface. */
export const ONLY_ME_TITLE = 'Only me';
export const onlyMeTitle = () => tr('onlyMeTitle');
/** Its second line, for a skill and for an artifact. */
export const ONLY_ME_DESC = Object.freeze({
  [SHARED_KIND.SKILL]: 'Nobody else can use it',
  [SHARED_KIND.ARTIFACT]: 'Nobody else can open this',
});
export const onlyMeDesc = (kind) => tr(kind === SHARED_KIND.ARTIFACT ? 'onlyMeDesc.artifact' : 'onlyMeDesc.skill');
/** "Specific teams and people", and its second line: an artifact also takes
    outside emails. */
export const SPECIFIC_TITLE = 'Specific teams and people';
export const specificTitle = () => tr('specificTitle');
export const SPECIFIC_DESC = Object.freeze({
  [SHARED_KIND.SKILL]: 'Pick teams or colleagues',
  [SHARED_KIND.ARTIFACT]: 'Pick teams, colleagues or outside emails',
});
export const specificDesc = (kind) => tr(kind === SHARED_KIND.ARTIFACT ? 'specificDesc.artifact' : 'specificDesc.skill');

/* A skill shared with teams or with everyone is recalled when it's relevant
   to a task. Someone allowed to may make it "always on": part of every task
   for everyone it reaches. The server enforces who may; these mirror it. */
export const ALWAYS_ON_LABEL = 'Always include in every task';
export const alwaysOnLabel = () => tr('alwaysOnLabel');
/** What "always on" does for a skill (`name`), on or off: the switch's help
    line, and the toast once a save changes only it. */
export const alwaysOnHelp = (on, name = tr('thisSkill')) => tr(on ? 'alwaysOnHelp.on' : 'alwaysOnHelp.off', { name });
export const ALWAYS_ON_ORG_ADMIN_HINT = 'Only admins can make a skill shared with everyone always on';
export const alwaysOnOrgAdminHint = () => tr('alwaysOnOrgAdminHint');
export const ALWAYS_ON_EDITOR_HINT = 'Only people who can edit this skill can change this';
export const alwaysOnEditorHint = () => tr('alwaysOnEditorHint');
export const ALWAYS_ON_BADGE = 'Always on';
export const alwaysOnBadge = () => tr('alwaysOnBadge');
export const ALWAYS_ON_BADGE_HINT = "Part of every task for everyone it's shared with";
export const alwaysOnBadgeHint = () => tr('alwaysOnBadgeHint');

/** "Everyone at Acme", or "Everyone in the organization" when no name is
    known (sharingOrgName). */
export function everyoneAtLabel(orgName) {
  return orgName ? tr('everyoneAt', { org: orgName }) : tr('everyoneInOrganization');
}

/** The second line under "Everyone at ‹org›", wherever it shows. */
export const EVERYONE_AT_DESC = 'Anyone in your organization';
export const everyoneAtDesc = () => tr('everyoneAtDesc');

/** The org's name for running text, or "your organization". */
export function orgNameOrGeneric(orgName) {
  return orgName || tr('yourOrganization');
}

/** The primary line of a person MindsHub doesn't know. */
export const UNKNOWN_PERSON = 'Unknown person';
export const unknownPerson = () => tr('unknownPerson');

/* Every org has a default team everyone is in ("All members"). The server
   maps it to sharing with everyone, so sharing never lists it as a team:
   "Everyone at ‹org›" is that choice, and an audience naming it reads as
   shared with everyone. */

/** Whether a team (as fetchMindsHubTeams returns it) is the org's default team. */
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
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
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
    return emails.length ? plural(emails.length, 'people') : tr('recipients.addEmail');
  }
  const parts = [];
  if (teamIds.length) parts.push(plural(teamIds.length, 'teams'));
  if (userIds.length) parts.push(plural(userIds.length, 'people'));
  if (emails.length) parts.push(tr('recipients.outside', { count: emails.length, org: orgNameOrGeneric(orgName) }));
  if (parts.length) return parts.join(' · ');
  return allowExternal ? tr('recipients.addTeamPersonOrEmail') : tr('recipients.addTeamOrPerson');
}

/** The audience of a skill shared with nobody. */
export const PRIVATE_ACCESS = Object.freeze({ orgAllowed: false, allowedTeamIds: [], allowedUserIds: [], alwaysOn: false });

/** A skill's `access` in one shape:
    `{ orgAllowed, allowedTeamIds, allowedUserIds, alwaysOn }`. */
export function skillAccess(skill) {
  const said = readAudienceAnswer(skill?.access);
  const out = {
    orgAllowed: said.orgAllowed === true,
    allowedTeamIds: said.teamIds ?? [],
    allowedUserIds: said.userIds ?? [],
    alwaysOn: said.alwaysOn === true,
  };
  if (!canBeAlwaysOn(out)) out.alwaysOn = false;
  return out;
}

/** Always on needs everyone at the org or at least one team. */
export function canBeAlwaysOn(access) {
  return access.orgAllowed === true || access.allowedTeamIds.length > 0;
}

/** Whether a skill is part of every task for everyone it reaches. */
export function isSkillAlwaysOn(skill) {
  return skillAccess(skill).alwaysOn;
}

/**
 * Why the caller can't change "always on" for this audience, or null when
 * they can. Shared with everyone needs `canShareSkillsOrg` (and says when
 * MindsHub couldn't be asked); teams only need edit rights.
 */
export function alwaysOnLockReason(access, { capabilities = null, canEdit = false } = {}) {
  if (access.orgAllowed) {
    if (canShareWithOrg(capabilities, SHARED_KIND.SKILL)) return null;
    return permissionsUnknown(capabilities) ? mindsHubUnreachableHint() : alwaysOnOrgAdminHint();
  }
  if (access.allowedTeamIds.length > 0) return canEdit ? null : alwaysOnEditorHint();
  return null;
}

/**
 * Whether the caller may switch "always on" for a skill as it is shared now,
 * and why not: `{ allowed, reason }`. A skill they can edit, that the org or
 * a team reaches, and only where `alwaysOnLockReason` lets them. A member of
 * one of its teams may, though only the owner or an admin changes who it
 * reaches (`canChangeSkillAudience`). Never a built-in. The Share button and
 * the switch both read it.
 */
export function skillAlwaysOnLock(skill, capabilities) {
  const access = skillAccess(skill);
  if (skill?.isBuiltin || !canBeAlwaysOn(access)) return { allowed: false, reason: null };
  const canEdit = canEditSkill(skill);
  const reason = alwaysOnLockReason(access, { capabilities, canEdit });
  return { allowed: canEdit && reason === null, reason };
}

/** Only me: nobody else is named. */
export function isPrivateAccess(access) {
  return !access.orgAllowed && access.allowedTeamIds.length === 0 && access.allowedUserIds.length === 0;
}

/** The body `PUT /skills/{slug}/sharing` takes for a skill's access. */
export function skillAccessPayload(access) {
  return skillAccessRequest(
    { orgAllowed: access.orgAllowed, teamIds: access.allowedTeamIds, userIds: access.allowedUserIds },
    { alwaysOn: access.alwaysOn === true && canBeAlwaysOn(access) },
  );
}

/** Whether two `PUT /skills/{slug}/sharing` bodies let the same org, teams
    and people use the skill, whatever order the ids come in. */
export function sameSkillAudience(a, b) {
  const ids = (list) => [...list].sort().join(',');
  const first = readAudienceRequest(a);
  const second = readAudienceRequest(b);
  return first.orgAllowed === second.orgAllowed
    && ids(first.teamIds) === ids(second.teamIds)
    && ids(first.userIds) === ids(second.userIds);
}

/** Whether two `PUT /skills/{slug}/sharing` bodies are the same: the same
    audience and the same "always on". */
export function sameSkillAccessPayload(a, b) {
  return sameSkillAudience(a, b) && readAudienceRequest(a).alwaysOn === readAudienceRequest(b).alwaysOn;
}

/** Which section of the Skills page a skill sits in. A skill without one is
    the caller's own. */
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
    parts.push(team ? tr('teamBadge', { team: team.display_name }) : plural(1, 'teams'));
  } else if (teamIds.length > 1) {
    parts.push(plural(teamIds.length, 'teams'));
  }
  const people = access.allowedUserIds.length;
  if (people) parts.push(plural(people, 'people'));
  return parts.length ? parts.join(' · ') : null;
}

/* Sections follow who a skill reaches, the caller's own included (the
   server's `section`): everyone, else a team, else "Yours" (the caller's own,
   shared with nobody or only with people), else "Shared with me". */
const SECTION_TITLES = {
  mine: () => tr('sections.mine'),
  shared_with_me: () => tr('sections.sharedWithMe'),
  team: () => tr('sections.team'),
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
  groups.push({ id: 'builtin', title: tr('sections.builtin'), skills: buckets.builtin });
  return groups.filter((group) => group.skills.length > 0);
}

/* Artifact access, as a card, a save's answer or the access route reports it. */

/**
 * "Only me" on the wire is `restricted` with no recipients and no org. The
 * server also sends an explicit `ownerOnly`; prefer it, and fall back to the
 * derivation for a record written before that flag existed. Null when the
 * answer doesn't know who the artifact reaches (readArtifactAudience): its
 * empty lists then say nothing.
 *
 * @returns {boolean | null}
 */
export function isOwnerOnlyAccess(artifact) {
  const audience = readArtifactAudience(artifact);
  if (!audience) return null;
  if (audience.ownerOnly !== null) return audience.ownerOnly;
  return audience.emails.length === 0 && !audience.orgAllowed
    && audience.teamIds.length === 0 && audience.userIds.length === 0;
}

/* ── "Share" or "Shared" ────────────────────────────────────────────────
   A Share button reads "Shared" once something reaches anyone besides its
   owner, with an icon for how and a tooltip saying who. */

/** "2 teams and 3 people", "1 team, 2 people and 1 outside email"; null for none. */
export function audienceCountsPhrase({ teams = 0, people = 0, outside = 0 } = {}) {
  const parts = [];
  if (teams) parts.push(plural(teams, 'teams'));
  if (people) parts.push(plural(people, 'people'));
  if (outside) parts.push(plural(outside, 'outsideEmails'));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return tr('list.two', { first: parts[0], second: parts[1] });
  return tr('list.three', { first: parts[0], second: parts[1], third: parts[2] });
}

/** "Shared with everyone at Acme" / "… in the organization". */
export function sharedWithEveryoneHint(orgName) {
  return orgName ? tr('share.everyoneAt', { org: orgName }) : tr('share.everyoneInOrganization');
}

/**
 * Whether a skill is shared and how, for its Share button:
 * `{ shared, kind: 'private' | 'org' | 'specific', hint }`. The default team
 * reads as everyone at the org.
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
  if (!phrase) return { shared: false, kind: 'private', hint: onlyMeDesc(SHARED_KIND.SKILL) };
  return { shared: true, kind: 'specific', hint: tr('share.with', { phrase }) };
}

/** A restricted artifact whose audience hasn't been read yet: no claim
    either way, so its button reads "Share" and names nobody. */
export const ARTIFACT_SHARE_UNKNOWN = Object.freeze({ shared: false, kind: 'unknown', hint: null });

/**
 * The same for a published artifact (its publish controller or artifact):
 * `kind` 'private' | 'public' | 'password' | 'org' | 'specific'. A restricted
 * artifact is ARTIFACT_SHARE_UNKNOWN with `audienceKnown` false (MindsHub
 * mode before the access route answers) and when the artifact itself doesn't
 * know who it reaches (a MindsHub mode card, whose audience fields are null).
 */
export function artifactShareState(artifact, {
  orgSharing = false, orgName = null, teams = [], audienceKnown = true,
} = {}) {
  if (!artifact?.publishedUrl) return { shared: false, kind: 'private', hint: tr('share.notYet') };
  const mode = artifact.accessMode || (artifact.accessProtected ? 'password' : 'public');
  if (mode === 'public') return { shared: true, kind: 'public', hint: tr('share.public') };
  if (mode === 'password') return { shared: true, kind: 'password', hint: tr('share.password') };
  const audience = audienceKnown ? readArtifactAudience(artifact) : null;
  if (!audience) return ARTIFACT_SHARE_UNKNOWN;
  if (isOwnerOnlyAccess(artifact)) return { shared: false, kind: 'private', hint: onlyMeDesc(SHARED_KIND.ARTIFACT) };
  if (orgSharing && (audience.orgAllowed || namesDefaultTeam(audience.teamIds, teams))) {
    return { shared: true, kind: 'org', hint: sharedWithEveryoneHint(orgName) };
  }
  const phrase = orgSharing
    ? audienceCountsPhrase({
      teams: withoutDefaultTeam(audience.teamIds, teams).length,
      people: audience.userIds.length,
      outside: audience.emails.length,
    })
    : audienceCountsPhrase({ people: audience.emails.length });
  return { shared: true, kind: 'specific', hint: phrase ? tr('share.with', { phrase }) : tr('share.shared') };
}
