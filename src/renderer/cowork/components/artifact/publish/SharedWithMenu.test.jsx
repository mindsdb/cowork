// The read-only Share panel a colleague's artifact opens (ENG-4455): who it
// is shared with and nothing else, never the password, and only how it is
// shared for a reader outside the org.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const people = vi.hoisted(() => ({ byIds: vi.fn(), teams: vi.fn() }));
vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMindsHubPeopleByIds: people.byIds,
  fetchMindsHubTeams: people.teams,
}));
const workspace = vi.hoisted(() => ({ audience: vi.fn(), access: vi.fn() }));
vi.mock('../../../lib/artifactWorkspaceApi', async (importOriginal) => ({
  ...(await importOriginal()),
  loadArtifactAudience: workspace.audience,
  loadArtifactAccess: workspace.access,
}));

import { SharedWithMenu, audienceView } from './SharedWithMenu';
import { __resetOrgSharingForTests } from '../../../hooks/useOrgSharing';

const ARTIFACT = { id: '7db94eb8f0a54c7e9c1d2b3a4f5e6d70', projectId: 'proj-1', publishedUrl: 'https://share/abc', accessMode: 'restricted' };
const DIRECTORY = [{ id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' }];
const MEMBER_ANSWER = {
  accessMode: 'restricted',
  ownerOnly: false,
  orgAllowed: false,
  allowedTeamIds: ['t-platform'],
  allowedUserIds: ['u-ana'],
  accessEmails: ['guest@outside.com'],
  names: true,
};

beforeEach(() => {
  __resetOrgSharingForTests();
  people.byIds.mockReset();
  people.byIds.mockImplementation(async (ids) => ({ reachable: true, people: DIRECTORY.filter((p) => ids.includes(p.id)) }));
  people.teams.mockReset();
  people.teams.mockResolvedValue({ reachable: true, failure: null, teams: [{ id: 't-platform', display_name: 'Platform', is_default: false }] });
  workspace.audience.mockReset();
  workspace.access.mockReset();
});

async function openPanel(user) {
  await user.click(screen.getByTestId('shared-with-trigger'));
  return screen.findByTestId('shared-with-panel');
}

describe('SharedWithMenu', () => {
  it('reads "Shared" and says it only shows who it is shared with', () => {
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const trigger = screen.getByTestId('shared-with-trigger');
    expect(trigger).toHaveTextContent('Shared');
    expect(trigger).toHaveAccessibleName('Shared: see who this is shared with');
    // Nothing is read until the panel opens.
    expect(workspace.audience).not.toHaveBeenCalled();
  });

  it('lists the teams, people and outside emails a member may see, and nothing to change', async () => {
    const user = userEvent.setup();
    workspace.audience.mockResolvedValue({ ...MEMBER_ANSWER, accessPassword: 'leaked' });
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const panel = await openPanel(user);

    expect(within(panel).getByText('Shared with')).toBeInTheDocument();
    expect(within(panel).getByText('Who can open it')).toBeInTheDocument();
    const list = await within(panel).findByTestId('shared-with');
    await waitFor(() => expect(within(list).getByText('Ana Ruiz')).toBeInTheDocument());
    await waitFor(() => expect(within(list).getByText('Platform')).toBeInTheDocument());
    expect(within(list).getByText('guest@outside.com')).toBeInTheDocument();

    // Read-only: no picker, no list editing, no password, no analytics,
    // no footer actions, no versions, and never the owner-only route.
    expect(within(panel).queryByTestId('access-dropdown')).toBeNull();
    expect(within(panel).queryByRole('radio')).toBeNull();
    expect(within(panel).queryByRole('textbox')).toBeNull();
    for (const name of [/Edit list/, /Change password/, /Stop sharing/, /Update/, /Version history/, /Remove/]) {
      expect(within(panel).queryByRole('button', { name })).toBeNull();
    }
    expect(within(panel).queryByText(/analytics/i)).toBeNull();
    expect(panel.textContent).not.toContain('leaked');
    expect(panel.querySelector('input[type="password"]')).toBeNull();
    expect(workspace.access).not.toHaveBeenCalled();
    expect(workspace.audience).toHaveBeenCalledWith(ARTIFACT);
  });

  it('says only how it is shared to a reader outside the org', async () => {
    const user = userEvent.setup();
    workspace.audience.mockResolvedValue({
      accessMode: 'restricted', ownerOnly: false, orgAllowed: false,
      allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: false,
    });
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const panel = await openPanel(user);

    expect(await within(panel).findByText('Specific teams and people')).toBeInTheDocument();
    expect(within(panel).getByText("Only the teams and people it's shared with")).toBeInTheDocument();
    expect(within(panel).queryByTestId('shared-with')).toBeNull();
    expect(people.byIds).not.toHaveBeenCalled();
  });

  it('shows the password mode without the password', async () => {
    const user = userEvent.setup();
    workspace.audience.mockResolvedValue({
      accessMode: 'password', ownerOnly: false, orgAllowed: false,
      allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: true,
    });
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const panel = await openPanel(user);

    expect(await within(panel).findByText('Password protected')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Change password/ })).toBeNull();
    expect(panel.querySelector('input')).toBeNull();
  });

  it('names an owner-only link as the owner\'s, not the reader\'s', async () => {
    const user = userEvent.setup();
    workspace.audience.mockResolvedValue({
      accessMode: 'restricted', ownerOnly: true, orgAllowed: false,
      allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: true,
    });
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const panel = await openPanel(user);

    expect(await within(panel).findByText('Only its owner')).toBeInTheDocument();
    expect(within(panel).queryByText('Only me')).toBeNull();
  });

  it('offers Retry when the read fails, and reads again', async () => {
    const user = userEvent.setup();
    workspace.audience.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 503 }));
    workspace.audience.mockResolvedValueOnce({ ...MEMBER_ANSWER, accessMode: 'public', names: true, allowedTeamIds: [], allowedUserIds: [], accessEmails: [] });
    render(<SharedWithMenu artifact={ARTIFACT} />);
    const panel = await openPanel(user);

    expect(await within(panel).findByText("Couldn't load the current access.")).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Retry' }));
    expect(await within(panel).findByText('Public')).toBeInTheDocument();
    expect(workspace.audience).toHaveBeenCalledTimes(2);
  });
});

describe('audienceView', () => {
  it('drops the lists when names are withheld, whatever the answer carries', () => {
    const view = audienceView({ ...MEMBER_ANSWER, names: false }, 'https://share/abc');
    expect(view.allowedTeamIds).toEqual([]);
    expect(view.allowedUserIds).toEqual([]);
    expect(view.accessEmails).toEqual([]);
  });

  it('never carries a password', () => {
    expect(audienceView({ ...MEMBER_ANSWER, accessPassword: 'secret' }, '')).not.toHaveProperty('accessPassword');
  });
});
