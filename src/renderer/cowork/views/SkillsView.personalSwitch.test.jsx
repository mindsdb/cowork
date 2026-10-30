import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* ENG-3787: the switch "just for me", "Disable/Enable for everyone", the
   folded Built-in section and the Edit dialog's "Who can use it", through
   the real skills store; only HTTP is mocked. */
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

const OWNER_CAPS = { canEdit: true, canDelete: true, canDisable: true, canShare: true };
// A team member who edits a team skill they don't own: no say in its audience.
const EDITOR_CAPS = { canEdit: true, canDelete: true, canDisable: true, canShare: false };
const READER_CAPS = { canEdit: false, canDelete: false, canDisable: false };
const PLATFORM = { id: 't-platform', display_name: 'Platform' };
const BUILTIN_KEY = 'anton:skills-builtin-open';

const TURN_OFF_FOR_ME = "Turn off for me: Anton won't use this skill in your tasks";
const TURN_ON_FOR_ME = 'Turn on for me: Anton can use this skill in your tasks';
const DISABLED_HINT = 'Disabled for everyone by an editor';

const privateOwn = {
  label: 'daily-notes', slug: 'daily-notes', description: 'Private.', declarative: 'Take notes.', isBuiltin: false, enabled: true,
  section: 'mine', can_edit: true, owner: { id: 'u1', email: 'me@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, capabilities: OWNER_CAPS,
  enabledForMe: true, canDisableForEveryone: true, visibleToOthers: false,
};
const ownShared = {
  label: 'weekly-report', slug: 'weekly-report', description: 'Mine, shared.', declarative: 'Report.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: true, owner: { id: 'u1', email: 'me@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: ['u5'] }, capabilities: OWNER_CAPS,
  enabledForMe: true, canDisableForEveryone: true, visibleToOthers: true,
};
const teamEdited = {
  label: 'team-runbook', slug: 'team-runbook', description: 'Team, edited by its members.', declarative: 'Run.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: true, owner: { id: 'u4', email: 'lead@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [], alwaysOn: true }, capabilities: EDITOR_CAPS,
  enabledForMe: true, canDisableForEveryone: true, visibleToOthers: true,
};
const fromColleague = {
  label: 'forecast-review', slug: 'forecast-review', description: 'Theirs.', isBuiltin: false, enabled: true,
  section: 'shared_with_me', can_edit: false, owner: { id: 'u2', email: 'ana@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u1'] }, capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const teamSkill = {
  label: 'team-playbook', slug: 'team-playbook', description: 'Team.', isBuiltin: false, enabled: true,
  section: 'team', can_edit: false, owner: { id: 'u4', email: 'lead@acme.com' },
  access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] }, capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const orgWide = {
  label: 'brand-voice', slug: 'brand-voice', description: 'Org.', isBuiltin: false, enabled: true,
  section: 'org', can_edit: false, owner: { id: 'u3', email: 'admin@acme.com' },
  access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] }, capabilities: READER_CAPS,
  enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};
const builtin = {
  label: 'skill-creator', description: 'Built in.', isBuiltin: true, enabled: true,
  capabilities: READER_CAPS, enabledForMe: true, canDisableForEveryone: false, visibleToOthers: true,
};

const CAPS = { enabled: true, can_share_org: false, org_name: 'Acme' };

async function renderPage(skills, capabilities = CAPS) {
  vi.resetModules();
  api.fetchSkills.mockResolvedValue({ skills, canShare: false });
  api.fetchSkillSharingCapabilities.mockResolvedValue(capabilities);
  api.fetchHubTeams.mockResolvedValue({ reachable: true, teams: [PLATFORM] });
  const { default: SkillsView } = await import('./SkillsView');
  const view = render(<SkillsView />);
  await screen.findByRole('heading', { name: 'Skills' });
  await waitFor(() => expect(api.fetchSkills).toHaveBeenCalled());
  // With org sharing the list regroups by section once its capabilities
  // land; wait for that so a row isn't replaced under a click.
  if (capabilities.enabled) {
    await waitFor(() => expect(
      screen.queryAllByRole('region').some((r) => r.getAttribute('aria-label') !== 'Built-in'),
    ).toBe(true));
  }
  return { ...view, SkillsView };
}

const row = (label) => screen.getByRole('article', { name: label });
const builtinToggle = () => screen.getByRole('button', { name: /^Built-in/ });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem(BUILTIN_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the switch just for me', () => {
  it.each([
    ['a skill shared with the caller', fromColleague],
    ['a team skill', teamSkill],
    ['an org-wide skill', orgWide],
    ["the caller's own shared skill", ownShared],
  ])('turns %s off for the caller alone', async (_, skill) => {
    const user = userEvent.setup();
    await renderPage([skill]);
    api.setSkillEnabledForMe.mockResolvedValue({ ...skill, enabledForMe: false });
    api.fetchSkills.mockResolvedValue({ skills: [{ ...skill, enabledForMe: false }], canShare: false });

    await user.click(within(await screen.findByRole('article', { name: skill.label })).getByRole('switch', { name: TURN_OFF_FOR_ME }));

    await waitFor(() => expect(api.setSkillEnabledForMe).toHaveBeenCalledWith(skill.slug, false));
    expect(api.saveSkill).not.toHaveBeenCalled();
    await waitFor(() => expect(within(row(skill.label)).getByRole('switch', { name: TURN_ON_FOR_ME }))
      .toHaveAttribute('aria-checked', 'false'));
  });

  it('turns a built-in off for the caller alone, from the folded section', async () => {
    const user = userEvent.setup();
    await renderPage([privateOwn, builtin]);
    await screen.findByRole('article', { name: 'daily-notes' });
    api.setSkillEnabledForMe.mockResolvedValue({ ...builtin, enabledForMe: false });

    await user.click(builtinToggle());
    await user.click(within(row('skill-creator')).getByRole('switch', { name: TURN_OFF_FOR_ME }));

    await waitFor(() => expect(api.setSkillEnabledForMe).toHaveBeenCalledWith('skill-creator', false));
    expect(api.saveSkill).not.toHaveBeenCalled();
  });

  it("turns the caller's own private skill off for everyone, as before", async () => {
    const user = userEvent.setup();
    await renderPage([privateOwn]);
    api.saveSkill.mockResolvedValue({ ...privateOwn, enabled: false });

    const toggle = within(await screen.findByRole('article', { name: 'daily-notes' }))
      .getByRole('switch', { name: "Turn off: Anton won't use this skill" });
    expect(toggle).toHaveAttribute('title', "Turn off: Anton won't use this skill");
    await user.click(toggle);

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledWith({ label: 'daily-notes', enabled: false }, true));
    expect(api.setSkillEnabledForMe).not.toHaveBeenCalled();
  });

  it('says what flipping it does for the caller, on and off', async () => {
    await renderPage([ownShared, { ...teamSkill, enabledForMe: false }]);

    const on = within(await screen.findByRole('article', { name: 'weekly-report' })).getByRole('switch');
    expect(on).toHaveAttribute('aria-checked', 'true');
    expect(on).toHaveAttribute('title', TURN_OFF_FOR_ME);
    const off = within(row('team-playbook')).getByRole('switch');
    expect(off).toHaveAttribute('aria-checked', 'false');
    expect(off).toHaveAttribute('title', TURN_ON_FOR_ME);
    expect(off).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('moves back and shows the refusal when the change fails', async () => {
    const user = userEvent.setup();
    await renderPage([teamSkill]);
    let reject;
    api.setSkillEnabledForMe.mockReturnValue(new Promise((_, r) => { reject = r; }));

    await user.click(within(await screen.findByRole('article', { name: 'team-playbook' })).getByRole('switch', { name: TURN_OFF_FOR_ME }));
    // Moves at once.
    expect(within(row('team-playbook')).getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    reject(new Error('Skill not found'));
    await waitFor(() => expect(within(row('team-playbook')).getByRole('switch')).toHaveAttribute('aria-checked', 'true'));
    expect(toast.add).toHaveBeenCalledWith({ title: 'Skill not found', type: 'danger' });
  });

  it('rolls the detail header switch back too', async () => {
    const user = userEvent.setup();
    await renderPage([orgWide]);
    api.setSkillEnabledForMe.mockRejectedValue(new Error('Nope'));

    await user.click(await screen.findByText('brand-voice'));
    await user.click(screen.getByRole('switch', { name: TURN_OFF_FOR_ME }));

    await waitFor(() => expect(toast.add).toHaveBeenCalledWith({ title: 'Nope', type: 'danger' }));
    expect(screen.getByRole('switch', { name: TURN_OFF_FOR_ME })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('disabled for everyone', () => {
  it('rests the switch off and locked, and badges the row for every viewer', async () => {
    const user = userEvent.setup();
    await renderPage([{ ...teamSkill, enabled: false }, { ...ownShared, enabled: false }]);

    for (const label of ['team-playbook', 'weekly-report']) {
      const r = await screen.findByRole('article', { name: label });
      const toggle = within(r).getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(toggle).toHaveAttribute('aria-disabled', 'true');
      expect(toggle).toHaveAttribute('title', DISABLED_HINT);
      expect(within(r).getByText('Disabled for everyone')).toBeInTheDocument();
    }

    await user.click(screen.getByText('team-playbook'));
    const header = screen.getByTestId('skill-detail-header');
    expect(within(header).getByText('Disabled for everyone')).toBeInTheDocument();
    const toggle = within(header).getByRole('switch');
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(toggle).toHaveAttribute('title', DISABLED_HINT);
    await user.click(toggle);
    expect(api.setSkillEnabledForMe).not.toHaveBeenCalled();
  });

  it("keeps the plain Disabled badge on the caller's own private skill", async () => {
    await renderPage([{ ...privateOwn, enabled: false }]);

    const r = await screen.findByRole('article', { name: 'daily-notes' });
    expect(within(r).getByText('Disabled')).toBeInTheDocument();
    expect(within(r).queryByText('Disabled for everyone')).toBeNull();
    expect(within(r).getByRole('switch')).not.toHaveAttribute('aria-disabled', 'true');
  });
});

describe('the ⋯ menu: Disable or Enable for everyone', () => {
  async function openMenu(user, label) {
    await user.click(within(await screen.findByRole('article', { name: label })).getByRole('button', { name: `More actions for ${label}` }));
  }

  it('asks before turning a shared skill off for everyone, then turns it off', async () => {
    const user = userEvent.setup();
    await renderPage([ownShared]);
    api.saveSkill.mockResolvedValue({ ...ownShared, enabled: false });

    await openMenu(user, 'weekly-report');
    await user.click(await screen.findByRole('menuitem', { name: /Disable for everyone/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent("Turn off weekly-report for everyone it's shared with?");
    expect(api.saveSkill).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Disable for everyone' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledWith({ label: 'weekly-report', enabled: false }, true));
    expect(api.setSkillEnabledForMe).not.toHaveBeenCalled();
  });

  it('turns nothing off when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    await renderPage([teamEdited]);

    await openMenu(user, 'team-runbook');
    await user.click(await screen.findByRole('menuitem', { name: /Disable for everyone/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(api.saveSkill).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('turns it back on for everyone without asking', async () => {
    const user = userEvent.setup();
    await renderPage([{ ...ownShared, enabled: false }]);
    api.saveSkill.mockResolvedValue({ ...ownShared, enabled: true });

    await openMenu(user, 'weekly-report');
    expect(screen.queryByRole('menuitem', { name: /Disable for everyone/ })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: /Enable for everyone/ }));

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledWith({ label: 'weekly-report', enabled: true }, true));
  });

  it.each([
    ['a skill the caller cannot edit', teamSkill],
    ['a skill shared with the caller', fromColleague],
    ["the caller's own private skill", privateOwn],
  ])('is not offered on %s', async (_, skill) => {
    const user = userEvent.setup();
    await renderPage([skill]);

    await openMenu(user, skill.label);

    expect(await screen.findByRole('menuitem', { name: /Try in chat/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /for everyone/ })).toBeNull();
  });
});

describe('the Built-in section', () => {
  it('sits last, folded by default, and says how many it holds', async () => {
    await renderPage([privateOwn, builtin, { ...builtin, label: 'pdf' }]);
    await screen.findByRole('article', { name: 'daily-notes' });

    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions[regions.length - 1]).toBe('Built-in');
    expect(builtinToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(builtinToggle()).toHaveTextContent('Built-in· 2');
    expect(screen.queryByRole('article', { name: 'skill-creator' })).toBeNull();
  });

  it('remembers that it was opened', async () => {
    const user = userEvent.setup();
    const { unmount, SkillsView } = await renderPage([privateOwn, builtin]);
    await screen.findByRole('article', { name: 'daily-notes' });

    await user.click(builtinToggle());
    expect(builtinToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(row('skill-creator')).toBeInTheDocument();
    expect(localStorage.getItem(BUILTIN_KEY)).toBe('true');

    unmount();
    render(<SkillsView />);
    // Grouped once the org's sharing capabilities are known.
    await screen.findByRole('region', { name: 'Yours' });
    expect(row('skill-creator')).toBeInTheDocument();
    expect(builtinToggle()).toHaveAttribute('aria-expanded', 'true');

    await user.click(builtinToggle());
    expect(screen.queryByRole('article', { name: 'skill-creator' })).toBeNull();
    expect(localStorage.getItem(BUILTIN_KEY)).toBe('false');
  });

  it('still opens where storage refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    await renderPage([privateOwn, builtin]);
    await screen.findByRole('article', { name: 'daily-notes' });

    expect(builtinToggle()).toHaveAttribute('aria-expanded', 'false');
    await user.click(builtinToggle());
    expect(row('skill-creator')).toBeInTheDocument();
  });

  it('folds the built-ins away on the flat list too', async () => {
    const user = userEvent.setup();
    await renderPage([privateOwn, builtin], { enabled: false });
    await screen.findByRole('article', { name: 'daily-notes' });

    expect(screen.queryByRole('article', { name: 'skill-creator' })).toBeNull();
    await user.click(builtinToggle());
    expect(row('skill-creator')).toBeInTheDocument();
  });
});

describe('the Edit dialog: who can use it', () => {
  async function openEdit(user, skill, capabilities) {
    await renderPage([skill], capabilities);
    await user.click(await screen.findByText(skill.label));
    await user.click(screen.getByRole('button', { name: `Edit ${skill.label}` }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Edit Skill');
    return dialog;
  }
  const side = (dialog) => within(dialog).getByRole('complementary', { name: 'Skill settings' });

  it('shows Project then Who can use it in the side column, at the skill\'s audience', async () => {
    const user = userEvent.setup();
    api.fetchHubPeopleByIds.mockResolvedValue({ reachable: true, people: [{ id: 'u5', name: 'Bea Ortiz', email: 'bea@acme.com' }] });
    const dialog = await openEdit(user, ownShared);

    const column = side(dialog);
    const project = within(column).getByRole('combobox', { name: 'Project' });
    const group = within(column).getByRole('group', { name: 'Who can use it' });
    expect(project.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole('radio', { name: /^Specific teams and people/ })).toHaveAttribute('aria-checked', 'true');
    expect(await within(group).findByText('Platform')).toBeInTheDocument();
    expect(await within(group).findByText('Bea Ortiz')).toBeInTheDocument();
    expect(within(dialog).getByTestId('skill-modal-main')).toBeInTheDocument();
    expect(within(column).queryByText('Only the owner can change who can use it')).toBeNull();
  });

  it('saves the skill alone when who can use it is unchanged', async () => {
    const user = userEvent.setup();
    api.saveSkill.mockResolvedValue({ ...ownShared });
    const dialog = await openEdit(user, ownShared);

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.setSkillAccess).not.toHaveBeenCalled();
  });

  it('saves the skill, then the changed audience', async () => {
    const user = userEvent.setup();
    api.saveSkill.mockResolvedValue({ ...ownShared });
    api.setSkillAccess.mockResolvedValue({ ...ownShared, section: 'mine', access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] } });
    const dialog = await openEdit(user, ownShared);

    await user.click(within(dialog).getByRole('radio', { name: /^Only me/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith(
      'weekly-report', { org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false },
    ));
    expect(api.saveSkill.mock.invocationCallOrder[0]).toBeLessThan(api.setSkillAccess.mock.invocationCallOrder[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(toast.add).toHaveBeenCalledWith({ title: 'Saved weekly-report and updated who can use it.', type: 'success' });
  });

  it('sends a changed always-on alone', async () => {
    const user = userEvent.setup();
    const teamOnly = { ...ownShared, access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] } };
    api.saveSkill.mockResolvedValue({ ...teamOnly });
    api.setSkillAccess.mockResolvedValue({});
    const dialog = await openEdit(user, teamOnly);

    await user.click(within(dialog).getByRole('switch', { name: 'Always include in every task' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledWith(
      'weekly-report', { org_allowed: false, allowed_team_ids: ['t-platform'], allowed_user_ids: [], always_on: true },
    ));
  });

  it('shows the audience read-only, with why, to someone who edits but does not own the skill', async () => {
    const user = userEvent.setup();
    api.saveSkill.mockResolvedValue({ ...teamEdited });
    const dialog = await openEdit(user, teamEdited);

    const group = within(side(dialog)).getByRole('group', { name: 'Who can use it' });
    expect(within(group).queryByRole('radio')).toBeNull();
    expect(await within(group).findByText('Platform')).toBeInTheDocument();
    expect(within(group).getByText("Part of every task for everyone it's shared with")).toBeInTheDocument();
    expect(within(side(dialog)).getByText('Only the owner can change who can use it')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.saveSkill).toHaveBeenCalledTimes(1));
    expect(api.setSkillAccess).not.toHaveBeenCalled();
  });

  it('reads Everyone at the org read-only', async () => {
    const user = userEvent.setup();
    const orgEdited = { ...teamEdited, section: 'org', access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] } };
    const dialog = await openEdit(user, orgEdited, { ...CAPS, can_write_org: true });

    expect(within(side(dialog)).getByText('Everyone at Acme')).toBeInTheDocument();
    expect(within(side(dialog)).getByText('Only the owner can change who can use it')).toBeInTheDocument();
  });

  it('lets an admin change the audience of a skill they do not own', async () => {
    const user = userEvent.setup();
    // The server folds "owner or admin" into the skill's own canShare.
    const asAdmin = { ...teamEdited, capabilities: { ...teamEdited.capabilities, canShare: true } };
    const dialog = await openEdit(user, asAdmin, { ...CAPS, can_share_org: true });

    expect(within(side(dialog)).getByRole('radio', { name: /^Everyone at Acme/ })).not.toHaveAttribute('aria-disabled', 'true');
    expect(within(side(dialog)).queryByText('Only the owner can change who can use it')).toBeNull();
  });

  it('keeps the dialog open when sharing fails after the save, and retries only the sharing', async () => {
    const user = userEvent.setup();
    api.saveSkill.mockResolvedValue({ ...ownShared });
    api.setSkillAccess.mockRejectedValueOnce(new Error('Team not found'));
    const dialog = await openEdit(user, ownShared);

    await user.click(within(dialog).getByRole('radio', { name: /^Only me/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText("Skill saved, but sharing couldn't be updated: Team not found."))
      .toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    api.setSkillAccess.mockResolvedValueOnce({});
    await user.click(within(dialog).getByRole('button', { name: 'Retry sharing' }));
    await waitFor(() => expect(api.setSkillAccess).toHaveBeenCalledTimes(2));
    expect(api.setSkillAccess).toHaveBeenLastCalledWith(
      'weekly-report', { org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false },
    );
    expect(api.saveSkill).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
