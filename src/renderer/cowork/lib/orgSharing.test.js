import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import {
  artifactShareState,
  audienceCountsPhrase,
  filterPeople,
  foldForSearch,
  skillShareState,
  ARTIFACT_SHARE_UNKNOWN,
  MINDSHUB_UNREACHABLE_HINT,
  ORG_ADMIN_ONLY_HINT,
  SHARED_KIND,
  SHARING_OFF,
  alwaysOnHelp,
  alwaysOnLockReason,
  isOwnerOnlyAccess,
  orgShareLockReason,
  skillAlwaysOnLock,
  canEditSkill,
  groupSkillsBySection,
  isPrivateAccess,
  isSkillAlwaysOn,
  sameSkillAccessPayload,
  sameSkillAudience,
  skillAccess,
  skillAccessPayload,
  skillAudienceBadge,
  shareableTeams,
  namesDefaultTeam,
  withoutDefaultTeam,
  filterTeams,
  personInitials,
  recipientSummary,
  everyoneAtLabel,
  mindsHubFailureText,
  mindsHubRetryHelps,
  sharingOrgName,
  MINDSHUB_THROTTLED,
} from './orgSharing';
import { firstMindsHubFailure, readArtifactAudience, readMindsHubFailure } from './sharingContract';

const skill = (label, extra = {}) => ({ label, isBuiltin: false, ...extra });

describe('groupSkillsBySection', () => {
  it('orders the sections and leaves empty ones out', () => {
    const groups = groupSkillsBySection([
      skill('org-one', { section: 'org' }),
      skill('mine-one', { section: 'mine' }),
      skill('team-one', { section: 'team' }),
      skill('creator', { isBuiltin: true }),
    ], { orgName: 'Acme' });

    expect(groups.map((g) => g.title)).toEqual(['Yours', 'My teams', 'Everyone at Acme', 'Built-in']);
    // No section claims its skills are applied to every task.
    expect(groups.every((g) => !('hint' in g))).toBe(true);
  });

  it('puts a skill without a section with the caller\'s own, and names an unnamed org generically', () => {
    const groups = groupSkillsBySection([skill('legacy'), skill('o', { section: 'org' })]);
    expect(groups.map((g) => [g.title, g.skills.map((s) => s.label)])).toEqual([
      ['Yours', ['legacy']],
      ['Everyone in the organization', ['o']],
    ]);
  });
});

describe('the org name sharing copy uses', () => {
  const org = (over = {}) => ({ id: 'o1', name: 'acme', displayName: 'Acme Inc', isPersonal: false, ...over });

  it('names the active organization as the account menu does', () => {
    expect(sharingOrgName(org())).toBe('Acme Inc');
    // Keycloak's raw name when the organization has no display name.
    expect(sharingOrgName(org({ displayName: '' }))).toBe('acme');
  });

  it('names no organization when none is known, or for a personal one', () => {
    expect(sharingOrgName(null)).toBeNull();
    expect(sharingOrgName(org({ isPersonal: true, name: 'personal_u1', displayName: 'Personal Organization' }))).toBeNull();
  });

  it('says Everyone at ‹org› with a name, and Everyone in the organization without', () => {
    expect(everyoneAtLabel('Acme Inc')).toBe('Everyone at Acme Inc');
    expect(everyoneAtLabel(null)).toBe('Everyone in the organization');
  });
});

describe('a MindsHub read that got no answer', () => {
  const copy = { unreachable: "Couldn't load it", refused: 'MindsHub refused it' };

  it('reads why from the code cowork-server answers, anything else as an outage', () => {
    expect(readMindsHubFailure({ status: 403, code: 'mindshub_refused' })).toBe('mindshub_refused');
    expect(readMindsHubFailure({ status: 400, code: 'mindshub_refused' })).toBe('mindshub_refused');
    expect(readMindsHubFailure({ status: 429, code: 'mindshub_throttled' })).toBe('mindshub_throttled');
    expect(readMindsHubFailure({ status: 503, code: 'mindshub_unreachable' })).toBe('mindshub_unreachable');
    // A 429 cowork-server answers for itself is not MindsHub's throttle.
    expect(readMindsHubFailure({ status: 429, code: 'server_busy' })).toBe('mindshub_unreachable');
    expect(readMindsHubFailure(new TypeError('Failed to fetch'))).toBe('mindshub_unreachable');
    expect(readMindsHubFailure(null)).toBe('mindshub_unreachable');
  });

  it('says each reason in its own words, and offers Retry unless MindsHub refused', () => {
    expect(mindsHubFailureText('mindshub_unreachable', copy)).toBe("Couldn't load it");
    expect(mindsHubFailureText(null, copy)).toBe("Couldn't load it");
    expect(mindsHubFailureText('mindshub_refused', copy)).toBe('MindsHub refused it');
    expect(mindsHubFailureText('mindshub_throttled', copy)).toBe(MINDSHUB_THROTTLED);
    expect(MINDSHUB_THROTTLED).toBe('MindsHub is limiting requests. Try again in a minute.');
    expect(mindsHubFailureText('mindshub_throttled', { ...copy, throttled: 'slow down' })).toBe('slow down');
    expect(mindsHubRetryHelps('mindshub_unreachable')).toBe(true);
    expect(mindsHubRetryHelps('mindshub_throttled')).toBe(true);
    expect(mindsHubRetryHelps('mindshub_refused')).toBe(false);
  });

  it('reports a throttle first, then an outage, then a refusal', () => {
    expect(firstMindsHubFailure(['mindshub_refused', 'mindshub_unreachable'])).toBe('mindshub_unreachable');
    expect(firstMindsHubFailure(['mindshub_refused', 'mindshub_throttled', 'mindshub_unreachable'])).toBe('mindshub_throttled');
    expect(firstMindsHubFailure(['mindshub_refused', null])).toBe('mindshub_refused');
    expect(firstMindsHubFailure([null, undefined])).toBeNull();
    expect(firstMindsHubFailure([])).toBeNull();
  });
});

describe('skillAudienceBadge', () => {
  const teams = [{ id: 't1', display_name: 'Platform' }];
  it.each([
    [{ orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, null],
    [{ orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: ['u1'] }, 'Everyone at Acme'],
    [{ orgAllowed: false, allowedTeamIds: ['t1'], allowedUserIds: [] }, 'Team: Platform'],
    [{ orgAllowed: false, allowedTeamIds: ['t-other'], allowedUserIds: [] }, '1 team'],
    [{ orgAllowed: false, allowedTeamIds: ['t1', 't2'], allowedUserIds: ['u1'] }, '2 teams · 1 person'],
    [{ orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u1', 'u2', 'u3'] }, '3 people'],
  ])('labels %j as %s', (access, label) => {
    expect(skillAudienceBadge(skill('s', { access }), { teams, orgName: 'Acme' })).toBe(label);
  });

  it('reads a skill shared with the default team as everyone at the org', () => {
    const withDefault = [{ id: 't0', display_name: 'All members', is_default: true }, ...teams];
    const badge = (allowedTeamIds) => skillAudienceBadge(
      skill('s', { access: { orgAllowed: false, allowedTeamIds, allowedUserIds: [] } }), { teams: withDefault, orgName: 'Acme' },
    );
    expect(badge(['t0'])).toBe('Everyone at Acme');
    expect(badge(['t0', 't1'])).toBe('Everyone at Acme');
    expect(badge(['t1'])).toBe('Team: Platform');
  });
});

describe('default team', () => {
  const teams = [
    { id: 't0', display_name: 'All members', is_default: true },
    { id: 't1', display_name: 'Platform', is_default: false },
  ];
  it('is left out of the teams to share with', () => {
    expect(shareableTeams(teams).map((t) => t.id)).toEqual(['t1']);
  });
  it('is spotted in, and dropped from, a list of team ids', () => {
    expect(namesDefaultTeam(['t1', 't0'], teams)).toBe(true);
    expect(namesDefaultTeam(['t1'], teams)).toBe(false);
    expect(withoutDefaultTeam(['t1', 't0'], teams)).toEqual(['t1']);
  });
});

describe('always on', () => {
  it('reads alwaysOn only for skills shared with everyone or a team', () => {
    expect(isSkillAlwaysOn(skill('s', { access: { orgAllowed: true, alwaysOn: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { access: { allowedTeamIds: ['t1'], alwaysOn: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { access: { orgAllowed: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s', { access: { allowedUserIds: ['u1'], alwaysOn: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s'))).toBe(false);
    // Always on is read from `access.alwaysOn` only, never from a `sharing` field.
    expect(isSkillAlwaysOn(skill('s', { sharing: { org: true, alwaysOn: true } }))).toBe(false);
  });

  it('sends always_on only when the org or a team is picked', () => {
    const base = { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true };
    expect(skillAccessPayload({ ...base, allowedTeamIds: ['t1'] }))
      .toEqual({ org_allowed: false, allowed_team_ids: ['t1'], allowed_user_ids: [], always_on: true });
    expect(skillAccessPayload({ ...base, allowedUserIds: ['u1'] }))
      .toEqual({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u1'], always_on: false });
    expect(skillAccessPayload({ ...base, orgAllowed: true }))
      .toEqual({ org_allowed: true, allowed_team_ids: [], allowed_user_ids: [], always_on: true });
    expect(skillAccessPayload(skillAccess(skill('s'))))
      .toEqual({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('tells an always_on change apart from an audience change, whatever order the ids come in', () => {
    const before = { org_allowed: false, allowed_team_ids: ['t1', 't2'], allowed_user_ids: ['u1'], always_on: false };
    const onlyAlwaysOn = { ...before, allowed_team_ids: ['t2', 't1'], always_on: true };
    expect(sameSkillAudience(onlyAlwaysOn, before)).toBe(true);
    expect(sameSkillAccessPayload(onlyAlwaysOn, before)).toBe(false);
    expect(sameSkillAudience({ ...before, allowed_user_ids: [] }, before)).toBe(false);
    expect(sameSkillAudience({ ...before, org_allowed: true }, before)).toBe(false);
  });

  it('says what always on does, for this skill or one by name', () => {
    expect(alwaysOnHelp(true)).toBe('Anton will include this skill in every task.');
    expect(alwaysOnHelp(false)).toBe("Anton will use this skill only when it's relevant.");
    expect(alwaysOnHelp(true, 'brand-voice')).toBe('Anton will include brand-voice in every task.');
  });

  it('locks it for a skill shared with everyone without canShareSkillsOrg and a team skill without can_edit', () => {
    const org = { orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: [] };
    const team = { orgAllowed: false, allowedTeamIds: ['t1'], allowedUserIds: [] };
    const member = { ...SHARING_OFF, enabled: true };
    const admin = { ...member, canShareSkillsOrg: true };
    expect(alwaysOnLockReason(org, { capabilities: member, canEdit: true })).toBe('Only admins can make a skill shared with everyone always on');
    expect(alwaysOnLockReason(org, { capabilities: admin, canEdit: false })).toBeNull();
    // The artifact capability says nothing about skills.
    expect(alwaysOnLockReason(org, { capabilities: { ...member, canShareArtifactsOrg: true }, canEdit: true })).not.toBeNull();
    expect(alwaysOnLockReason(team, { capabilities: member, canEdit: false })).toBe('Only people who can edit this skill can change this');
    expect(alwaysOnLockReason(team, { capabilities: member, canEdit: true })).toBeNull();
  });

  it("says MindsHub couldn't be reached, not that only admins may, while it couldn't be asked", () => {
    const org = { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] };
    const unknown = { ...SHARING_OFF, enabled: true, permissionsKnown: false };
    expect(alwaysOnLockReason(org, { capabilities: unknown, canEdit: true })).toBe(MINDSHUB_UNREACHABLE_HINT);
  });

  it('decides the Share button and the switch with one lock', () => {
    const caps = { ...SHARING_OFF, enabled: true };
    const teamSkill = (extra) => skill('s', { canEdit: true, access: { allowedTeamIds: ['t1'], alwaysOn: false }, ...extra });
    expect(skillAlwaysOnLock(teamSkill(), caps)).toEqual({ allowed: true, reason: null });
    expect(skillAlwaysOnLock(teamSkill({ canEdit: false }), caps))
      .toEqual({ allowed: false, reason: 'Only people who can edit this skill can change this' });
    const orgSkill = skill('s', { canEdit: true, access: { orgAllowed: true } });
    expect(skillAlwaysOnLock(orgSkill, caps).allowed).toBe(false);
    expect(skillAlwaysOnLock(orgSkill, { ...caps, canShareSkillsOrg: true })).toEqual({ allowed: true, reason: null });
    expect(skillAlwaysOnLock(skill('s', { canEdit: true, access: { allowedUserIds: ['u1'] } }), caps))
      .toEqual({ allowed: false, reason: null });
    expect(skillAlwaysOnLock({ ...orgSkill, isBuiltin: true }, { ...caps, canShareSkillsOrg: true }).allowed).toBe(false);
  });
});

describe('Everyone at the org', () => {
  const caps = { ...SHARING_OFF, enabled: true };
  it('reads the capability of the kind being shared', () => {
    expect(orgShareLockReason({ ...caps, canShareSkillsOrg: true }, SHARED_KIND.SKILL)).toBeNull();
    expect(orgShareLockReason({ ...caps, canShareSkillsOrg: true }, SHARED_KIND.ARTIFACT)).toBe(ORG_ADMIN_ONLY_HINT);
    expect(orgShareLockReason({ ...caps, canShareArtifactsOrg: true }, SHARED_KIND.ARTIFACT)).toBeNull();
    expect(orgShareLockReason({ ...caps, canShareArtifactsOrg: true }, SHARED_KIND.SKILL)).toBe(ORG_ADMIN_ONLY_HINT);
  });

  it("is locked as MindsHub couldn't be reached, not as admin only, while it couldn't be asked", () => {
    expect(orgShareLockReason({ ...caps, permissionsKnown: false }, SHARED_KIND.ARTIFACT)).toBe(MINDSHUB_UNREACHABLE_HINT);
    expect(orgShareLockReason({ ...caps, permissionsKnown: false }, SHARED_KIND.SKILL)).toBe(MINDSHUB_UNREACHABLE_HINT);
  });
});

describe('canEditSkill', () => {
  it('follows canEdit when the server sends it, else the capabilities', () => {
    expect(canEditSkill({ canEdit: false, capabilities: { canEdit: true } })).toBe(false);
    expect(canEditSkill({ canEdit: true })).toBe(true);
    expect(canEditSkill({ capabilities: { canEdit: true } })).toBe(true);
    expect(canEditSkill({})).toBe(false); // web fails closed
  });
});

describe('artifact access fields', () => {
  it('reads the camelCase names the server answers, and no other spelling', () => {
    expect(readArtifactAudience({ allowedTeamIds: ['t2'], allowedUserIds: ['u2', 7], orgAllowed: true, accessEmails: ['a@x.io'] }))
      .toEqual({ orgAllowed: true, teamIds: ['t2'], userIds: ['u2'], emails: ['a@x.io'], ownerOnly: null });
    expect(readArtifactAudience({
      allowed_team_ids: ['t1'], allowed_user_ids: ['u1'], org_allowed: true, allowed_emails: ['b@x.io'], owner_only: true,
    })).toEqual({ orgAllowed: false, teamIds: [], userIds: [], emails: [], ownerOnly: null });
    expect(readArtifactAudience({ org_wide: true, orgWide: true }).orgAllowed).toBe(false);
    expect(readArtifactAudience({})).toEqual({ orgAllowed: false, teamIds: [], userIds: [], emails: [], ownerOnly: null });
  });

  it('reads owner-only from the flag, else from an audience naming nobody', () => {
    expect(isOwnerOnlyAccess({ ownerOnly: true, accessEmails: ['a@x.io'] })).toBe(true);
    expect(isOwnerOnlyAccess({ ownerOnly: false })).toBe(false);
    expect(isOwnerOnlyAccess({})).toBe(true);
    expect(isOwnerOnlyAccess({ allowedTeamIds: ['t1'] })).toBe(false);
  });
});

describe('skillAccess', () => {
  it('reads the camelCase access the server sends and treats a skill without it as private', () => {
    expect(skillAccess(skill('s', { access: { orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: ['u1'], alwaysOn: true } })))
      .toEqual({ orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: ['u1'], alwaysOn: true });
    expect(isPrivateAccess(skillAccess(skill('s')))).toBe(true);
    expect(isPrivateAccess(skillAccess(skill('s', { access: { allowedUserIds: ['u1'] } })))).toBe(false);
  });
});

describe('filterTeams', () => {
  const teams = [
    { id: 't1', display_name: 'Platform' },
    { id: 't2', display_name: 'Finance' },
    { id: 't3', display_name: 'Data Platform' },
  ];
  it('returns every team for an empty query', () => {
    expect(filterTeams(teams, '  ')).toEqual(teams);
  });
  it('matches names case-insensitively', () => {
    expect(filterTeams(teams, 'PLATFORM').map((t) => t.id)).toEqual(['t1', 't3']);
  });
  it('keeps the given ids listed', () => {
    expect(filterTeams(teams, 'platform', ['t2']).map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('recipient field helpers', () => {
  it('takes initials from the name, else the email', () => {
    expect(personInitials({ name: 'Ana Maria Ruiz' })).toBe('AR');
    expect(personInitials({ name: 'bo' })).toBe('BO');
    expect(personInitials({ email: 'zed@x.io' })).toBe('Z');
    expect(personInitials(null)).toBe('?');
  });

  it('summarizes what was added, leaving out empty parts', () => {
    expect(recipientSummary({ teamIds: ['a', 'b'], userIds: ['u'], emails: ['z@x.io'] }, { orgName: 'Acme' }))
      .toBe('2 teams · 1 person · 1 outside Acme');
    expect(recipientSummary({ userIds: ['u', 'v'] }, {})).toBe('2 people');
    expect(recipientSummary({ emails: ['z@x.io'] }, {})).toBe('1 outside your organization');
    expect(recipientSummary({}, {})).toBe('Add at least one team, person or email.');
    expect(recipientSummary({}, { allowExternal: false })).toBe('Add at least one team or person.');
    expect(recipientSummary({ emails: ['a@x.io', 'b@x.io'] }, { emailsOnly: true })).toBe('2 people');
    expect(recipientSummary({}, { emailsOnly: true })).toBe('Add at least one email.');
  });
});

describe('groupSkillsBySection with empty sections', () => {
  it('shows only the sections that hold a skill', () => {
    const groups = groupSkillsBySection([{ label: 'a', isBuiltin: false }], { orgName: 'Acme' });
    expect(groups.map((g) => [g.id, g.skills.length])).toEqual([['mine', 1]]);
    expect(groupSkillsBySection([], { orgName: 'Acme' })).toEqual([]);
  });
});

describe('local search', () => {
  it('folds case and accents', () => {
    expect(foldForSearch('  José LÓPEZ ')).toBe('jose lopez');
  });

  it('filters people by name or email and teams by name, accents ignored', () => {
    const people = [{ id: '1', name: 'José López', email: 'jose@k.com' }, { id: '2', name: 'Ana', email: 'ana@k.com' }];
    expect(filterPeople(people, 'lopez').map((p) => p.id)).toEqual(['1']);
    expect(filterPeople(people, 'ANA@').map((p) => p.id)).toEqual(['2']);
    expect(filterPeople(people, '')).toBe(people);
    expect(filterTeams([{ id: 't', display_name: 'Logística' }], 'logist').map((t) => t.id)).toEqual(['t']);
  });
});

describe('Share or Shared', () => {
  it('phrases audience counts', () => {
    expect(audienceCountsPhrase({})).toBeNull();
    expect(audienceCountsPhrase({ teams: 1 })).toBe('1 team');
    expect(audienceCountsPhrase({ teams: 2, people: 3 })).toBe('2 teams and 3 people');
    expect(audienceCountsPhrase({ teams: 1, people: 1, outside: 2 })).toBe('1 team, 1 person and 2 outside emails');
  });

  it('reads a skill', () => {
    const skill = (access) => ({ access });
    const teams = [{ id: 't0', is_default: true }, { id: 't1' }];
    expect(skillShareState(skill({ orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }), { teams }))
      .toEqual({ shared: false, kind: 'private', hint: 'Nobody else can use it' });
    expect(skillShareState(skill({ orgAllowed: true }), { teams, orgName: 'Acme' }))
      .toEqual({ shared: true, kind: 'org', hint: 'Shared with everyone at Acme' });
    expect(skillShareState(skill({ allowedTeamIds: ['t0'] }), { teams }).hint).toBe('Shared with everyone in the organization');
    expect(skillShareState(skill({ allowedTeamIds: ['t1'], allowedUserIds: ['u1', 'u2'] }), { teams }))
      .toEqual({ shared: true, kind: 'specific', hint: 'Shared with 1 team and 2 people' });
  });

  it('reads an artifact', () => {
    expect(artifactShareState({}).shared).toBe(false);
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'public' }).kind).toBe('public');
    expect(artifactShareState({ publishedUrl: 'u', accessProtected: true }).kind).toBe('password');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', ownerOnly: true }))
      .toEqual({ shared: false, kind: 'private', hint: 'Nobody else can open this' });
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', orgAllowed: true }, { orgSharing: true, orgName: 'Acme' }).hint)
      .toBe('Shared with everyone at Acme');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', allowedUserIds: ['u1'], accessEmails: ['a@x.io'] }, { orgSharing: true }).hint)
      .toBe('Shared with 1 person and 1 outside email');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', accessEmails: ['a@x.io', 'b@x.io'] }).hint)
      .toBe('Shared with 2 people');
  });

  // A MindsHub mode card carries no audience: until the access route
  // answers, a restricted artifact is claimed neither shared nor private.
  it('claims nothing for a restricted artifact whose audience is not known yet', () => {
    const card = { publishedUrl: 'u', accessMode: 'restricted', ownerOnly: false };
    expect(artifactShareState(card, { orgSharing: true, audienceKnown: false })).toBe(ARTIFACT_SHARE_UNKNOWN);
    expect(artifactShareState({ ...card, accessMode: 'public' }, { audienceKnown: false }).kind).toBe('public');
  });
});
