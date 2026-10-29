import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import {
  accessOrgWide,
  accessTeamIds,
  canEditSkill,
  groupSkillsBySection,
  parseEmailInput,
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
    expect(groups.map((g) => g.hint)).toEqual([null, 'Applied to every task', 'Applied to every task', null]);
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
