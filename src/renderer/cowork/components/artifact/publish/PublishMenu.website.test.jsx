// "Public website" in the Share panel: offered in MindsHub mode for a static
// artifact when the deployment allows it; a published website shows its own
// address and no viewer analytics.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/artifactShareAnalytics', () => ({ reportShareOpened: vi.fn(), reportLinkCopied: vi.fn() }));
const stats = vi.hoisted(() => ({ value: null, calls: [] }));
vi.mock('../stats/useArtifactStats', () => ({
  useArtifactStats: (artifact, options) => {
    stats.calls.push({ artifact, ...options });
    return stats.value;
  },
}));

import { PublishMenu } from './PublishMenu';
import { setArtifactWebsites } from '../../../../lib/artifactWebsites';

const STATIC = { id: 'a1', projectId: 'p1', type: 'html' };
const FULLSTACK = { id: 'a2', projectId: 'p1', type: 'fullstack-stateless-app' };
const SITE = 'https://k3x9-staging.mindshub.co/';

function makeStats(data = { tracking: true, require_email: false }) {
  return {
    data, loading: false, error: null, trackingBusy: false,
    reload: vi.fn(), setTracking: vi.fn(), setRequireEmail: vi.fn(),
  };
}

// A MindsHub mode controller whose sharing capabilities are off: the chooser
// then offers Only me, Specific people, Password, Public (and the website).
function makeController(overrides = {}) {
  return {
    artifact: STATIC,
    publishedUrl: 'https://view.example/a/lk/',
    phase: 'idle', busy: false, error: '', notice: '', linkOwnerRecorded: null,
    accessMode: 'public', accessPassword: '', accessEmails: [], allowedTeamIds: [], allowedUserIds: [],
    orgAllowed: false, ownerOnly: false, accessLoaded: true, versions: [], modified: false,
    orgMode: true,
    orgSharing: { status: 'ready', retry: vi.fn(), capabilities: { enabled: false }, teams: null, orgName: null },
    setError: vi.fn(), loadVersions: vi.fn(), publish: vi.fn(async () => true), unpublish: vi.fn(),
    activate: vi.fn(), update: vi.fn(), refresh: vi.fn(),
    ...overrides,
  };
}
const websiteController = (overrides = {}) => makeController({ publishedUrl: SITE, accessMode: 'website', ...overrides });

const openPanel = (user) => user.click(screen.getByRole('button', { name: /^Share/ }));
const dropdown = () => screen.getByTestId('access-dropdown');
const websiteRadio = () => screen.queryByRole('radio', { name: /^Public website/ });
const publicRadio = () => screen.getByRole('radio', { name: /^Public(?! website)/ });
const updateButton = () => screen.queryByRole('button', { name: 'Update' });
const NOTICE = "A public website doesn't ask visitors for their email. Anyone can open it.";

beforeEach(() => {
  vi.clearAllMocks();
  stats.calls = [];
  stats.value = makeStats();
  setArtifactWebsites(true);
});
afterEach(() => setArtifactWebsites(false));

describe('PublishMenu: offering Public website', () => {
  it('offers it right after Public for a static artifact in MindsHub mode', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openPanel(user);
    await user.click(dropdown());

    const cards = screen.getAllByRole('radio').map((radio) => radio.textContent);
    expect(cards.at(-2)).toMatch(/^Public(?! website)/);
    expect(cards.at(-1)).toMatch(/^Public website/);
  });

  it.each([
    ['the deployment does not allow websites', () => { setArtifactWebsites(false); return makeController(); }],
    ['desktop', () => makeController({ orgMode: false })],
    ['a fullstack app', () => makeController({ artifact: FULLSTACK })],
    ['an artifact the panel does not know', () => makeController({ artifact: null })],
  ])('does not offer it when %s', async (_label, controller) => {
    const user = userEvent.setup();
    render(<PublishMenu controller={controller()} />);
    await openPanel(user);
    await user.click(dropdown());

    expect(publicRadio()).toBeInTheDocument();
    expect(websiteRadio()).toBeNull();
  });

  it('saves the pick as the website mode alone', async () => {
    const user = userEvent.setup();
    const ctrl = makeController();
    render(<PublishMenu controller={ctrl} />);
    await openPanel(user);
    await user.click(dropdown());
    await user.click(websiteRadio());

    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public website');
    await user.click(updateButton());
    expect(ctrl.publish).toHaveBeenCalledWith({ mode: 'website' }, expect.anything());
  });

  it('says the email gate does not apply when the artifact has it on, and drops Viewer analytics', async () => {
    stats.value = makeStats({ tracking: true, require_email: true });
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openPanel(user);
    expect(screen.getByTestId('viewer-analytics-settings')).toBeInTheDocument();
    await user.click(dropdown());
    await user.click(websiteRadio());

    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.queryByTestId('viewer-analytics-settings')).toBeNull();
  });

  it('says nothing about the email gate when it is off', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openPanel(user);
    await user.click(dropdown());
    await user.click(websiteRadio());

    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe('PublishMenu: a published website', () => {
  // Its stats routes answer 404, so the open panel does not ask for them.
  it('does not read viewer stats while the panel is open', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={websiteController()} />);
    await openPanel(user);

    expect(stats.calls.at(-1)).toMatchObject({ enabled: false });
  });

  it('still reads them for a public link', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openPanel(user);

    expect(stats.calls.at(-1)).toMatchObject({ enabled: true });
  });

  it('shows the site address under "Website address", and no Viewer analytics', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={websiteController()} />);
    await openPanel(user);

    expect(screen.getByText('Website address')).toBeInTheDocument();
    expect(screen.queryByText('Website URL')).toBeNull();
    expect(screen.getByTitle(SITE)).toHaveTextContent('k3x9-staging.mindshub.co/');
    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public website');
    expect(screen.queryByTestId('viewer-analytics-settings')).toBeNull();
  });

  it('keeps "Website URL" for any other mode', async () => {
    const user = userEvent.setup();
    render(<PublishMenu controller={makeController()} />);
    await openPanel(user);

    expect(screen.getByText('Website URL')).toBeInTheDocument();
    expect(screen.queryByText('Website address')).toBeNull();
  });

  it('has nothing to update when the website is picked again', async () => {
    const user = userEvent.setup();
    const ctrl = websiteController();
    render(<PublishMenu controller={ctrl} />);
    await openPanel(user);
    await user.click(dropdown());
    await user.click(publicRadio());
    await user.click(dropdown());
    await user.click(websiteRadio());

    expect(updateButton()).toBeNull();
    expect(ctrl.publish).not.toHaveBeenCalled();
  });

  it('shows the website when the deployment stopped allowing them, and does not offer it again once left', async () => {
    setArtifactWebsites(false);
    const user = userEvent.setup();
    const ctrl = websiteController();
    render(<PublishMenu controller={ctrl} />);
    await openPanel(user);

    expect(dropdown()).toHaveAccessibleName('Who can access your app: Public website');
    await user.click(dropdown());
    expect(websiteRadio()).toHaveAttribute('aria-checked', 'true');
    await user.click(publicRadio());

    await user.click(dropdown());
    expect(websiteRadio()).toBeNull();
    await user.click(screen.getByRole('radio', { name: /^Public(?! website)/ }));
    await user.click(updateButton());
    expect(ctrl.publish).toHaveBeenCalledWith({ mode: 'public' }, expect.anything());
  });
});
