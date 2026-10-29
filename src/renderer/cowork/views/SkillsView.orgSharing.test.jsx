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
  searchHubPeople: vi.fn(),
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

  describe('creating a skill', () => {
    async function openWriteForm(user, skills = [mine], capabilities) {
      await renderPage(skills, capabilities);
      await waitFor(() => expect(section('Only me')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /Create skill/i }));
      await user.click(await screen.findByRole('menuitem', { name: /Write Skill Instructions/i }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'new-skill');
      await user.type(within(dialog).getByRole('textbox', { name: 'Instructions' }), 'Do it.');
      return dialog;
    }
    const ADMIN_CAPS = { enabled: true, can_share_org: true, org_name: 'Kinaxis' };

    it('asks who can use it right after Project, starting on Only me, without the old select', async () => {
      const user = userEvent.setup();
      const dialog = await openWriteForm(user);

      const group = within(dialog).getByRole('group', { name: 'Who can use it' });
      expect(within(group).getByRole('checkbox', { name: 'Only me' })).toBeChecked();
      expect(within(dialog).queryByRole('combobox', { name: 'Who can use it' })).toBeNull();
      const labels = [...dialog.querySelectorAll('label')].map((l) => l.textContent.trim());
      const order = ['Label', 'Project', 'Who can use it', 'Description', 'Instructions'].map((l) => labels.indexOf(l));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('disables Everyone at the org without can_share_org', async () => {
      const user = userEvent.setup();
      const dialog = await openWriteForm(user);

      expect(within(dialog).getByRole('checkbox', { name: 'Everyone at Kinaxis' })).toHaveAttribute('aria-disabled', 'true');
      expect(within(dialog).getByTestId('org-option-locked')).toBeInTheDocument();
    });

    it('makes no sharing call for Only me', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      const dialog = await openWriteForm(user);

      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(api.saveSkill.mock.calls[0][0]).not.toHaveProperty('shared');
      expect(api.setSkillAudience).not.toHaveBeenCalled();
    });

    it('creates the skill, then shares it with the picked org audience by its slug', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill-slug' });
      api.setSkillAudience.mockResolvedValue({});
      const dialog = await openWriteForm(user, [mine], ADMIN_CAPS);

      await user.click(within(dialog).getByRole('checkbox', { name: 'Everyone at Kinaxis' }));
      await user.click(within(dialog).getByRole('switch', { name: 'Always include in every task' }));
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAudience).toHaveBeenCalledWith(
        'new-skill-slug', { org: true, team_ids: [], emails: [], always_on: true },
      ));
      expect(api.saveSkill.mock.invocationCallOrder[0]).toBeLessThan(api.setSkillAudience.mock.invocationCallOrder[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('lets the creator make a new team skill always on', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAudience.mockResolvedValue({});
      const dialog = await openWriteForm(user);

      await user.click(within(dialog).getByRole('checkbox', { name: 'Teams' }));
      await user.click(await within(dialog).findByRole('checkbox', { name: 'Supply Planning' }));
      const alwaysOn = within(dialog).getByRole('switch', { name: 'Always include in every task' });
      expect(alwaysOn).not.toBeDisabled();
      await user.click(alwaysOn);
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAudience).toHaveBeenCalledWith(
        'new-skill', { org: false, team_ids: ['t-supply'], emails: [], always_on: true },
      ));
    });

    it('shares a new skill with people picked from the org', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAudience.mockResolvedValue({});
      api.searchHubPeople.mockResolvedValue({ reachable: true, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@kinaxis.com' }] });
      const dialog = await openWriteForm(user);

      expect(within(dialog).queryByRole('checkbox', { name: 'Specific people' })).toBeNull();
      await user.click(within(dialog).getByRole('checkbox', { name: 'People in Kinaxis' }));
      await user.type(within(dialog).getByRole('combobox', { name: 'Search people' }), 'ana');
      await user.click(await within(dialog).findByRole('option', { name: /Ana Ruiz/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAudience).toHaveBeenCalledWith(
        'new-skill', { org: false, team_ids: [], emails: ['ana@kinaxis.com'], always_on: false },
      ));
    });

    it("shows the server's refusal of someone outside the org inline", async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAudience.mockRejectedValueOnce(Object.assign(
        new Error('Skills can only be shared with people in your organization: ana@kinaxis.com'), { status: 400 },
      ));
      api.searchHubPeople.mockResolvedValue({ reachable: true, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@kinaxis.com' }] });
      const dialog = await openWriteForm(user);

      await user.click(within(dialog).getByRole('checkbox', { name: 'People in Kinaxis' }));
      await user.type(within(dialog).getByRole('combobox', { name: 'Search people' }), 'ana');
      await user.click(await within(dialog).findByRole('option', { name: /Ana Ruiz/ }));
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await within(dialog).findByText(/Skills can only be shared with people in your organization: ana@kinaxis.com/))
        .toBeInTheDocument();
    });

    it('keeps the dialog open with an inline note when sharing fails after the create', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAudience.mockRejectedValueOnce(new Error('Team not found'));
      const dialog = await openWriteForm(user);

      await user.click(within(dialog).getByRole('checkbox', { name: 'Teams' }));
      await user.click(await within(dialog).findByRole('checkbox', { name: 'Supply Planning' }));
      const loads = api.fetchSkills.mock.calls.length;
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await within(dialog).findByText(
        "Skill created, but it couldn't be shared: Team not found. You can share it from the skill's menu.",
      )).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(api.deleteSkill).not.toHaveBeenCalled();
      await waitFor(() => expect(api.fetchSkills.mock.calls.length).toBeGreaterThan(loads + 1));

      // A retry shares the existing skill; it never creates a second one.
      api.setSkillAudience.mockResolvedValueOnce({});
      await user.click(within(dialog).getByRole('button', { name: 'Retry sharing' }));
      await waitFor(() => expect(api.setSkillAudience).toHaveBeenCalledTimes(2));
      expect(api.saveSkill).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
