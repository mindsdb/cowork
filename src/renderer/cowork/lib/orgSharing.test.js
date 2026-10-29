import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import {
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
} from './orgSharing';

const skill = (label, extra = {}) => ({ label, isBuiltin: false, ...extra });

describe('groupSkillsBySection', () => {
  it('orders the sections and leaves empty ones out', () => {
    const groups = groupSkillsBySection([
      skill('org-one', { section: 'org' }),
      skill('mine-one', { section: 'mine' }),
      skill('team-one', { section: 'team' }),
      skill('creator', { isBuiltin: true }),
    ], { orgName: 'Kinaxis' });

    expect(groups.map((g) => g.title)).toEqual(['Only me', 'My teams', 'Everyone at Kinaxis', 'Built-in']);
    // Sections no longer claim their skills are applied to every task.
    expect(groups.every((g) => !('hint' in g))).toBe(true);
  });

  it('puts a skill without a section with the caller\'s own, and names an unnamed org generically', () => {
    const groups = groupSkillsBySection([skill('legacy'), skill('o', { section: 'org' })]);
    expect(groups.map((g) => [g.title, g.skills.map((s) => s.label)])).toEqual([
      ['Only me', ['legacy']],
      ['Everyone in your organization', ['o']],
    ]);
  });
});

describe('skillAudienceBadge', () => {
  const teams = [{ id: 't1', display_name: 'Supply Planning' }];
  it.each([
    [{ orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, null],
    [{ orgAllowed: true, allowedTeamIds: ['t1'], allowedUserIds: ['u1'] }, 'Everyone at Kinaxis'],
    [{ orgAllowed: false, allowedTeamIds: ['t1'], allowedUserIds: [] }, 'Team: Supply Planning'],
    [{ orgAllowed: false, allowedTeamIds: ['t-other'], allowedUserIds: [] }, '1 team'],
    [{ orgAllowed: false, allowedTeamIds: ['t1', 't2'], allowedUserIds: ['u1'] }, '2 teams · 1 person'],
    [{ orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u1', 'u2', 'u3'] }, '3 people'],
    [{ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u1', 'u2'] }, '2 people'],
  ])('labels %j as %s', (access, label) => {
    expect(skillAudienceBadge(skill('s', { access }), { teams, orgName: 'Kinaxis' })).toBe(label);
  });

  it('reads a skill shared with the default team as everyone at the org', () => {
    const withDefault = [{ id: 't0', display_name: 'All members', is_default: true }, ...teams];
    const badge = (allowedTeamIds) => skillAudienceBadge(
      skill('s', { access: { orgAllowed: false, allowedTeamIds, allowedUserIds: [] } }), { teams: withDefault, orgName: 'Kinaxis' },
    );
    expect(badge(['t0'])).toBe('Everyone at Kinaxis');
    expect(badge(['t0', 't1'])).toBe('Everyone at Kinaxis');
    expect(badge(['t1'])).toBe('Team: Supply Planning');
  });
});

describe('default team', () => {
  const teams = [
    { id: 't0', display_name: 'All members', is_default: true },
    { id: 't1', display_name: 'Supply Planning', is_default: false },
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
    expect(peopleInLabel('Kinaxis')).toBe('People in Kinaxis');
    expect(peopleOutsideLabel('Kinaxis')).toBe('People outside Kinaxis');
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
    expect(personLabel({ id: 'u1', name: 'Ana Ruiz', email: 'ana@kinaxis.com' })).toBe('Ana Ruiz (ana@kinaxis.com)');
    expect(personLabel({ id: 'u1', name: null, email: 'ana@kinaxis.com' })).toBe('ana@kinaxis.com');
    expect(personLabel({ id: 'u1', pending: true })).toBe('Loading…');
    expect(personLabel({ id: 'u1', name: null, email: null })).toBe('Unknown person');
  });
});
