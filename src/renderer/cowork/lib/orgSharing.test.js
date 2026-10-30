import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import {
  artifactShareState,
  audienceCountsPhrase,
  filterPeople,
  foldForSearch,
  skillShareState,
  accessAllowedTeamIds,
  accessAllowedUserIds,
  accessOrgAllowed,
  alwaysOnLockReason,
  canEditSkill,
  groupSkillsBySection,
  isPrivateAccess,
  isSkillAlwaysOn,
  parseEmailInput,
  personLabel,
  skillAccess,
  skillAccessPayload,
  skillAudienceBadge,
  peopleInLabel,
  peopleOutsideLabel,
  shareableTeams,
  namesDefaultTeam,
  withoutDefaultTeam,
  filterTeams,
  personInitials,
  recipientSummary,
} from './orgSharing';

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
    // Sections no longer claim their skills are applied to every task.
    expect(groups.every((g) => !('hint' in g))).toBe(true);
  });

  it('puts a skill without a section with the caller\'s own, and names an unnamed org generically', () => {
    const groups = groupSkillsBySection([skill('legacy'), skill('o', { section: 'org' })]);
    expect(groups.map((g) => [g.title, g.skills.map((s) => s.label)])).toEqual([
      ['Yours', ['legacy']],
      ['Everyone in your organization', ['o']],
    ]);
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
    [{ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u1', 'u2'] }, '2 people'],
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
  it('reads alwaysOn in either spelling, and only for org-wide or team skills', () => {
    expect(isSkillAlwaysOn(skill('s', { access: { orgAllowed: true, alwaysOn: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { access: { allowed_team_ids: ['t1'], always_on: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { access: { orgAllowed: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s', { access: { allowedUserIds: ['u1'], alwaysOn: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s'))).toBe(false);
    // The older `sharing` field is no longer read.
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

  it('locks it for an org-wide skill without can_share_org and a team skill without can_edit', () => {
    const org = { orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: [] };
    const team = { orgAllowed: false, allowedTeamIds: ['t1'], allowedUserIds: [] };
    expect(alwaysOnLockReason(org, { canShareOrg: false, canEdit: true })).toBe('Only admins can make an organization-wide skill always on');
    expect(alwaysOnLockReason(org, { canShareOrg: true, canEdit: false })).toBeNull();
    expect(alwaysOnLockReason(team, { canShareOrg: false, canEdit: false })).toBe('Only people who can edit this skill can change this');
    expect(alwaysOnLockReason(team, { canShareOrg: false, canEdit: true })).toBeNull();
  });
});

describe('canEditSkill', () => {
  it('follows can_edit when the server sends it, else the capabilities', () => {
    expect(canEditSkill({ can_edit: false, capabilities: { canEdit: true } })).toBe(false);
    expect(canEditSkill({ can_edit: true })).toBe(true);
    expect(canEditSkill({ capabilities: { canEdit: true } })).toBe(true);
    expect(canEditSkill({})).toBe(false); // web fails closed
  });
});

describe('parseEmailInput', () => {
  it('lowercases, dedupes against what is there and sets aside what is not an email', () => {
    expect(parseEmailInput('A@x.com, b@x.com; nope a@x.com', ['B@x.com'])).toEqual({
      valid: ['a@x.com'],
      invalid: ['nope'],
    });
  });
});

describe('artifact access fields', () => {
  it('reads team ids, user ids and org_allowed in either spelling', () => {
    expect(accessAllowedTeamIds({ allowed_team_ids: ['t1'] })).toEqual(['t1']);
    expect(accessAllowedTeamIds({ allowedTeamIds: ['t2'] })).toEqual(['t2']);
    expect(accessAllowedTeamIds({})).toEqual([]);
    expect(accessAllowedUserIds({ allowed_user_ids: ['u1', 7] })).toEqual(['u1']);
    expect(accessAllowedUserIds({ allowedUserIds: ['u2'] })).toEqual(['u2']);
    expect(accessAllowedUserIds({})).toEqual([]);
    expect(accessOrgAllowed({ org_allowed: true })).toBe(true);
    expect(accessOrgAllowed({ orgAllowed: true })).toBe(true);
    expect(accessOrgAllowed({ org_wide: true })).toBe(true);
    expect(accessOrgAllowed({ orgAllowed: false, orgWide: true })).toBe(false);
    expect(accessOrgAllowed({})).toBe(false);
  });
});

describe('people labels', () => {
  it('names the org, or says your organization', () => {
    expect(peopleInLabel('Acme')).toBe('People in Acme');
    expect(peopleOutsideLabel('Acme')).toBe('People outside Acme');
    expect(peopleInLabel(null)).toBe('People in your organization');
    expect(peopleOutsideLabel(null)).toBe('People outside your organization');
  });
});

describe('skillAccess', () => {
  it('reads access in either spelling and treats a skill without it as private', () => {
    expect(skillAccess(skill('s', { access: { org_allowed: true, allowed_team_ids: ['t1'], allowed_user_ids: ['u1'], always_on: true } })))
      .toEqual({ orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: ['u1'], alwaysOn: true });
    expect(isPrivateAccess(skillAccess(skill('s')))).toBe(true);
    expect(isPrivateAccess(skillAccess(skill('s', { access: { allowedUserIds: ['u1'] } })))).toBe(false);
  });
});

describe('personLabel', () => {
  it('says who a picked person is, or that they are unknown', () => {
    expect(personLabel({ id: 'u1', name: 'Ana Ruiz', email: 'ana@acme.com' })).toBe('Ana Ruiz (ana@acme.com)');
    expect(personLabel({ id: 'u1', name: null, email: 'ana@acme.com' })).toBe('ana@acme.com');
    expect(personLabel({ id: 'u1', pending: true })).toBe('Loading…');
    expect(personLabel({ id: 'u1', name: null, email: null })).toBe('Unknown person');
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

  it('summarises what was added, leaving out empty parts', () => {
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
      .toEqual({ shared: false, kind: 'private', hint: 'Only you can use it' });
    expect(skillShareState(skill({ orgAllowed: true }), { teams, orgName: 'Acme' }))
      .toEqual({ shared: true, kind: 'org', hint: 'Shared with everyone at Acme' });
    expect(skillShareState(skill({ allowedTeamIds: ['t0'] }), { teams }).hint).toBe('Shared with everyone in your organization');
    expect(skillShareState(skill({ allowedTeamIds: ['t1'], allowedUserIds: ['u1', 'u2'] }), { teams }))
      .toEqual({ shared: true, kind: 'specific', hint: 'Shared with 1 team and 2 people' });
  });

  it('reads an artifact', () => {
    expect(artifactShareState({}).shared).toBe(false);
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'public' }).kind).toBe('public');
    expect(artifactShareState({ publishedUrl: 'u', accessProtected: true }).kind).toBe('password');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', ownerOnly: true }))
      .toEqual({ shared: false, kind: 'private', hint: 'Only you can open it' });
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', orgAllowed: true }, { orgSharing: true, orgName: 'Acme' }).hint)
      .toBe('Shared with everyone at Acme');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', allowedUserIds: ['u1'], accessEmails: ['a@x.io'] }, { orgSharing: true }).hint)
      .toBe('Shared with 1 person and 1 outside email');
    expect(artifactShareState({ publishedUrl: 'u', accessMode: 'restricted', accessEmails: ['a@x.io', 'b@x.io'] }).hint)
      .toBe('Shared with 2 people');
  });
});
