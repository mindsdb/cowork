import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* Org sharing (ENG-3787) through the real skills store; only HTTP is mocked. */
const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => []),
  fetchSkills: vi.fn(),
  saveSkill: vi.fn(),
  deleteSkill: vi.fn(),
  setSkillSharing: vi.fn(),
  setSkillAudience: vi.fn(),
  uploadSkillFile: vi.fn(),
  fetchSkillSharingCapabilities: vi.fn(),
  fetchHubTeams: vi.fn(),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('../api', () => api);
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => toast }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

const OWNER_CAPS = { canEdit: true, canDelete: true, canDisable: true };
const READER_CAPS = { canEdit: false, canDelete: false, canDisable: false };
const SUPPLY = { id: 't-supply', display_name: 'Supply Planning' };

const mine = {
  label: 'weekly-report', slug: 'weekly-report', description: 'Mine.', isBuiltin: false, enabled: true,
  section: 'mine', can_edit: true, owner: { id: 'u1', email: 'me@kinaxis.com' },
  sharing: { org: false, team_ids: ['t-supply'], emails: [] }, capabilities: OWNER_CAPS,
};
const fromColleague = {
  label: 'forecast-review', slug: 'forecast-review', description: 'Theirs.', isBuiltin: false, enabled: true,
  section: 'shared_with_me', can_edit: false, owner: { id: 'u2', email: 'ana@kinaxis.com' },
  sharing: { org: false, team_ids: [], emails: ['me@kinaxis.com', 'bo@kinaxis.com', 'cy@kinaxis.com'] },
  capabilities: READER_CAPS,
};
const orgWide = {
  label: 'brand-voice', slug: 'brand-voice', description: 'Org.', isBuiltin: false, enabled: true,
  section: 'org', can_edit: false, owner: { id: 'u3', email: 'admin@kinaxis.com' },
  sharing: { org: true, team_ids: [], emails: [] }, capabilities: READER_CAPS,
};
const teamSkill = {
  label: 'team-playbook', slug: 'team-playbook', description: 'Team.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: false, owner: { id: 'u4', email: 'lead@kinaxis.com' },
  sharing: { org: false, team_ids: ['t-supply'], emails: [], alwaysOn: true }, capabilities: READER_CAPS,
};
const builtin = {
  label: 'skill-creator', description: 'Built in.', isBuiltin: true, enabled: true,
  capabilities: READER_CAPS,
};

async function renderPage(skills, capabilities = { enabled: true, can_share_org: false, org_name: 'Kinaxis' }) {
  vi.resetModules();
  api.fetchSkills.mockResolvedValue({ skills, canShare: false });
  api.fetchSkillSharingCapabilities.mockResolvedValue(capabilities);
  api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [SUPPLY] });
  const { default: SkillsView } = await import('./SkillsView');
  render(<SkillsView />);
  await screen.findByText(skills[0].label);
}

const section = (name) => screen.queryByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SkillsView with org sharing', () => {
  it('groups skills by section and leaves empty sections out', async () => {
    await renderPage([mine, fromColleague, orgWide, builtin]);

    await waitFor(() => expect(section('Only me')).toBeInTheDocument());
    expect(within(section('Only me')).getByText('weekly-report')).toBeInTheDocument();
    expect(within(section('Shared with me')).getByText('forecast-review')).toBeInTheDocument();
    expect(within(section('Everyone at Kinaxis')).getByText('brand-voice')).toBeInTheDocument();
    expect(within(section('Built-in')).getByText('skill-creator')).toBeInTheDocument();
    expect(section('My teams')).toBeNull();
  });

  it('no longer says team and org-wide sections are applied to every task', async () => {
    await renderPage([mine, orgWide, teamSkill]);

    await waitFor(() => expect(section('Everyone at Kinaxis')).toBeInTheDocument());
    expect(screen.queryByText('Applied to every task')).toBeNull();
    expect(within(section('My teams')).getByText('team-playbook')).toBeInTheDocument();
  });

  it('badges only always-on skills as Always on, with a tooltip', async () => {
    const user = userEvent.setup();
    await renderPage([mine, orgWide, teamSkill, { ...orgWide, label: 'legal-checks', slug: 'legal-checks', sharing: { org: true, always_on: true } }]);

    const row = (label) => screen.getByRole('article', { name: label });
    await waitFor(() => expect(within(row('team-playbook')).getByText('Always on')).toBeInTheDocument());
    expect(within(row('legal-checks')).getByText('Always on')).toBeInTheDocument();
    expect(within(row('brand-voice')).queryByText('Always on')).toBeNull();
    expect(within(row('weekly-report')).queryByText('Always on')).toBeNull();
    // Next to its sharing badge.
    await waitFor(() => expect(within(row('team-playbook')).getByText('Team: Supply Planning')).toBeInTheDocument());

    await user.hover(within(row('team-playbook')).getByText('Always on'));
    expect(await screen.findByText("Part of every task for everyone it's shared with")).toBeInTheDocument();
  });

  it('badges each row with its audience and names the owner of a skill shared with the caller', async () => {
    await renderPage([mine, fromColleague, orgWide]);

    const row = (label) => screen.getByRole('article', { name: label });
    await waitFor(() => expect(within(row('weekly-report')).getByText('Team: Supply Planning')).toBeInTheDocument());
    expect(within(row('forecast-review')).getByText('3 people')).toBeInTheDocument();
    expect(within(row('forecast-review')).getByText('Shared by ana@kinaxis.com')).toBeInTheDocument();
    expect(within(row('brand-voice')).getByText('Everyone at Kinaxis')).toBeInTheDocument();
    expect(within(row('weekly-report')).queryByText(/Shared by/)).toBeNull();
  });

  it('keeps the flat list when sharing is off', async () => {
    await renderPage([mine, fromColleague], { enabled: false });

    expect(screen.getByText('forecast-review')).toBeInTheDocument();
    expect(section('Only me')).toBeNull();
    expect(screen.queryByText('Team: Supply Planning')).toBeNull();
  });

  it('offers no Share, Edit or Uninstall on a skill the caller cannot edit', async () => {
    const user = userEvent.setup();
    await renderPage([orgWide]);
    await waitFor(() => expect(section('Everyone at Kinaxis')).toBeInTheDocument());

    await user.click(screen.getByText('brand-voice'));
    await user.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.getByRole('menuitem', { name: /Try in chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Uninstall/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    // An org skill someone else owns has no switch to turn it off.
    expect(screen.queryByRole('switch', { name: 'Skill enabled' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent("Shared by admin@kinaxis.com. You can use it but can't change it.");
  });

  it('says an always-on team skill is part of every task, and keeps its switch hidden', async () => {
    const user = userEvent.setup();
    await renderPage([teamSkill]);
    await waitFor(() => expect(section('My teams')).toBeInTheDocument());

    await user.click(screen.getByText('team-playbook'));

    expect(screen.queryByRole('switch', { name: 'Skill enabled' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent("It's part of every task, and only its owner can change it.");
  });

  it('shares the caller\'s own skill through the dialog and reloads the list', async () => {
    const user = userEvent.setup();
    await renderPage([mine]);
    await waitFor(() => expect(section('Only me')).toBeInTheDocument());
    api.setSkillAudience.mockResolvedValue({ ...mine });

    await user.click(screen.getByText('weekly-report'));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Supply Planning' }));
    const loads = api.fetchSkills.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.setSkillAudience).toHaveBeenCalledWith('weekly-report', { org: false, team_ids: [], emails: [], always_on: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.fetchSkills.mock.calls.length).toBe(loads + 1);
  });
});
