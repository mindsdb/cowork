// Teams and "Everyone at ‹org›" in the restricted choice (ENG-3787).
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const people = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../../../api', async (importOriginal) => ({ ...(await importOriginal()), searchHubPeople: people.search }));

import { PublishMenu } from './PublishMenu';

beforeEach(() => {
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
    accessTeamIds: [],
    orgAllowed: false,
    ownerOnly: true,
    accessLoaded: true,
    versions: [],
    modified: false,
    supportsPublishRoutes: false,
    orgSharing: { enabled: true, orgName: 'Kinaxis', teams: TEAMS, userEmail: 'me@kinaxis.com' },
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
  it('sends the picked teams and org_wide with a restricted change', async () => {
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
      emails: [],
      org_allowed: true,
      owner_only: false,
      team_ids: ['t-supply'],
      org_wide: true,
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
      team_ids: ['t-supply'], org_wide: false, owner_only: false,
    }));
  });

  it('pre-fills the teams the access already names', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ accessTeamIds: ['t-supply'], ownerOnly: false })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'Supply Planning' })).toBeChecked();
  });

  it("leaves the org's default team out and reads it as Everyone at the org", async () => {
    const user = userEvent.setup();
    const withDefault = { ...TEAMS, teams: [{ id: 't-all', display_name: 'All members', is_default: true }, ...TEAMS.teams] };
    render(<PublishMenu controller={makeController({
      accessTeamIds: ['t-all'], ownerOnly: false,
      orgSharing: { enabled: true, orgName: 'Kinaxis', teams: withDefault, userEmail: 'me@kinaxis.com' },
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

  it('merges people in and outside the org into one emails list', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    await user.click(screen.getByRole('checkbox', { name: 'People in Kinaxis' }));
    await user.type(screen.getByRole('combobox', { name: 'Search people' }), 'ana');
    await user.click(await screen.findByRole('option', { name: /Ana Ruiz/ }));

    await user.click(screen.getByRole('checkbox', { name: 'People outside Kinaxis' }));
    const outside = screen.getByRole('textbox', { name: 'Add people outside by email' });
    await user.type(outside, 'Zed@Partner.io{Enter}');
    expect(screen.getByRole('list', { name: 'People outside' })).toHaveTextContent('zed@partner.io');

    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(pub.publish).toHaveBeenCalledWith({
      mode: 'restricted',
      emails: ['ana@kinaxis.com', 'zed@partner.io'],
      org_allowed: false,
      owner_only: false,
      team_ids: [],
      org_wide: false,
    });
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

  it('places existing recipients by the signed-in email domain', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      accessEmails: ['bo@kinaxis.com', 'zed@partner.io'], ownerOnly: false,
    })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'People in Kinaxis' })).toBeChecked();
    expect(screen.getByRole('list', { name: 'Picked people' })).toHaveTextContent('bo@kinaxis.com');
    expect(screen.getByRole('list', { name: 'Picked people' })).not.toHaveTextContent('zed@partner.io');
    expect(screen.getByRole('checkbox', { name: 'People outside Kinaxis' })).toBeChecked();
    expect(screen.getByRole('list', { name: 'People outside' })).toHaveTextContent('zed@partner.io');
  });

  it('puts every existing recipient outside when the signed-in email is unknown', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      accessEmails: ['bo@kinaxis.com'], ownerOnly: false,
      orgSharing: { enabled: true, orgName: 'Kinaxis', teams: TEAMS, userEmail: null },
    })} />);
    await user.click(screen.getByText(/Shared/));
    await user.click(screen.getByText('Change'));

    expect(screen.getByRole('checkbox', { name: 'People in Kinaxis' })).not.toBeChecked();
    expect(screen.getByRole('list', { name: 'People outside' })).toHaveTextContent('bo@kinaxis.com');
  });
});
