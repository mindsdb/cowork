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
  setSkillAccess: vi.fn(),
  uploadSkillFile: vi.fn(),
  fetchSkillSharingCapabilities: vi.fn(),
  fetchHubTeams: vi.fn(),
  searchHubPeople: vi.fn(),
  fetchHubPeopleByIds: vi.fn(async () => ({ reachable: true, people: [] })),
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
  access: { orgAllowed: false, allowedTeamIds: ['t-supply'], allowedUserIds: [] }, capabilities: OWNER_CAPS,
};
const fromColleague = {
  label: 'forecast-review', slug: 'forecast-review', description: 'Theirs.', isBuiltin: false, enabled: true,
  section: 'shared_with_me', can_edit: false, owner: { id: 'u2', email: 'ana@kinaxis.com' },
  access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u1', 'u5', 'u6'] },
  capabilities: READER_CAPS,
};
const orgWide = {
  label: 'brand-voice', slug: 'brand-voice', description: 'Org.', isBuiltin: false, enabled: true,
  section: 'org', can_edit: false, owner: { id: 'u3', email: 'admin@kinaxis.com' },
  access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }, capabilities: READER_CAPS,
};
const teamSkill = {
  label: 'team-playbook', slug: 'team-playbook', description: 'Team.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: false, owner: { id: 'u4', email: 'lead@kinaxis.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-supply'], allowedUserIds: [], alwaysOn: true }, capabilities: READER_CAPS,
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
const RECIPIENTS = 'Add teams or people';
async function pickSpecificTeam(user, dialog, team = /Supply Planning/) {
  await user.click(within(dialog).getByRole('radio', { name: /^Specific teams and people/ }));
  await user.click(within(dialog).getByRole('combobox', { name: RECIPIENTS }));
  await user.click(await within(dialog).findByRole('option', { name: team }));
}
async function pickSpecificPerson(user, dialog, query, person) {
  await user.click(within(dialog).getByRole('radio', { name: /^Specific teams and people/ }));
  await user.type(within(dialog).getByRole('combobox', { name: RECIPIENTS }), query);
  await user.click(await within(dialog).findByRole('option', { name: person }));
}

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
    await renderPage([mine, orgWide, teamSkill, { ...orgWide, label: 'legal-checks', slug: 'legal-checks', access: { org_allowed: true, always_on: true } }]);

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
    api.setSkillAccess.mockResolvedValue({ ...mine });

    await user.click(screen.getByText('weekly-report'));
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog');
    // Shared with a team: Specific, with its pill.
    expect(within(dialog).getByRole('radio', { name: /^Specific teams and people/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('radio', { name: /^Only me/ }));
    const loads = api.fetchSkills.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith('weekly-report', { org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false }));
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

    it('puts the form on the left and Project and Who can use it in the side column', async () => {
      const user = userEvent.setup();
      const dialog = await openWriteForm(user);

      const main = within(dialog).getByTestId('skill-modal-main');
      const side = within(dialog).getByRole('complementary', { name: 'Skill settings' });
      for (const name of ['Label', 'Description', 'Instructions']) {
        expect(within(main).getByRole('textbox', { name })).toBeInTheDocument();
        expect(within(side).queryByRole('textbox', { name })).toBeNull();
      }
      expect(within(side).getByRole('combobox', { name: 'Project' })).toBeInTheDocument();
      const group = within(side).getByRole('group', { name: 'Who can use it' });
      expect(within(group).getByRole('radio', { name: /^Only me/ })).toHaveAttribute('aria-checked', 'true');
      expect(within(main).queryByRole('group', { name: 'Who can use it' })).toBeNull();
      expect(within(dialog).queryByRole('combobox', { name: 'Who can use it' })).toBeNull();
      // Main column first, so a narrow window stacks it above the settings.
      expect(main.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Instructions grow to fill the column on a wide window.
      expect(within(main).getByRole('textbox', { name: 'Instructions' }).className).toContain('min-[720px]:flex-1');
    });

    it('badges a skill shared with the default team as Everyone at the org', async () => {
      api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [{ id: 't-all', display_name: 'All members', is_default: true }, SUPPLY] });
      vi.resetModules();
      api.fetchSkills.mockResolvedValue({ skills: [{ ...mine, access: { orgAllowed: false, allowedTeamIds: ['t-all'], allowedUserIds: [] } }], canShare: false });
      api.fetchSkillSharingCapabilities.mockResolvedValue({ enabled: true, can_share_org: false, org_name: 'Kinaxis' });
      const { default: SkillsView } = await import('./SkillsView');
      render(<SkillsView />);
      const row = () => screen.getByRole('article', { name: 'weekly-report' });

      await waitFor(() => expect(within(row()).getByText('Everyone at Kinaxis')).toBeInTheDocument());
      expect(within(row()).queryByText('1 team')).toBeNull();
    });

    it('disables Everyone at the org without can_share_org', async () => {
      const user = userEvent.setup();
      const dialog = await openWriteForm(user);

      expect(within(dialog).getByRole('radio', { name: /^Everyone at Kinaxis/ })).toHaveAttribute('aria-disabled', 'true');
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
      expect(api.setSkillAccess).not.toHaveBeenCalled();
    });

    it('creates the skill, then shares it with the picked org audience by its slug', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill-slug' });
      api.setSkillAccess.mockResolvedValue({});
      const dialog = await openWriteForm(user, [mine], ADMIN_CAPS);

      await user.click(within(dialog).getByRole('radio', { name: /^Everyone at Kinaxis/ }));
      await user.click(within(dialog).getByRole('switch', { name: 'Always include in every task' }));
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith(
        'new-skill-slug', { org_allowed: true, allowed_team_ids: [], allowed_user_ids: [], always_on: true },
      ));
      expect(api.saveSkill.mock.invocationCallOrder[0]).toBeLessThan(api.setSkillAccess.mock.invocationCallOrder[0]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('lets the creator make a new team skill always on', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAccess.mockResolvedValue({});
      const dialog = await openWriteForm(user);

      await pickSpecificTeam(user, dialog);
      const alwaysOn = within(dialog).getByRole('switch', { name: 'Always include in every task' });
      expect(alwaysOn).not.toBeDisabled();
      await user.click(alwaysOn);
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith(
        'new-skill', { org_allowed: false, allowed_team_ids: ['t-supply'], allowed_user_ids: [], always_on: true },
      ));
    });

    it('shares a new skill with people picked from the org', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAccess.mockResolvedValue({});
      api.searchHubPeople.mockResolvedValue({ reachable: true, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@kinaxis.com' }] });
      const dialog = await openWriteForm(user);

      await pickSpecificPerson(user, dialog, 'ana', /Ana Ruiz/);
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith(
        'new-skill', { org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u2'], always_on: false },
      ));
    });

    it("shows the server's refusal of someone outside the org inline", async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAccess.mockRejectedValueOnce(Object.assign(
        new Error('Skills can only be shared with people in your organization: ana@kinaxis.com'), { status: 400 },
      ));
      api.searchHubPeople.mockResolvedValue({ reachable: true, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@kinaxis.com' }] });
      const dialog = await openWriteForm(user);

      await pickSpecificPerson(user, dialog, 'ana', /Ana Ruiz/);
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await within(dialog).findByText(/Skills can only be shared with people in your organization: ana@kinaxis.com/))
        .toBeInTheDocument();
    });

    it('keeps the dialog open with an inline note when sharing fails after the create', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAccess.mockRejectedValueOnce(new Error('Team not found'));
      const dialog = await openWriteForm(user);

      await pickSpecificTeam(user, dialog);
      const loads = api.fetchSkills.mock.calls.length;
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await within(dialog).findByText(
        "Skill created, but it couldn't be shared: Team not found. You can share it from the skill's menu.",
      )).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(api.deleteSkill).not.toHaveBeenCalled();
      await waitFor(() => expect(api.fetchSkills.mock.calls.length).toBeGreaterThan(loads + 1));

      // A retry shares the existing skill; it never creates a second one.
      api.setSkillAccess.mockResolvedValueOnce({});
      await user.click(within(dialog).getByRole('button', { name: 'Retry sharing' }));
      await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledTimes(2));
      expect(api.saveSkill).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });
});
