import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const teams = vi.hoisted(() => ({ state: { status: 'ready', reachable: true, teams: [] } }));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useHubTeams: () => teams.state,
}));
const people = vi.hoisted(() => ({ search: vi.fn(), byIds: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  searchHubPeople: people.search,
  fetchHubPeopleByIds: people.byIds,
}));

import SkillShareMenu from './SkillShareMenu';

const SUPPLY = { id: 't-supply', display_name: 'Supply Planning' };
const FINANCE = { id: 't-finance', display_name: 'Finance' };
const ALL_MEMBERS = { id: 't-all', display_name: 'All members', is_default: true };

const skill = (access, extra = {}) => ({ label: 'weekly-report', slug: 'weekly-report', can_edit: true, access, ...extra });
const ADMIN = { enabled: true, can_share_org: true, org_name: 'Kinaxis' };
const MEMBER = { enabled: true, can_share_org: false, org_name: 'Kinaxis' };

async function renderDialog({ access = { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, capabilities = MEMBER, extra = {}, onSave = vi.fn(async () => {}) } = {}) {
  render(<SkillShareMenu skill={skill(access, extra)} capabilities={capabilities} onSave={onSave} trigger={<button type="button">Share</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = await screen.findByRole('dialog');
  return { onSave, dialog };
}

const radio = (dialog, name) => within(dialog).getByRole('radio', { name });
const ONLY_ME = /^Only me/;
const EVERYONE = /^Everyone at Kinaxis/;
const SPECIFIC = /^Specific teams and people/;
const checked = (el) => expect(el).toHaveAttribute('aria-checked', 'true');
const field = (dialog) => within(dialog).getByRole('combobox', { name: 'Add teams or people' });
const save = (dialog) => within(dialog).getByRole('button', { name: 'Update' });
const upToDate = (dialog) => within(dialog).queryByText('Up to date');
const ALWAYS_ON = 'Always include in every task';
const alwaysOn = (dialog) => within(dialog).queryByRole('switch', { name: ALWAYS_ON });

async function addTeam(user, dialog, name) {
  await user.click(field(dialog));
  await user.click(await within(dialog).findByRole('option', { name: new RegExp(name) }));
}

const DIRECTORY = [
  { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' },
  { id: 'u-bo', name: 'Bo Chen', email: 'bo@kinaxis.com' },
];

beforeEach(() => {
  people.byIds.mockReset();
  people.byIds.mockImplementation(async (ids) => ({
    reachable: true,
    people: DIRECTORY.filter((p) => ids.includes(p.id)),
  }));
  people.search.mockReset();
  people.search.mockImplementation(async (q) => ({
    reachable: true,
    people: [
      { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' },
      { id: 'u-bo', name: 'Bo Chen', email: 'bo@kinaxis.com' },
    ].filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())),
  }));
  teams.state = { status: 'ready', reachable: true, teams: [SUPPLY, FINANCE] };
});

describe('SkillShareMenu', () => {
  it('offers Only me, Everyone at the org and Specific teams and people, in that order', async () => {
    const { dialog } = await renderDialog({ capabilities: ADMIN });
    const names = within(dialog).getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual([
      'Only meNobody else can use it',
      'Everyone at KinaxisAnyone in your organization',
      'Specific teams and peoplePick teams or colleagues',
    ]);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('starts on Only me for a private skill and says shared skills are used when relevant', async () => {
    const { dialog } = await renderDialog();

    checked(radio(dialog, ONLY_ME));
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    const note = within(dialog).getByRole('note');
    expect(note).toHaveTextContent("Anton uses a shared skill when it's relevant to the task");
    expect(note).not.toHaveTextContent('automatically');
  });

  it('disables Everyone at the org without can_share_org, with the admin hint', async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog({ capabilities: MEMBER });

    expect(radio(dialog, EVERYONE)).toHaveAttribute('aria-disabled', 'true');
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText('Only admins can share with the whole organization')).toBeInTheDocument();
  });

  it('shares with the whole org when can_share_org allows it', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({ capabilities: ADMIN });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));

    expect(onSave).toHaveBeenCalledWith({ org_allowed: true, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('falls back to a generic org label without an org name', async () => {
    const { dialog } = await renderDialog({ capabilities: { ...ADMIN, org_name: null } });
    expect(radio(dialog, /^Everyone in your organization/)).toBeInTheDocument();
  });

  it('unfolds the recipient field under Specific, and saves the picked teams', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    const editor = within(dialog).getByTestId('specific-recipients');
    expect(editor.parentElement).toContainElement(radio(dialog, SPECIFIC));
    await addTeam(user, dialog, 'Supply Planning');
    await user.click(save(dialog));

    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: ['t-supply'], allowed_user_ids: [], always_on: false });
  });

  it('holds Update while Specific names nobody', async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog({ capabilities: ADMIN, access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [] } });

    await user.click(radio(dialog, SPECIFIC));
    expect(save(dialog)).toBeDisabled();
    expect(within(dialog).getByTestId('recipient-summary')).toHaveTextContent('Add at least one team or person.');
    await addTeam(user, dialog, 'Finance');
    expect(save(dialog)).not.toBeDisabled();
  });

  it('says so when the caller is in no teams', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [] };
    const { dialog } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.click(field(dialog));

    expect(within(dialog).getByText(/You're not in any teams yet\./)).toBeInTheDocument();
  });

  it("doesn't list the org's default team: Everyone at the org is that choice", async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [ALL_MEMBERS, SUPPLY] };
    const { dialog } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.click(field(dialog));

    expect(within(dialog).getByRole('option', { name: /Supply Planning/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /All members/ })).toBeNull();
  });

  it('shows a skill shared with the default team as Everyone at the org', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [ALL_MEMBERS, SUPPLY] };
    const { dialog, onSave } = await renderDialog({ access: { orgAllowed: false, allowedTeamIds: ['t-all'], allowedUserIds: [] }, capabilities: ADMIN });

    checked(radio(dialog, EVERYONE));
    // Only me drops the default team.
    await user.click(radio(dialog, ONLY_ME));
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('says so when the teams could not be loaded', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: false, teams: [] };
    const { dialog } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.click(field(dialog));

    expect(within(dialog).getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('picks people from the org and saves their user ids', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.type(field(dialog), 'ana');
    await user.click(await within(dialog).findByRole('option', { name: /Ana Ruiz/ }));

    expect(within(dialog).getByRole('group', { name: 'Recipients' })).toHaveTextContent('Ana Ruiz');
    // A picked person is never looked up again.
    expect(people.byIds).not.toHaveBeenCalled();
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u-ana'], always_on: false });
  });

  it('will not add a typed email from outside the org', async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.type(field(dialog), 'zed@elsewhere.com');

    expect(await within(dialog).findByText('Only people in Kinaxis')).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /Invite/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText(/Not added: zed@elsewhere.com/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it("shows a stored id the hub doesn't know as Unknown person, which can be removed", async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({
      access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u-bo', 'u-gone'] },
    });

    checked(radio(dialog, SPECIFIC));
    const picked = within(dialog).getByRole('group', { name: 'Recipients' });
    await waitFor(() => expect(picked).toHaveTextContent('Unknown person'));
    expect(picked).toHaveTextContent('Bo Chen');
    expect(people.byIds).toHaveBeenCalledTimes(1);
    expect(people.byIds).toHaveBeenCalledWith(['u-bo', 'u-gone']);

    await user.click(within(dialog).getByRole('button', { name: 'Remove Unknown person' }));
    expect(picked).not.toHaveTextContent('Unknown person');
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u-bo'], always_on: false });
  });

  it("shows the server's refusal of someone outside the org in place", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error('Skills can only be shared with people in your organization.'), { status: 400 });
    const { dialog } = await renderDialog({
      access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u-gone'] },
      onSave: vi.fn(async () => { throw refusal; }),
    });

    await user.type(field(dialog), 'ana');
    await user.click(await within(dialog).findByRole('option', { name: /Ana Ruiz/ }));
    await user.click(save(dialog));
    await waitFor(() => expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('Skills can only be shared with people in your organization.'));
  });

  it('pre-fills the current audience and clears it with Only me', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({
      access: { orgAllowed: false, allowedTeamIds: ['t-finance'], allowedUserIds: ['u-bo'] },
    });

    checked(radio(dialog, SPECIFIC));
    const picked = within(dialog).getByRole('group', { name: 'Recipients' });
    expect(picked).toHaveTextContent('Finance');
    // The stored id is named once the hub answers.
    await waitFor(() => expect(picked).toHaveTextContent('Bo Chen'));

    await user.click(radio(dialog, ONLY_ME));
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('reads org-wide access with lists as Everyone, keeping the lists for Specific', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({
      capabilities: ADMIN,
      access: { orgAllowed: true, allowedTeamIds: ['t-finance'], allowedUserIds: [] },
    });

    checked(radio(dialog, EVERYONE));
    await user.click(radio(dialog, SPECIFIC));
    expect(within(dialog).getByRole('group', { name: 'Recipients' })).toHaveTextContent('Finance');
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: ['t-finance'], allowed_user_ids: [], always_on: false });
  });

  it("shows the server's refusal in place", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error('Only admins can share skills with the whole organization.'), { status: 403 });
    const { dialog } = await renderDialog({ capabilities: ADMIN, onSave: vi.fn(async () => { throw refusal; }) });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));

    await waitFor(() => expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('Only admins can share skills with the whole organization.'));
  });

  describe('Always include in every task', () => {
    it('shows for Everyone, or for Specific once a team is picked', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({ capabilities: ADMIN });

      expect(alwaysOn(dialog)).toBeNull();
      await user.click(radio(dialog, SPECIFIC));
      expect(alwaysOn(dialog)).toBeNull();
      await user.type(field(dialog), 'ana');
      await user.click(await within(dialog).findByRole('option', { name: /Ana Ruiz/ }));
      // People alone never make a skill always on.
      expect(alwaysOn(dialog)).toBeNull();

      await addTeam(user, dialog, 'Supply Planning');
      expect(alwaysOn(dialog)).not.toBeChecked();
      expect(within(dialog).getByText("Off: Anton uses it when it's relevant. On: it's part of every task for everyone it's shared with."))
        .toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Remove Supply Planning' }));
      expect(alwaysOn(dialog)).toBeNull();
      await user.click(radio(dialog, EVERYONE));
      expect(alwaysOn(dialog)).toBeInTheDocument();
      await user.click(radio(dialog, ONLY_ME));
      expect(alwaysOn(dialog)).toBeNull();
    });

    it('sends always_on in the save for a team skill', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = await renderDialog();

      await user.click(radio(dialog, SPECIFIC));
      await addTeam(user, dialog, 'Finance');
      await user.click(alwaysOn(dialog));
      await user.click(save(dialog));

      expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: ['t-finance'], allowed_user_ids: [], always_on: true });
    });

    it('pre-fills it from access.alwaysOn and sends it for an org-wide skill', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = await renderDialog({
        capabilities: ADMIN,
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toBeChecked();
      // Nothing changed yet.
      expect(upToDate(dialog)).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: 'Update' })).toBeNull();
      await user.click(alwaysOn(dialog));
      await user.click(save(dialog));
      expect(onSave).toHaveBeenCalledWith({ org_allowed: true, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
    });

    it('resets to off once no team is left', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = await renderDialog({
        // The server may send access snake_case.
        access: { org_allowed: false, allowed_team_ids: ['t-finance'], allowed_user_ids: ['u-bo'], always_on: true },
      });

      expect(alwaysOn(dialog)).toBeChecked();
      await user.click(within(dialog).getByRole('button', { name: 'Remove Finance' }));
      expect(alwaysOn(dialog)).toBeNull();

      await addTeam(user, dialog, 'Finance');
      expect(alwaysOn(dialog)).not.toBeChecked();

      await user.click(within(dialog).getByRole('button', { name: 'Remove Finance' }));
      await user.click(save(dialog));
      expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: ['u-bo'], always_on: false });
    });

    it('resets to off with Only me', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = await renderDialog({
        capabilities: ADMIN,
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
      });

      await user.click(radio(dialog, ONLY_ME));
      expect(alwaysOn(dialog)).toBeNull();
      await user.click(save(dialog));
      expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
    });

    it('is locked for an org-wide skill without can_share_org, with the admin hint', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({
        capabilities: MEMBER,
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      expect(alwaysOn(dialog)).toBeChecked();
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only admins can make an organization-wide skill always on')).toBeInTheDocument();
    });

    it('is locked for a team skill the caller cannot edit, with the editor hint', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({
        access: { orgAllowed: false, allowedTeamIds: ['t-supply'], allowedUserIds: [] },
        extra: { can_edit: false },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only people who can edit this skill can change this')).toBeInTheDocument();
    });

    it('is open on a team skill to a member who can edit it', async () => {
      const { dialog } = await renderDialog({ access: { orgAllowed: false, allowedTeamIds: ['t-supply'], allowedUserIds: [] } });

      expect(alwaysOn(dialog)).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByTestId('always-on-locked')).toBeNull();
    });
  });
});

describe('SkillShareMenu as a dropdown', () => {
  it('opens anchored to its trigger, titled, and closes with Dismiss', async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog();

    expect(within(dialog).getByText('Who can use this skill')).toBeInTheDocument();
    expect(upToDate(dialog)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes after a successful update', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({ capabilities: ADMIN });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('stays open on a refusal and shows it in place', async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error('Only admins can share skills with the whole organization.'), { status: 403 });
    const { dialog } = await renderDialog({ capabilities: ADMIN, onSave: vi.fn(async () => { throw refusal; }) });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Only admins can share'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
