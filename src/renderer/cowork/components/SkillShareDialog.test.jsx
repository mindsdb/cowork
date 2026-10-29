import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const teams = vi.hoisted(() => ({ state: { status: 'ready', reachable: true, teams: [] } }));
vi.mock('../hooks/useOrgSharing', () => ({ useHubTeams: () => teams.state }));

import SkillShareDialog from './SkillShareDialog';

const SUPPLY = { id: 't-supply', display_name: 'Supply Planning' };
const FINANCE = { id: 't-finance', display_name: 'Finance' };

const skill = (sharing) => ({ label: 'weekly-report', slug: 'weekly-report', sharing });
const ADMIN = { enabled: true, can_share_org: true, org_name: 'Kinaxis' };
const MEMBER = { enabled: true, can_share_org: false, org_name: 'Kinaxis' };

function renderDialog({ sharing = { org: false, team_ids: [], emails: [] }, capabilities = MEMBER, onSave = vi.fn(async () => {}) } = {}) {
  render(<SkillShareDialog skill={skill(sharing)} capabilities={capabilities} onClose={vi.fn()} onSave={onSave} />);
  return { onSave, dialog: screen.getByRole('dialog') };
}

const box = (dialog, name) => within(dialog).getByRole('checkbox', { name });

beforeEach(() => {
  teams.state = { status: 'ready', reachable: true, teams: [SUPPLY, FINANCE] };
});

describe('SkillShareDialog', () => {
  it('starts on Only me for a private skill and says team and org skills are always applied', () => {
    const { dialog } = renderDialog();

    expect(box(dialog, 'Only me')).toBeChecked();
    expect(box(dialog, 'Specific people')).not.toBeChecked();
    expect(within(dialog).getByRole('note')).toHaveTextContent("applied to everyone's tasks automatically");
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

    expect(onSave).toHaveBeenCalledWith({ org: true, team_ids: [], emails: [] });
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

    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: ['t-supply'], emails: [] });
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
    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: ['ana@kinaxis.com'] });
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
    expect(onSave).toHaveBeenCalledWith({ org: false, team_ids: [], emails: [] });
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
});
