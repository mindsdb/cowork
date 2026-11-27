import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PublishMenu } from './PublishMenu';
import { SHARING_OFF } from '../../../lib/orgSharing';

const ORG_AUDIENCE = (over = {}) => ({
  status: 'ready',
  orgName: 'Acme',
  capabilities: {
    enabled: false, orgAudience: true, canShareSkillsOrg: false, canWriteSkillsOrg: false,
    canShareArtifactsOrg: true, permissionsKnown: true, teamsKnown: true, ...over,
  },
});
const OFF = { status: 'idle', capabilities: SHARING_OFF, orgName: null };

function makeController(overrides = {}) {
  return {
    publishedUrl: 'https://share/abc',
    phase: 'idle', busy: false, error: '', notice: '',
    accessMode: 'restricted', accessPassword: '', accessEmails: [],
    allowedTeamIds: [], allowedUserIds: [], orgAllowed: false, ownerOnly: true,
    accessLoaded: true, versions: [], modified: false,
    orgMode: false,
    orgSharing: { status: 'idle', capabilities: SHARING_OFF, teams: null, orgName: null, retry: vi.fn() },
    orgAudience: ORG_AUDIENCE(),
    pendingDatasources: [],
    setError: vi.fn(), loadVersions: vi.fn(), refresh: vi.fn(),
    publish: vi.fn(async () => true), unpublish: vi.fn(), activate: vi.fn(), update: vi.fn(),
    ...overrides,
  };
}

const trigger = () => screen.getByRole('button', { name: /^Share/ });

describe('PublishMenu on Desktop with an organization', () => {
  it('names everyone at the organization on the summary card', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ orgAllowed: true, ownerOnly: false })} />);
    await user.click(trigger());
    expect(await screen.findByText('Everyone at Acme')).toBeInTheDocument();
  });

  it('lists the emails an organization-wide artifact also names, and Everyone drops them', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgAllowed: true, ownerOnly: false, accessEmails: ['zed@partner.io'] });
    render(<PublishMenu controller={pub} />);
    await user.click(trigger());
    const summary = await screen.findByTestId('access-summary');
    expect(summary).toHaveTextContent('zed@partner.io');
    expect(screen.getByTestId('org-also-has-access')).toBeInTheDocument();
    await user.click(screen.getByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /Everyone at Acme/ }));
    await user.click(screen.getByRole('button', { name: /^(Update|Save)/ }));
    await waitFor(() => expect(pub.publish).toHaveBeenCalled());
    expect(pub.publish.mock.calls[0][0]).toMatchObject({ mode: 'restricted', emails: [], org_allowed: true, owner_only: false });
  });

  it('saves Everyone as org_allowed through /publish', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    render(<PublishMenu controller={pub} />);
    await user.click(trigger());
    await user.click(await screen.findByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /Everyone at Acme/ }));
    await user.click(screen.getByRole('button', { name: /^(Update|Save)/ }));
    await waitFor(() => expect(pub.publish).toHaveBeenCalled());
    expect(pub.publish.mock.calls[0][0]).toMatchObject({ mode: 'restricted', emails: [], org_allowed: true, owner_only: false });
  });

  it('keeps Specific people about emails, with no teams and no MindsHub retry', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ accessEmails: ['a@x.com'], ownerOnly: false })} />);
    await user.click(trigger());
    expect(await screen.findByText('Specific people')).toBeInTheDocument();
    expect(screen.queryByText(/Specific teams and people/)).toBeNull();
    expect(screen.queryByText(/Couldn't reach MindsHub to check what you can share/)).toBeNull();
  });

  // The summary view recomputes on every render, so this goes into the
  // change view, where only the re-seed effect moves the draft.
  it('turns an untouched change draft into Everyone when the audience arrives', async () => {
    const user = userEvent.setup();
    const pub = makeController({ orgAllowed: true, ownerOnly: false, orgAudience: OFF });
    const { rerender } = render(<PublishMenu controller={pub} />);
    await user.click(trigger());
    await user.click(await screen.findByText('Edit list'));
    rerender(<PublishMenu controller={{ ...pub, orgAudience: ORG_AUDIENCE() }} />);
    await waitFor(() => expect(screen.getByTestId('access-dropdown')).toHaveTextContent('Everyone at Acme'));
    // The saved access reads as Everyone too now, so nothing differs: the
    // footer says so and nothing is sent (draftDiffers). The payload itself is
    // covered by "saves Everyone as org_allowed through /publish".
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Update/ })).toBeNull();
    expect(pub.publish).not.toHaveBeenCalled();
  });

  it('shows the kept organization when the card is not offered', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController({ orgAllowed: true, ownerOnly: false, accessEmails: ['a@x.com'], orgAudience: OFF })} />);
    await user.click(trigger());
    expect(await screen.findByTestId('org-also-has-access')).toBeInTheDocument();
    expect(screen.getByText(/a@x\.com/)).toBeInTheDocument();
  });

  it('rebuilds an Everyone draft from the saved access when the card goes away', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    const { rerender } = render(<PublishMenu controller={pub} />);
    await user.click(trigger());
    await user.click(await screen.findByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /Everyone at Acme/ }));
    rerender(<PublishMenu controller={{ ...pub, orgAudience: OFF }} />);
    await waitFor(() => expect(screen.queryByText('Everyone at Acme')).toBeNull());
    expect(screen.getByTestId('access-dropdown')).toHaveTextContent('Only me');
  });

  it('rebuilds a first share from a request with nothing picked when the card goes away', async () => {
    const user = userEvent.setup();
    const pub = makeController({ publishedUrl: '' });
    const { rerender } = render(<PublishMenu openRequest={{}} controller={pub} />);
    await user.click(await screen.findByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /Everyone at Acme/ }));
    expect(screen.getByTestId('access-dropdown')).toHaveTextContent('Everyone at Acme');
    rerender(<PublishMenu openRequest={{}} controller={{ ...pub, orgAudience: OFF }} />);
    await waitFor(() => expect(screen.getByTestId('access-dropdown')).not.toHaveTextContent('Everyone at Acme'));
    expect(screen.getByTestId('access-dropdown')).not.toHaveTextContent('Only me');
  });

  it('follows the saved access again after rebuilding a change draft', async () => {
    const user = userEvent.setup();
    const pub = makeController();
    const { rerender } = render(<PublishMenu controller={pub} />);
    await user.click(trigger());
    await user.click(await screen.findByTestId('access-dropdown'));
    await user.click(screen.getByRole('radio', { name: /Everyone at Acme/ }));
    rerender(<PublishMenu controller={{ ...pub, orgAudience: OFF }} />);
    await waitFor(() => expect(screen.getByTestId('access-dropdown')).toHaveTextContent('Only me'));
    rerender(<PublishMenu controller={{ ...pub, orgAudience: OFF, accessEmails: ['a@x.com'], ownerOnly: false }} />);
    await waitFor(() => expect(screen.getByTestId('access-dropdown')).toHaveTextContent('Specific people'));
  });
});
