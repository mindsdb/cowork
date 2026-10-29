// Teams and "Everyone at ‹org›" in the restricted choice (ENG-3787).
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const people = vi.hoisted(() => ({ search: vi.fn(), byIds: vi.fn() }));
vi.mock('../../../api', async (importOriginal) => ({
  ...(await importOriginal()),
  searchHubPeople: people.search,
  fetchHubPeopleByIds: people.byIds,
}));

import { PublishMenu } from './PublishMenu';

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
    people: [{ id: 'u-ana', name: 'Ana Ruiz', email: 'ana@kinaxis.com' }]
      .filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase())),
  }));
});

const TEAMS = { status: 'ready', reachable: true, teams: [{ id: 't-supply', display_name: 'Supply Planning' }] };

function makeController(overrides = {}) {
  return {
    publishedUrl: 'https://share/abc',
    phase: 'idle',
    busy: false,
    error: '',
    accessMode: 'restricted',
    accessPassword: '',
    accessEmails: [],
    allowedTeamIds: [],
    allowedUserIds: [],
    orgAllowed: false,
    ownerOnly: true,
    accessLoaded: true,
    versions: [],
    modified: false,
    supportsPublishRoutes: false,
    orgSharing: { enabled: true, orgName: 'Kinaxis', teams: TEAMS },
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(async () => true),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

async function openAccessChange(user) {
  await user.click(screen.getByText('Share'));
  await user.click(screen.getByText('Change'));
  await user.click(screen.getByRole('radio', { name: /Specific people/ }));
}

describe('PublishMenu with org sharing', () => {
  it('sends the picked teams and org_allowed with a restricted change', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    await user.click(screen.getByRole('checkbox', { name: 'Teams' }));
    await user.click(screen.getByRole('checkbox', { name: 'Supply Planning' }));
    await user.click(screen.getByRole('checkbox', { name: 'Everyone at Kinaxis' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted',
      org_allowed: true,
      allowed_team_ids: ['t-supply'],
      allowed_user_ids: [],
      allowed_emails: [],
      owner_only: false,
      // The names cowork-server's publish still reads.
      emails: [],
      team_ids: ['t-supply'],
    });
  });

  it('accepts teams alone as a finished selection', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Teams' }));
    await user.click(screen.getByRole('checkbox', { name: 'Supply Planning' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_team_ids: ['t-supply'], org_allowed: false, owner_only: false,
    }));
  });

  it('pre-fills the teams the access already names', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ allowedTeamIds: ['t-supply'], ownerOnly: false })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'Supply Planning' })).toBeChecked();
  });

  it("leaves the org's default team out and reads it as Everyone at the org", async () => {
    const user = userEvent.setup();
    const withDefault = { ...TEAMS, teams: [{ id: 't-all', display_name: 'All members', is_default: true }, ...TEAMS.teams] };
    render(<PublishMenu controller={makeController({
      allowedTeamIds: ['t-all'], ownerOnly: false,
      orgSharing: { enabled: true, orgName: 'Kinaxis', teams: withDefault },
    })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'Everyone at Kinaxis' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Teams' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Teams' }));
    expect(screen.getByRole('checkbox', { name: 'Supply Planning' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'All members' })).toBeNull();
  });

  it('says when the teams could not be loaded', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      orgSharing: { enabled: true, orgName: 'Kinaxis', teams: { status: 'ready', reachable: false, teams: [] } },
    })} />);
    await openAccessChange(user);
    await user.click(screen.getByRole('checkbox', { name: 'Teams' }));

    expect(screen.getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('shows neither teams nor the org name without org sharing', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgSharing: { enabled: false, orgName: null, teams: TEAMS } });
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    expect(screen.queryByRole('checkbox', { name: 'Supply Planning' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Teams' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /People in/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /People outside/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    const org = screen.getByRole('checkbox', { name: 'Everyone in my organization' });
    await user.click(org);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(pub.publish).toHaveBeenCalledWith({ mode: 'restricted', emails: [], org_allowed: true, owner_only: false });
    expect(within(document.body).queryByText('Everyone at Kinaxis')).toBeNull();
  });

  it('offers Everyone, Teams, People in and People outside the org', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user);

    for (const name of ['Everyone at Kinaxis', 'Teams', 'People in Kinaxis', 'People outside Kinaxis']) {
      expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    }
  });

  it('sends people in the org by user id and people outside by email', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    await user.click(screen.getByRole('checkbox', { name: 'People in Kinaxis' }));
    await user.type(screen.getByRole('combobox', { name: 'Search people' }), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    expect(screen.getByRole('list', { name: 'Picked people' })).toHaveTextContent('Ana Ruiz (ana@kinaxis.com)');

    await user.click(screen.getByRole('checkbox', { name: 'People outside Kinaxis' }));
    const outside = screen.getByRole('textbox', { name: 'Add people outside by email' });
    await user.type(outside, 'Zed@Partner.io{Enter}');
    expect(screen.getByRole('list', { name: 'People outside' })).toHaveTextContent('zed@partner.io');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted',
      org_allowed: false,
      allowed_team_ids: [],
      allowed_user_ids: ['u-ana'],
      allowed_emails: ['zed@partner.io'],
      owner_only: false,
      emails: ['zed@partner.io'],
      team_ids: [],
    });
  });

  it('accepts people in the org alone as a finished selection', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    await user.click(screen.getByRole('checkbox', { name: 'People in Kinaxis' }));
    await user.type(screen.getByRole('combobox', { name: 'Search people' }), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_user_ids: ['u-ana'], allowed_emails: [], emails: [], owner_only: false,
    }));
  });

  it('holds the update while an outside address is not an email', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openAccessChange(user);

    await user.click(screen.getByRole('checkbox', { name: 'People outside Kinaxis' }));
    await user.type(screen.getByRole('textbox', { name: 'Add people outside by email' }), 'nope{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent('Not an email: nope');
    expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
  });

  it('names the stored people in the org and keeps outside emails apart', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      allowedUserIds: ['u-bo', 'u-gone'], accessEmails: ['bo@kinaxis.com', 'zed@partner.io'], ownerOnly: false,
    })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'People in Kinaxis' })).toBeChecked();
    const picked = screen.getByRole('list', { name: 'Picked people' });
    await waitFor(() => expect(picked).toHaveTextContent('Bo Chen (bo@kinaxis.com)'));
    expect(picked).toHaveTextContent('Unknown person');
    expect(picked).not.toHaveTextContent('zed@partner.io');
    expect(people.byIds).toHaveBeenCalledWith(['u-bo', 'u-gone']);
    // allowed_emails are the people outside, whatever their domain.
    expect(screen.getByRole('checkbox', { name: 'People outside Kinaxis' })).toBeChecked();
    const outside = screen.getByRole('list', { name: 'People outside' });
    expect(outside).toHaveTextContent('bo@kinaxis.com');
    expect(outside).toHaveTextContent('zed@partner.io');
  });

  it('drops an Unknown person and sends the rest', async () => {
    const user = userEvent.setup();
    const pub = makeController({ allowedUserIds: ['u-bo', 'u-gone'], ownerOnly: false });
    render(<PublishMenu controller={pub} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    await user.click(await screen.findByRole('button', { name: 'Remove Unknown person' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(pub.publish).toHaveBeenCalledWith(expect.objectContaining({
      allowed_user_ids: ['u-bo'], allowed_emails: [], owner_only: false,
    }));
  });
});
