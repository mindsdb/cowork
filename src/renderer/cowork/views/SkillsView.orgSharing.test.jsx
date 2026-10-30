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
  setSkillEnabledForMe: vi.fn(),
  uploadSkillFile: vi.fn(),
  fetchSkillSharingCapabilities: vi.fn(),
  fetchHubTeams: vi.fn(),
  fetchHubPeopleByIds: vi.fn(async () => ({ reachable: true, people: [] })),
  fetchHubDirectory: vi.fn(async () => ({ reachable: true, people: [], truncated: false })),
}));
const toast = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock('../api', () => api);
vi.mock('../components/ui/Toast', () => ({ useToastManager: () => toast }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

const OWNER_CAPS = { canEdit: true, canDelete: true, canDisable: true };
const READER_CAPS = { canEdit: false, canDelete: false, canDisable: false };
const PLATFORM = { id: 't-platform', display_name: 'Platform' };

const mine = {
  label: 'weekly-report', slug: 'weekly-report', description: 'Mine.', isBuiltin: false, enabled: true,
  // The caller's own, shared with a team: the server lists it under My teams.
  section: 'team', can_edit: true, owner: { id: 'u1', email: 'me@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] }, capabilities: OWNER_CAPS,
  enabledForMe: true, canDisableForEveryone: true, visibleToOthers: true,
};
const yours = {
  label: 'daily-notes', slug: 'daily-notes', description: 'Private.', isBuiltin: false, enabled: true,
  section: 'mine', can_edit: true, owner: { id: 'u1', email: 'me@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, capabilities: OWNER_CAPS,
  enabledForMe: true, canDisableForEveryone: true, visibleToOthers: false,
};
const fromColleague = {
  label: 'forecast-review', slug: 'forecast-review', description: 'Theirs.', isBuiltin: false, enabled: true,
  section: 'shared_with_me', can_edit: false, owner: { id: 'u2', email: 'ana@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u1', 'u5', 'u6'] },
  capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const orgWide = {
  label: 'brand-voice', slug: 'brand-voice', description: 'Org.', isBuiltin: false, enabled: true,
  section: 'org', can_edit: false, owner: { id: 'u3', email: 'admin@acme.com' },
  access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }, capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const teamSkill = {
  label: 'team-playbook', slug: 'team-playbook', description: 'Team.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: false, owner: { id: 'u4', email: 'lead@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [], alwaysOn: true }, capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const builtin = {
  label: 'skill-creator', description: 'Built in.', isBuiltin: true, enabled: true,
  capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};

async function renderPage(skills, capabilities = { enabled: true, can_share_org: false, org_name: 'Acme' }) {
  vi.resetModules();
  api.fetchSkills.mockResolvedValue({ skills, canShare: false });
  api.fetchSkillSharingCapabilities.mockResolvedValue(capabilities);
  api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [PLATFORM] });
  const { default: SkillsView } = await import('./SkillsView');
  render(<SkillsView />);
  await screen.findByText(skills[0].label);
}

const section = (name) => screen.queryByRole('region', { name });
const RECIPIENTS = 'Add teams or people';
async function pickSpecificTeam(user, dialog, team = /Platform/) {
  await user.click(within(dialog).getByRole('radio', { name: /^Specific teams and people/ }));
  await user.click(within(dialog).getByRole('combobox', { name: RECIPIENTS }));
  // The suggestions float over the page, outside the dialog.
  await user.click(await screen.findByRole('option', { name: team }));
}
async function pickSpecificPerson(user, dialog, query, person) {
  await user.click(within(dialog).getByRole('radio', { name: /^Specific teams and people/ }));
  await user.type(within(dialog).getByRole('combobox', { name: RECIPIENTS }), query);
  await user.click(await screen.findByRole('option', { name: person }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('anton:skills-builtin-open');
});

describe('SkillsView with org sharing', () => {
  it('groups skills by section with counts, in page order', async () => {
    await renderPage([yours, mine, fromColleague, orgWide, builtin]);

    await waitFor(() => expect(section('Yours')).toBeInTheDocument());
    expect(within(section('Yours')).getByText('daily-notes')).toBeInTheDocument();
    // The caller's own skill shared with a team sits under My teams.
    expect(within(section('My teams')).getByText('weekly-report')).toBeInTheDocument();
    expect(within(section('Shared with me')).getByText('forecast-review')).toBeInTheDocument();
    expect(within(section('Everyone at Acme')).getByText('brand-voice')).toBeInTheDocument();
    // Built-in is folded until opened.
    expect(within(section('Built-in')).queryByText('skill-creator')).toBeNull();
    await userEvent.click(within(section('Built-in')).getByRole('button', { name: /^Built-in/ }));
    expect(within(section('Built-in')).getByText('skill-creator')).toBeInTheDocument();
    expect(within(section('Yours')).getByTestId('section-count')).toHaveTextContent('1');
    const order = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(order).toEqual(['Yours', 'Shared with me', 'My teams', 'Everyone at Acme', 'Built-in']);
  });

  it('shows only the sections that hold a skill', async () => {
    await renderPage([yours]);

    await waitFor(() => expect(section('Yours')).toBeInTheDocument());
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Yours']);
    expect(screen.queryByText(/No skills are shared/)).toBeNull();
  });

  it('keeps one empty state when there are no skills', async () => {
    vi.resetModules();
    api.fetchSkills.mockResolvedValue({ skills: [], canShare: false });
    api.fetchSkillSharingCapabilities.mockResolvedValue({ enabled: true, can_share_org: false, org_name: 'Acme' });
    api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [PLATFORM] });
    const { default: SkillsView } = await import('./SkillsView');
    render(<SkillsView />);

    expect(await screen.findByText('No saved skills yet')).toBeInTheDocument();
    expect(screen.queryAllByRole('region')).toEqual([]);
  });

  it('leaves sections without a match out while searching', async () => {
    const user = userEvent.setup();
    await renderPage([mine, fromColleague]);
    await waitFor(() => expect(section('Shared with me')).toBeInTheDocument());

    await user.type(screen.getByRole('textbox', { name: 'Search skills' }), 'weekly');
    expect(section('My teams')).toBeInTheDocument();
    expect(section('Shared with me')).toBeNull();
  });

  it('uses the shared collection header: title, subtitle and Create skill, then a search and sort row', async () => {
    const user = userEvent.setup();
    await renderPage([mine, fromColleague]);
    await waitFor(() => expect(section('Shared with me')).toBeInTheDocument());

    const title = screen.getByRole('heading', { level: 1, name: 'Skills' });
    const titleRow = title.parentElement.parentElement;
    expect(screen.getByText("Extend Cowork's capabilities with task-specific skills")).toBeInTheDocument();
    // Create skill is the header's primary action, on the title's line.
    const create = within(titleRow).getByRole('button', { name: /Create skill/ });
    // Search and sort sit in the toolbar row below, not in the header.
    const search = screen.getByRole('textbox', { name: 'Search skills' });
    expect(titleRow.contains(search)).toBe(false);
    expect(title.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
    expect(screen.getByText('2 skills')).toBeInTheDocument();

    await user.type(search, 'weekly');
    expect(screen.getByText('1 of 2 skills')).toBeInTheDocument();

    // The create menu keeps Write Skill Instructions first.
    await user.click(create);
    const items = await screen.findAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Write Skill Instructions');
  });

  it('focuses the search with ⌘K', async () => {
    const user = userEvent.setup();
    await renderPage([mine]);
    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('textbox', { name: 'Search skills' })).toHaveFocus();
  });

  it('gives each row its switch, Share and menu, with Share and the menu revealed on hover or focus', async () => {
    await renderPage([mine, teamSkill]);
    const row = await screen.findByRole('article', { name: 'weekly-report' });

    // Shared with a team, so its switch is the caller's own.
    const toggle = within(row).getByRole('switch', { name: "Turn off for me: Anton won't use this skill in your tasks" });
    expect(toggle).toHaveAttribute('title', "Turn off for me: Anton won't use this skill in your tasks");
    // Shared with a team: the action says Shared.
    expect(within(row).getByRole('button', { name: 'Shared: weekly-report' })).toHaveTextContent('Shared');
    expect(within(row).getByRole('button', { name: 'More actions for weekly-report' })).toBeInTheDocument();
    const reveal = within(row).getByTestId('skill-row-actions').className;
    expect(reveal).toContain('opacity-0');
    expect(reveal).toContain('group-hover/item:opacity-100');
    expect(reveal).toContain('group-focus-within/item:opacity-100');
    expect(reveal).toContain('[@media(hover:none)]:opacity-100');

    // A team skill someone else owns: a switch just for the caller, no lock.
    const team = screen.getByRole('article', { name: 'team-playbook' });
    expect(within(team).getByRole('switch', { name: /^Turn off for me:/ })).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(team).queryByTestId('skill-switch-locked')).toBeNull();
    expect(within(team).queryByRole('button', { name: /^Share/ })).toBeNull();
  });

  it('turns a private skill off for everyone from its row, and says Turn on after', async () => {
    const user = userEvent.setup();
    await renderPage([yours]);
    // Held in flight, so the switch shows the value asked for.
    api.saveSkill.mockReturnValue(new Promise(() => {}));
    const row = await screen.findByRole('article', { name: 'daily-notes' });

    await user.click(within(row).getByRole('switch', { name: "Turn off: Anton won't use this skill" }));
    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'daily-notes', enabled: false }), true,
    ));
    expect(api.setSkillEnabledForMe).not.toHaveBeenCalled();
    expect(within(row).getByRole('switch', { name: 'Turn on: Anton can use this skill' })).toBeInTheDocument();
    // The row stays a row: the switch never opens the skill.
    expect(screen.queryByTestId('skill-detail-header')).toBeNull();
  });

  it('no longer says team and org-wide sections are applied to every task', async () => {
    await renderPage([mine, orgWide, teamSkill]);

    await waitFor(() => expect(section('Everyone at Acme')).toBeInTheDocument());
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
    await waitFor(() => expect(within(row('team-playbook')).getByText('Team: Platform')).toBeInTheDocument());

    await user.hover(within(row('team-playbook')).getByText('Always on'));
    expect(await screen.findByText("Part of every task for everyone it's shared with")).toBeInTheDocument();
  });

  it('badges each row with its audience and names the owner of a skill shared with the caller', async () => {
    await renderPage([mine, fromColleague, orgWide]);

    const row = (label) => screen.getByRole('article', { name: label });
    await waitFor(() => expect(within(row('weekly-report')).getByText('Team: Platform')).toBeInTheDocument());
    expect(within(row('forecast-review')).getByText('3 people')).toBeInTheDocument();
    expect(within(row('forecast-review')).getByText('Shared by ana@acme.com')).toBeInTheDocument();
    expect(within(row('brand-voice')).getByText('Everyone at Acme')).toBeInTheDocument();
    expect(within(row('weekly-report')).queryByText(/Shared by/)).toBeNull();
  });

  it('keeps the flat list when sharing is off', async () => {
    await renderPage([mine, fromColleague], { enabled: false });

    expect(screen.getByText('forecast-review')).toBeInTheDocument();
    expect(section('Yours')).toBeNull();
    expect(screen.queryByText('Team: Platform')).toBeNull();
  });

  it('offers no Share, Edit or Uninstall on a skill the caller cannot edit', async () => {
    const user = userEvent.setup();
    await renderPage([orgWide]);
    await waitFor(() => expect(section('Everyone at Acme')).toBeInTheDocument());

    await user.click(screen.getByText('brand-voice'));
    await user.click(screen.getByRole('button', { name: /more/i }));

    expect(screen.getByRole('menuitem', { name: /Try in chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Edit/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Uninstall/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    // Nor turn it off for everyone; only for the caller.
    expect(screen.queryByRole('menuitem', { name: /for everyone/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /^Turn (on|off):/ })).toBeNull();
    expect(screen.getByRole('switch', { name: /^Turn off for me:/ })).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent("Shared by admin@acme.com. You can use it but can't change it.");
  });

  it('says an always-on team skill is part of every task, and offers the switch just for the caller', async () => {
    const user = userEvent.setup();
    await renderPage([teamSkill]);
    await waitFor(() => expect(section('My teams')).toBeInTheDocument());

    await user.click(screen.getByText('team-playbook'));

    expect(screen.getByRole('switch', { name: /^Turn off for me:/ })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('note')).toHaveTextContent("It's part of every task, and only its owner can change it.");
  });

  it('shares the caller\'s own skill through the dialog and moves it to Yours', async () => {
    const user = userEvent.setup();
    await renderPage([mine]);
    await waitFor(() => expect(section('My teams')).toBeInTheDocument());
    const privateNow = { ...mine, section: 'mine', access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] } };
    api.setSkillAccess.mockResolvedValue(privateNow);
    api.fetchSkills.mockResolvedValue({ skills: [privateNow], canShare: false });

    await user.click(screen.getByText('weekly-report'));
    await user.click(screen.getByRole('button', { name: 'Shared' }));
    const dialog = await screen.findByRole('dialog');
    // An anchored dropdown, not a modal.
    expect(within(dialog).getByText('Who can use this skill')).toBeInTheDocument();
    // Shared with a team: Specific, with its pill.
    expect(within(dialog).getByRole('radio', { name: /^Specific teams and people/ })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(dialog).getByRole('radio', { name: /^Only me/ }));
    const loads = api.fetchSkills.mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith('weekly-report', { org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.fetchSkills.mock.calls.length).toBe(loads + 1);
    // The detail reads Only you, and back on the list it sits under Yours.
    await waitFor(() => expect(screen.getByTestId('skill-meta-audience')).toHaveTextContent('Shared withOnly you'));
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skills' }));
    expect(within(section('Yours')).getByText('weekly-report')).toBeInTheDocument();
    expect(section('My teams')).toBeNull();
  });

  it.each([
    ['Everyone at the org', 'org', { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }, 'Everyone at Acme'],
    ['a team', 'team', { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] }, 'My teams'],
  ])("moves the caller's own skill to its section as soon as it's shared with %s", async (_, newSection, access, title) => {
    const user = userEvent.setup();
    await renderPage([yours], { enabled: true, can_share_org: true, org_name: 'Acme' });
    await waitFor(() => expect(section('Yours')).toBeInTheDocument());
    // The PUT answers the new section; the reload after it never lands, so
    // only the answer can move the row.
    api.setSkillAccess.mockResolvedValue({ ...yours, section: newSection, access });
    api.fetchSkills.mockReturnValue(new Promise(() => {}));

    const row = screen.getByRole('article', { name: 'daily-notes' });
    await user.click(within(row).getByRole('button', { name: 'Share daily-notes' }));
    const dialog = await screen.findByRole('dialog');
    if (newSection === 'org') await user.click(within(dialog).getByRole('radio', { name: /^Everyone at Acme/ }));
    else await pickSpecificTeam(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Update' }));

    await waitFor(() => expect(section(title)).toBeInTheDocument());
    expect(within(section(title)).getByText('daily-notes')).toBeInTheDocument();
    expect(section('Yours')).toBeNull();
  });

  describe('the skill detail', () => {
    const properties = () => screen.getByTestId('skill-properties');

    it('puts the name, the description and Shared, Edit, the switch and the menu in the header', async () => {
      const user = userEvent.setup();
      await renderPage([mine]);
      await user.click(screen.getByText('weekly-report'));

      const header = screen.getByTestId('skill-detail-header');
      expect(within(header).getByRole('heading', { level: 1, name: 'weekly-report' })).toBeInTheDocument();
      expect(within(header).getByText('Mine.')).toBeInTheDocument();
      // The audience is said once, in the properties, not as a header badge.
      expect(within(header).queryByText(/Platform/)).toBeNull();
      const actions = within(header).getByRole('group', { name: 'Skill actions' });
      expect(within(actions).getByRole('button', { name: 'Shared' })).toBeInTheDocument();
      expect(within(actions).getByRole('button', { name: 'Edit weekly-report' })).toBeInTheDocument();
      expect(within(actions).getByRole('switch', { name: /^Turn off/ })).toBeInTheDocument();
      expect(within(actions).getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    });

    it('reads Share on a skill only its owner can use', async () => {
      const user = userEvent.setup();
      await renderPage([yours]);
      await user.click(screen.getByText('daily-notes'));
      const actions = screen.getByRole('group', { name: 'Skill actions' });
      expect(within(actions).getByRole('button', { name: 'Share' })).toBeInTheDocument();
      expect(within(actions).queryByRole('button', { name: 'Shared' })).toBeNull();
      expect(screen.getByTestId('skill-meta-audience')).toHaveTextContent('Only you');
    });

    it('lays the properties out on one borderless line: project, audience, owner, update', async () => {
      const user = userEvent.setup();
      await renderPage([{ ...mine, updatedAt: new Date(Date.now() - 3_600_000).toISOString() }]);
      await user.click(screen.getByText('weekly-report'));

      const terms = within(properties()).getAllByRole('term').map((t) => t.textContent);
      expect(terms).toEqual(['Project', 'Shared with', 'Owner', 'Updated']);
      expect(screen.getByTestId('skill-meta-project')).toHaveTextContent('All projects');
      expect(screen.getByTestId('skill-meta-audience')).toHaveTextContent('Platform');
      expect(screen.getByTestId('skill-meta-owner')).toHaveTextContent('OwnerYou');
      expect(screen.getByTestId('skill-meta-updated')).toHaveTextContent('1h ago');
      // No card, no nested list of rows.
      expect(properties().className).not.toMatch(/\bborder\b/);
      expect(screen.queryByRole('list', { name: 'Shared with' })).toBeNull();
    });

    it('says a list audience compactly, and opens the whole list on click', async () => {
      const user = userEvent.setup();
      api.fetchHubPeopleByIds.mockResolvedValue({ reachable: true, people: [
        { id: 'u7', name: 'Ana López', email: 'ana@acme.com' },
        { id: 'u8', name: 'Bo Chen', email: 'bo@acme.com' },
        { id: 'u9', name: 'Cy Diaz', email: 'cy@acme.com' },
      ] });
      await renderPage([{ ...mine, access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: ['u7', 'u8', 'u9'] } }]);
      await user.click(screen.getByText('weekly-report'));

      const summary = await screen.findByTestId('skill-audience-summary');
      await waitFor(() => expect(summary).toHaveTextContent('Platform, Ana López +2'));
      await user.click(summary);
      const list = await screen.findByRole('list', { name: 'Shared with' });
      expect(within(list).getByText('Platform')).toBeInTheDocument();
      expect(within(list).getByText('Cy Diaz')).toBeInTheDocument();
      expect(within(list).getByText('bo@acme.com')).toBeInTheDocument();
      // Read only: no way to remove anyone here.
      expect(within(list).queryByRole('button')).toBeNull();
    });

    it('names the owner of a skill shared with the caller, says Everyone at the org once, and offers no Edit', async () => {
      const user = userEvent.setup();
      await renderPage([orgWide]);
      await user.click(screen.getByText('brand-voice'));

      expect(screen.getByTestId('skill-meta-audience')).toHaveTextContent('Shared withEveryone at Acme');
      expect(screen.getAllByText('Everyone at Acme')).toHaveLength(1);
      expect(screen.queryByText('Anyone in your organization')).toBeNull();
      expect(screen.queryByTestId('skill-audience-summary')).toBeNull();
      expect(screen.getByTestId('skill-meta-owner')).toHaveTextContent('admin@acme.com');
      expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    });

    it('says Always on in the properties', async () => {
      const user = userEvent.setup();
      await renderPage([teamSkill]);
      await user.click(screen.getByText('team-playbook'));
      expect(screen.getByTestId('skill-meta-always-on')).toHaveTextContent('Always on');
    });

    it('renders the instructions as markdown with no card, and says when there are none', async () => {
      const user = userEvent.setup();
      await renderPage([{ ...mine, declarative: '## Steps\n\n1. Gather the numbers' }, { ...yours, declarative: '' }]);
      await user.click(screen.getByText('weekly-report'));
      expect(screen.getByRole('heading', { level: 2, name: 'Instructions' })).toBeInTheDocument();
      const body = screen.getByTestId('skill-instructions');
      expect(within(body).getByRole('heading', { name: 'Steps' })).toBeInTheDocument();
      expect(body.className).not.toMatch(/\bborder\b/);

      await user.click(screen.getByRole('button', { name: 'Skills' }));
      await user.click(screen.getByText('daily-notes'));
      expect(screen.getByTestId('skill-instructions-empty')).toHaveTextContent('This skill has no instructions yet.');
      expect(screen.getByRole('button', { name: 'Add instructions' })).toBeInTheDocument();
    });

    it("shows who it's shared with in the Shared button's tooltip", async () => {
      const user = userEvent.setup();
      await renderPage([{ ...mine, access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: ['u7', 'u8'] } }]);
      await user.click(screen.getByText('weekly-report'));
      await user.hover(screen.getByRole('button', { name: 'Shared' }));
      expect(await screen.findByText('Shared with 1 team and 2 people')).toBeInTheDocument();
    });
  });

  describe('creating a skill', () => {
    async function openWriteForm(user, skills = [mine], capabilities) {
      await renderPage(skills, capabilities);
      await waitFor(() => expect(section('My teams')).toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: /Create skill/i }));
      await user.click(await screen.findByRole('menuitem', { name: /Write Skill Instructions/i }));
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByRole('textbox', { name: 'Label' }), 'new-skill');
      await user.type(within(dialog).getByRole('textbox', { name: 'Instructions' }), 'Do it.');
      return dialog;
    }
    const ADMIN_CAPS = { enabled: true, can_share_org: true, org_name: 'Acme' };

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
      api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [{ id: 't-all', display_name: 'All members', is_default: true }, PLATFORM] });
      vi.resetModules();
      api.fetchSkills.mockResolvedValue({ skills: [{ ...mine, access: { orgAllowed: false, allowedTeamIds: ['t-all'], allowedUserIds: [] } }], canShare: false });
      api.fetchSkillSharingCapabilities.mockResolvedValue({ enabled: true, can_share_org: false, org_name: 'Acme' });
      const { default: SkillsView } = await import('./SkillsView');
      render(<SkillsView />);
      const row = () => screen.getByRole('article', { name: 'weekly-report' });

      await waitFor(() => expect(within(row()).getByText('Everyone at Acme')).toBeInTheDocument());
      expect(within(row()).queryByText('1 team')).toBeNull();
    });

    it('disables Everyone at the org without can_share_org', async () => {
      const user = userEvent.setup();
      const dialog = await openWriteForm(user);

      expect(within(dialog).getByRole('radio', { name: /^Everyone at Acme/ })).toHaveAttribute('aria-disabled', 'true');
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

      await user.click(within(dialog).getByRole('radio', { name: /^Everyone at Acme/ }));
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
        'new-skill', { org_allowed: false, allowed_team_ids: ['t-platform'], allowed_user_ids: [], always_on: true },
      ));
    });

    it('shares a new skill with people picked from the org', async () => {
      const user = userEvent.setup();
      api.saveSkill.mockResolvedValue({ label: 'new-skill', slug: 'new-skill' });
      api.setSkillAccess.mockResolvedValue({});
      api.fetchHubDirectory.mockResolvedValue({ reachable: true, truncated: false, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@acme.com' }] });
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
        new Error('Skills can only be shared with people in your organization: ana@acme.com'), { status: 400 },
      ));
      api.fetchHubDirectory.mockResolvedValue({ reachable: true, truncated: false, people: [{ id: 'u2', name: 'Ana Ruiz', email: 'ana@acme.com' }] });
      const dialog = await openWriteForm(user);

      await pickSpecificPerson(user, dialog, 'ana', /Ana Ruiz/);
      await user.click(within(dialog).getByRole('button', { name: 'Create' }));

      expect(await within(dialog).findByText(/Skills can only be shared with people in your organization: ana@acme.com/))
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
