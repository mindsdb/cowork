import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import {
  accessOrgWide,
  accessTeamIds,
  alwaysOnLockReason,
  audiencePayload,
  canEditSkill,
  groupSkillsBySection,
  isSkillAlwaysOn,
  parseEmailInput,
  skillAudience,
  skillAudienceBadge,
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
    [{ org: false, team_ids: [], emails: [] }, null],
    [{ org: true, team_ids: ['t1'], emails: ['a@x.com'] }, 'Everyone at Kinaxis'],
    [{ org: false, team_ids: ['t1'], emails: [] }, 'Team: Supply Planning'],
    [{ org: false, team_ids: ['t-other'], emails: [] }, '1 team'],
    [{ org: false, team_ids: ['t1', 't2'], emails: ['a@x.com'] }, '2 teams · 1 person'],
    [{ org: false, team_ids: [], emails: ['a@x.com', 'b@x.com', 'c@x.com'] }, '3 people'],
  ])('labels %j as %s', (sharing, label) => {
    expect(skillAudienceBadge(skill('s', { sharing }), { teams, orgName: 'Kinaxis' })).toBe(label);
  });
});

describe('always on', () => {
  it('reads alwaysOn in either spelling, and only for org-wide or team skills', () => {
    expect(isSkillAlwaysOn(skill('s', { sharing: { org: true, alwaysOn: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { sharing: { team_ids: ['t1'], always_on: true } }))).toBe(true);
    expect(isSkillAlwaysOn(skill('s', { sharing: { org: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s', { sharing: { emails: ['a@x.com'], alwaysOn: true } }))).toBe(false);
    expect(isSkillAlwaysOn(skill('s'))).toBe(false);
  });

  it('sends always_on only when the org or a team is picked', () => {
    const base = { org: false, teamIds: [], emails: [], alwaysOn: true };
    expect(audiencePayload({ ...base, teamIds: ['t1'] })).toEqual({ org: false, team_ids: ['t1'], emails: [], always_on: true });
    expect(audiencePayload({ ...base, emails: ['a@x.com'] })).toEqual({ org: false, team_ids: [], emails: ['a@x.com'], always_on: false });
    expect(audiencePayload(skillAudience(skill('s')))).toEqual({ org: false, team_ids: [], emails: [], always_on: false });
  });

  it('locks it for an org-wide skill without can_share_org and a team skill without can_edit', () => {
    const org = { org: true, teamIds: ['t1'], emails: [] };
    const team = { org: false, teamIds: ['t1'], emails: [] };
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
  it('reads team ids and org_wide in either spelling', () => {
    expect(accessTeamIds({ allowed_team_ids: ['t1'] })).toEqual(['t1']);
    expect(accessTeamIds({ allowedTeamIds: ['t2'] })).toEqual(['t2']);
    expect(accessTeamIds({})).toEqual([]);
    expect(accessOrgWide({ org_wide: true, orgAllowed: false })).toBe(true);
    expect(accessOrgWide({ orgAllowed: true })).toBe(true);
    expect(accessOrgWide({})).toBe(false);
  });
});
