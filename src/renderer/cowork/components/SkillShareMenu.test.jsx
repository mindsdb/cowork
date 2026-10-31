import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const teams = vi.hoisted(() => ({ state: { status: 'ready', reachable: true, teams: [] } }));
vi.mock('../hooks/useOrgSharing', async (importOriginal) => ({
  ...(await importOriginal()),
  useMindsHubTeams: () => teams.state,
}));
const people = vi.hoisted(() => ({ byIds: vi.fn(), directory: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMindsHubPeopleByIds: people.byIds,
  fetchMindsHubDirectory: people.directory,
}));

import SkillShareMenu from './SkillShareMenu';
import { __resetOrgSharingForTests } from '../hooks/useOrgSharing';

const PLATFORM = { id: 't-platform', display_name: 'Platform' };
const FINANCE = { id: 't-finance', display_name: 'Finance' };
const ALL_MEMBERS = { id: 't-all', display_name: 'All members', is_default: true };

const skill = (access, extra = {}) => ({ label: 'weekly-report', slug: 'weekly-report', canEdit: true, access, ...extra });
const ADMIN = { enabled: true, canShareSkillsOrg: true };
const MEMBER = { enabled: true, canShareSkillsOrg: false };

/* `orgName` is what the Skills page reads from the app's organization list
   (useSharingOrgName). */
async function renderDialog({ access = { orgAllowed: false, allowedTeamIds: [], allowedUserIds: [] }, capabilities = MEMBER, orgName = 'Acme', extra = {}, onSave = vi.fn(async () => {}) } = {}) {
  render(<SkillShareMenu skill={skill(access, extra)} capabilities={capabilities} orgName={orgName} onSave={onSave} trigger={<button type="button">Share</button>} />);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  const dialog = await screen.findByRole('dialog');
  return { onSave, dialog };
}

const radio = (dialog, name) => within(dialog).getByRole('radio', { name });
const ONLY_ME = /^Only me/;
const EVERYONE = /^Everyone at Acme/;
const SPECIFIC = /^Specific teams and people/;
const checked = (el) => expect(el).toHaveAttribute('aria-checked', 'true');
const field = (dialog) => within(dialog).getByRole('combobox', { name: 'Add teams or people' });
const save = (dialog) => within(dialog).getByRole('button', { name: 'Update' });
const upToDate = (dialog) => within(dialog).queryByText('Up to date');
const ALWAYS_ON = 'Always include in every task';
const alwaysOn = (dialog) => within(dialog).queryByRole('switch', { name: ALWAYS_ON });

// The suggestions float over the page, outside the dialog.
async function addTeam(user, dialog, name) {
  await user.click(field(dialog));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

const DIRECTORY = [
  { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' },
  { id: 'u-bo', name: 'Bo Chen', email: 'bo@acme.com' },
];

beforeEach(() => {
  __resetOrgSharingForTests();
  people.directory.mockReset();
  people.directory.mockImplementation(async () => ({ reachable: true, people: DIRECTORY, truncated: false }));
  people.byIds.mockReset();
  people.byIds.mockImplementation(async (ids) => ({
    reachable: true,
    people: DIRECTORY.filter((p) => ids.includes(p.id)),
  }));
  teams.state = { status: 'ready', reachable: true, teams: [PLATFORM, FINANCE] };
});

describe('SkillShareMenu', () => {
  it('offers Only me, Everyone at the org and Specific teams and people, in that order', async () => {
    const { dialog } = await renderDialog({ capabilities: ADMIN });
    const names = within(dialog).getAllByRole('radio').map((r) => r.textContent);
    expect(names).toEqual([
      'Only meNobody else can use it',
      'Everyone at AcmeAnyone in your organization',
      'Specific teams and peoplePick teams or colleagues',
    ]);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('starts on Only me for a private skill, with no extra note under the options', async () => {
    const { dialog } = await renderDialog();

    checked(radio(dialog, ONLY_ME));
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('note')).toBeNull();
  });

  it('disables Everyone at the org without canShareSkillsOrg, with the admin hint', async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog({ capabilities: MEMBER });

    expect(radio(dialog, EVERYONE)).toHaveAttribute('aria-disabled', 'true');
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText('Only admins can share with everyone in the organization')).toBeInTheDocument();
  });

  // With MindsHub unreachable "no" means "couldn't ask", never "only admins".
  it("locks Everyone at the org as MindsHub unreachable while it couldn't be asked", async () => {
    const user = userEvent.setup();
    const { dialog } = await renderDialog({ capabilities: { ...MEMBER, permissionsKnown: false } });

    expect(radio(dialog, EVERYONE)).toHaveAttribute('aria-disabled', 'true');
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText("Couldn't reach MindsHub")).toBeInTheDocument();
    expect(screen.queryByText('Only admins can share with everyone in the organization')).toBeNull();
  });

  // skills.share_org decides it, not artifacts.share_org.
  it('reads the skill capability, never the artifact one', async () => {
    const { dialog } = await renderDialog({ capabilities: { ...MEMBER, canShareArtifactsOrg: true } });

    expect(radio(dialog, EVERYONE)).toHaveAttribute('aria-disabled', 'true');
  });

  it('shares with everyone when canShareSkillsOrg allows it', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({ capabilities: ADMIN });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));

    expect(onSave).toHaveBeenCalledWith({ org_allowed: true, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('says Everyone in the organization when no org name is known', async () => {
    const { dialog } = await renderDialog({ capabilities: ADMIN, orgName: null });
    expect(radio(dialog, /^Everyone in the organization/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Everyone at/)).toBeNull();
  });

  it('unfolds the recipient field under Specific, and saves the picked teams', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    const editor = within(dialog).getByTestId('specific-recipients');
    expect(editor.parentElement).toContainElement(radio(dialog, SPECIFIC));
    await addTeam(user, dialog, 'Platform');
    await user.click(save(dialog));

    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: ['t-platform'], allowed_user_ids: [], always_on: false });
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

  it("doesn't list the org's default team: Everyone at the org is that choice", async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [ALL_MEMBERS, PLATFORM] };
    const { dialog } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.click(field(dialog));

    expect(await screen.findByRole('option', { name: /Platform/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /All members/ })).toBeNull();
  });

  it('shows a skill shared with the default team as Everyone at the org', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [ALL_MEMBERS, PLATFORM] };
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

    expect(screen.getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('picks people from the org and saves their user ids', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog();

    await user.click(radio(dialog, SPECIFIC));
    await user.type(field(dialog), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));

    expect(within(dialog).getByRole('list', { name: 'Recipients' })).toHaveTextContent('Ana Ruiz');
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

    expect(await screen.findByText('Only people in Acme')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Invite/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText(/Not added: zed@elsewhere.com/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Remove / })).toBeNull();
  });

  it("shows a stored id MindsHub doesn't know as Unknown person, which can be removed", async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({
      access: { orgAllowed: false, allowedTeamIds: [], allowedUserIds: ['u-bo', 'u-gone'] },
    });

    checked(radio(dialog, SPECIFIC));
    const picked = within(dialog).getByRole('list', { name: 'Recipients' });
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
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
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
    const picked = within(dialog).getByRole('list', { name: 'Recipients' });
    expect(picked).toHaveTextContent('Finance');
    // The stored id is named once MindsHub answers.
    await waitFor(() => expect(picked).toHaveTextContent('Bo Chen'));

    await user.click(radio(dialog, ONLY_ME));
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: [], allowed_user_ids: [], always_on: false });
  });

  it('reads access shared with everyone, with lists, as Everyone, keeping the lists for Specific', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = await renderDialog({
      capabilities: ADMIN,
      access: { orgAllowed: true, allowedTeamIds: ['t-finance'], allowedUserIds: [] },
    });

    checked(radio(dialog, EVERYONE));
    await user.click(radio(dialog, SPECIFIC));
    expect(within(dialog).getByRole('list', { name: 'Recipients' })).toHaveTextContent('Finance');
    await user.click(save(dialog));
    expect(onSave).toHaveBeenCalledWith({ org_allowed: false, allowed_team_ids: ['t-finance'], allowed_user_ids: [], always_on: false });
  });

  it("shows the server's refusal in place", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error("Sharing a skill with everyone in the organization requires the skills.share_org permission and being the skill's owner, or an organization admin."), { status: 403 });
    const { dialog } = await renderDialog({ capabilities: ADMIN, onSave: vi.fn(async () => { throw refusal; }) });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));

    await waitFor(() => expect(within(dialog).getByRole('alert'))
      .toHaveTextContent("Sharing a skill with everyone in the organization requires the skills.share_org permission and being the skill's owner, or an organization admin."));
  });

  describe('Always include in every task', () => {
    it('shows for Everyone, or for Specific once a team is picked', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({ capabilities: ADMIN });

      expect(alwaysOn(dialog)).toBeNull();
      await user.click(radio(dialog, SPECIFIC));
      expect(alwaysOn(dialog)).toBeNull();
      await user.type(field(dialog), 'ana');
      await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
      // People alone never make a skill always on.
      expect(alwaysOn(dialog)).toBeNull();

      await addTeam(user, dialog, 'Platform');
      expect(alwaysOn(dialog)).not.toBeChecked();
      expect(within(dialog).getByText("Anton will use this skill only when it's relevant.")).toBeInTheDocument();
      await user.click(alwaysOn(dialog));
      expect(within(dialog).getByText('Anton will include this skill in every task.')).toBeInTheDocument();
      await user.click(alwaysOn(dialog));

      await user.click(within(dialog).getByRole('button', { name: 'Remove Platform' }));
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

    it('pre-fills it from access.alwaysOn and sends it for a skill shared with everyone', async () => {
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
        access: { orgAllowed: false, allowedTeamIds: ['t-finance'], allowedUserIds: ['u-bo'], alwaysOn: true },
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

    it('is locked for a skill shared with everyone without canShareSkillsOrg, with the admin hint', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({
        capabilities: MEMBER,
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      expect(alwaysOn(dialog)).toBeChecked();
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only admins can make a skill shared with everyone always on')).toBeInTheDocument();
    });

    it("is locked for a skill shared with everyone as MindsHub unreachable while it couldn't be asked", async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({
        capabilities: { ...MEMBER, permissionsKnown: false },
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText("Couldn't reach MindsHub")).toBeInTheDocument();
    });

    it('is locked for a team skill the caller cannot edit, with the editor hint', async () => {
      const user = userEvent.setup();
      const { dialog } = await renderDialog({
        access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] },
        extra: { canEdit: false },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only people who can edit this skill can change this')).toBeInTheDocument();
    });

    it('is open on a team skill to a member who can edit it', async () => {
      const { dialog } = await renderDialog({ access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] } });

      expect(alwaysOn(dialog)).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByTestId('always-on-locked')).toBeNull();
    });

    // A teammate edits a team skill but only its owner or an admin changes
    // who it reaches; the server lists its people to them alone.
    it('is the whole dropdown for a team member who may not change the audience, and saves always_on alone', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = await renderDialog({
        access: { orgAllowed: false, allowedTeamIds: ['t-platform'], allowedUserIds: [] },
        extra: { capabilities: { canEdit: true, canShare: false } },
      });

      expect(within(dialog).queryByRole('radio')).toBeNull();
      expect(within(dialog).getByRole('note')).toHaveTextContent('Only its owner or an admin can change who can use it.');
      expect(alwaysOn(dialog)).not.toBeChecked();
      expect(upToDate(dialog)).toBeInTheDocument();
      await user.click(alwaysOn(dialog));
      await user.click(save(dialog));

      expect(onSave).toHaveBeenCalledWith({ always_on: true });
    });

    it('stays locked for such a member on a skill shared with everyone without canShareSkillsOrg', async () => {
      const { dialog } = await renderDialog({
        capabilities: MEMBER,
        access: { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], alwaysOn: true },
        extra: { capabilities: { canEdit: true, canShare: false } },
      });

      expect(within(dialog).queryByRole('radio')).toBeNull();
      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
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
    const refusal = Object.assign(new Error("Sharing a skill with everyone in the organization requires the skills.share_org permission and being the skill's owner, or an organization admin."), { status: 403 });
    const { dialog } = await renderDialog({ capabilities: ADMIN, onSave: vi.fn(async () => { throw refusal; }) });

    await user.click(radio(dialog, EVERYONE));
    await user.click(save(dialog));
    await waitFor(() => expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('Sharing a skill with everyone in the organization requires the skills.share_org permission'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
