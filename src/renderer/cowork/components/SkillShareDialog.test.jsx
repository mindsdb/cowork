import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const teams = vi.hoisted(() => ({ state: { status: 'ready', reachable: true, teams: [] } }));
vi.mock('../hooks/useOrgSharing', () => ({ useHubTeams: () => teams.state }));

import SkillShareDialog from './SkillShareDialog';

const SUPPLY = { id: 't-supply', display_name: 'Supply Planning' };
const FINANCE = { id: 't-finance', display_name: 'Finance' };

const skill = (sharing, extra = {}) => ({ label: 'weekly-report', slug: 'weekly-report', can_edit: true, sharing, ...extra });
const ADMIN = { enabled: true, can_share_org: true, org_name: 'Kinaxis' };
const MEMBER = { enabled: true, can_share_org: false, org_name: 'Kinaxis' };

function renderDialog({ sharing = { org: false, team_ids: [], emails: [] }, capabilities = MEMBER, extra = {}, onSave = vi.fn(async () => {}) } = {}) {
  render(<SkillShareDialog skill={skill(sharing, extra)} capabilities={capabilities} onClose={vi.fn()} onSave={onSave} />);
  return { onSave, dialog: screen.getByRole('dialog') };
}

const box = (dialog, name) => within(dialog).getByRole('checkbox', { name });
const ALWAYS_ON = 'Always include in every task';
const alwaysOn = (dialog) => within(dialog).queryByRole('switch', { name: ALWAYS_ON });

beforeEach(() => {
  teams.state = { status: 'ready', reachable: true, teams: [SUPPLY, FINANCE] };
});

describe('SkillShareDialog', () => {
  it('starts on Only me for a private skill and says shared skills are used when relevant', () => {
    const { dialog } = renderDialog();

    expect(box(dialog, 'Only me')).toBeChecked();
    expect(box(dialog, 'Specific people')).not.toBeChecked();
    const note = within(dialog).getByRole('note');
    expect(note).toHaveTextContent("Anton uses a shared skill when it's relevant to the task");
    expect(note).not.toHaveTextContent('automatically');
  });

  it('disables Everyone at the org without can_share_org, with the admin hint', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog({ capabilities: MEMBER });

    const org = box(dialog, 'Everyone at Kinaxis');
    expect(org).toHaveAttribute('aria-disabled', 'true');
    await user.hover(screen.getByTestId('org-option-locked'));
    expect(await screen.findByText('Only admins can share with the whole organization')).toBeInTheDocument();
  });

  it('shares with the whole org when can_share_org allows it', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = renderDialog({ capabilities: ADMIN });

    await user.click(box(dialog, 'Everyone at Kinaxis'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ org: true, team_ids: [], emails: [], always_on: false });
  });

  it('falls back to a generic org label without an org name', () => {
    const { dialog } = renderDialog({ capabilities: { ...ADMIN, org_name: null } });
    expect(box(dialog, 'Everyone in your organization')).toBeInTheDocument();
  });

  it('lists teams and saves the picked ones', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = renderDialog();

    await user.click(box(dialog, 'Teams'));
    await user.click(box(dialog, 'Supply Planning'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: ['t-supply'], emails: [], always_on: false });
  });

  it('says so when the caller is in no teams', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: true, teams: [] };
    const { dialog } = renderDialog();

    await user.click(box(dialog, 'Teams'));

    expect(within(dialog).getByText("You're not in any teams yet.")).toBeInTheDocument();
  });

  it('says so when the teams could not be loaded', async () => {
    const user = userEvent.setup();
    teams.state = { status: 'ready', reachable: false, teams: [] };
    const { dialog } = renderDialog();

    await user.click(box(dialog, 'Teams'));

    expect(within(dialog).getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('turns typed addresses into chips and refuses one that is not an email', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = renderDialog();

    await user.click(box(dialog, 'Specific people'));
    const input = within(dialog).getByRole('textbox', { name: 'Add people by email' });
    await user.type(input, 'Ana@Kinaxis.com, nope{Enter}');

    expect(within(dialog).getByRole('list', { name: 'People' })).toHaveTextContent('ana@kinaxis.com');
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Not an email: nope');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(input);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: ['ana@kinaxis.com'], always_on: false });
  });

  it('pre-fills the current audience and clears it with Only me', async () => {
    const user = userEvent.setup();
    const { dialog, onSave } = renderDialog({
      sharing: { org: false, team_ids: ['t-finance'], emails: ['bo@kinaxis.com'] },
    });

    expect(box(dialog, 'Finance')).toBeChecked();
    expect(within(dialog).getByRole('list', { name: 'People' })).toHaveTextContent('bo@kinaxis.com');

    await user.click(box(dialog, 'Only me'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: [], always_on: false });
  });

  it("shows the server's refusal in place", async () => {
    const user = userEvent.setup();
    const refusal = Object.assign(new Error('Only admins can share skills with the whole organization.'), { status: 403 });
    const { dialog } = renderDialog({ capabilities: ADMIN, onSave: vi.fn(async () => { throw refusal; }) });

    await user.click(box(dialog, 'Everyone at Kinaxis'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(within(dialog).getByRole('alert'))
      .toHaveTextContent('Only admins can share skills with the whole organization.'));
  });

  describe('Always include in every task', () => {
    it('is hidden until the org or a team is picked', async () => {
      const user = userEvent.setup();
      const { dialog } = renderDialog({ capabilities: ADMIN });

      expect(alwaysOn(dialog)).toBeNull();
      await user.click(box(dialog, 'Specific people'));
      await user.type(within(dialog).getByRole('textbox', { name: 'Add people by email' }), 'ana@kinaxis.com{Enter}');
      expect(alwaysOn(dialog)).toBeNull();

      await user.click(box(dialog, 'Teams'));
      expect(alwaysOn(dialog)).toBeNull();
      await user.click(box(dialog, 'Supply Planning'));
      expect(alwaysOn(dialog)).not.toBeChecked();
      expect(within(dialog).getByText("Off: Anton uses it when it's relevant. On: it's part of every task for everyone it's shared with."))
        .toBeInTheDocument();

      await user.click(box(dialog, 'Supply Planning'));
      expect(alwaysOn(dialog)).toBeNull();
      await user.click(box(dialog, 'Everyone at Kinaxis'));
      expect(alwaysOn(dialog)).toBeInTheDocument();
    });

    it('sends always_on in the save for a team skill', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = renderDialog();

      await user.click(box(dialog, 'Teams'));
      await user.click(box(dialog, 'Finance'));
      await user.click(alwaysOn(dialog));
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));

      expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: ['t-finance'], emails: [], always_on: true });
    });

    it('pre-fills it from sharing.alwaysOn and sends it for an org-wide skill', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = renderDialog({
        capabilities: ADMIN,
        sharing: { org: true, team_ids: [], emails: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toBeChecked();
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith({ org: true, team_ids: [], emails: [], always_on: true });
    });

    it('resets to off once neither the org nor a team is picked', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = renderDialog({
        sharing: { org: false, team_ids: ['t-finance'], emails: ['bo@kinaxis.com'], always_on: true },
      });

      expect(alwaysOn(dialog)).toBeChecked();
      await user.click(box(dialog, 'Teams'));
      expect(alwaysOn(dialog)).toBeNull();

      await user.click(box(dialog, 'Teams'));
      await user.click(box(dialog, 'Finance'));
      expect(alwaysOn(dialog)).not.toBeChecked();

      await user.click(box(dialog, 'Finance'));
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: ['bo@kinaxis.com'], always_on: false });
    });

    it('resets to off with Only me', async () => {
      const user = userEvent.setup();
      const { dialog, onSave } = renderDialog({
        capabilities: ADMIN,
        sharing: { org: true, team_ids: [], emails: [], alwaysOn: true },
      });

      await user.click(box(dialog, 'Only me'));
      expect(alwaysOn(dialog)).toBeNull();
      await user.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: [], always_on: false });
    });

    it('is locked for an org-wide skill without can_share_org, with the admin hint', async () => {
      const user = userEvent.setup();
      const { dialog } = renderDialog({
        capabilities: MEMBER,
        sharing: { org: true, team_ids: [], emails: [], alwaysOn: true },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      expect(alwaysOn(dialog)).toBeChecked();
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only admins can make an organization-wide skill always on')).toBeInTheDocument();
    });

    it('is locked for a team skill the caller cannot edit, with the editor hint', async () => {
      const user = userEvent.setup();
      const { dialog } = renderDialog({
        sharing: { org: false, team_ids: ['t-supply'], emails: [] },
        extra: { can_edit: false },
      });

      expect(alwaysOn(dialog)).toHaveAttribute('aria-disabled', 'true');
      await user.hover(screen.getByTestId('always-on-locked'));
      expect(await screen.findByText('Only people who can edit this skill can change this')).toBeInTheDocument();
    });

    it('is open on a team skill to a member who can edit it', () => {
      const { dialog } = renderDialog({ sharing: { org: false, team_ids: ['t-supply'], emails: [] } });

      expect(alwaysOn(dialog)).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.queryByTestId('always-on-locked')).toBeNull();
    });
  });
});
