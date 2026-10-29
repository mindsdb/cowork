// Teams and "Everyone at ‹org›" in the restricted choice (ENG-3787).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublishMenu } from './PublishMenu';

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
  it('sends the picked teams and org_wide with a restricted change', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

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

  it('says when the teams could not be loaded', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({
      orgSharing: { enabled: true, orgName: 'Kinaxis', teams: { status: 'ready', reachable: false, teams: [] } },
    })} />);
    await openAccessChange(user);

    expect(screen.getByText("Couldn't load your teams. Try again later.")).toBeInTheDocument();
  });

  it('shows neither teams nor the org name without org sharing', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgSharing: { enabled: false, orgName: null, teams: TEAMS } });
    render(<PublishMenu controller={pub} />);
    await openAccessChange(user);

    expect(screen.queryByRole('checkbox', { name: 'Supply Planning' })).toBeNull();
    const org = screen.getByRole('checkbox', { name: 'Everyone in my organization' });
    await user.click(org);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(pub.publish).toHaveBeenCalledWith({ mode: 'restricted', emails: [], org_allowed: true, owner_only: false });
    expect(within(document.body).queryByText('Everyone at Kinaxis')).toBeNull();
  });
});
