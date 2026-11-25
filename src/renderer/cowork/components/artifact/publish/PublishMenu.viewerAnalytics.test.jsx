// The Share panel's viewer-analytics settings (ENG-4455): "Collect viewer
// analytics". "Ask for email before viewing" is out of the first version. A
// refusal for want of credits links to adding them.
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('../../../../lib/deployment', () => ({ PLATFORM_UI: false }));
vi.mock('../../../lib/artifactShareAnalytics', () => ({ reportShareOpened: vi.fn(), reportLinkCopied: vi.fn() }));
const host = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../../../platform/host', () => ({
  // Console links read the signed-in account (useConsoleLink).
  getAccessToken: () => Promise.resolve(null),
  host: { ...host, isWeb: true, isElectron: false, getApiOrigin: () => 'http://localhost' },
}));
const stats = vi.hoisted(() => ({ value: null, calls: [] }));
vi.mock('../stats/useArtifactStats', () => ({
  useArtifactStats: (artifact, options) => {
    stats.calls.push({ artifact, ...options });
    return stats.value;
  },
}));

import { PublishMenu } from './PublishMenu';

const ARTIFACT = { id: 'a1', type: 'html' };

function makeController(overrides = {}) {
  return {
    artifact: ARTIFACT,
    publishedUrl: 'https://view.example/r/a', phase: 'idle', busy: false, error: '', notice: '', linkOwnerRecorded: null,
    accessMode: 'public', accessPassword: '', accessEmails: [], orgAllowed: false, ownerOnly: false,
    accessLoaded: true, versions: [], modified: false,
    setError: vi.fn(), loadVersions: vi.fn(), publish: vi.fn(), unpublish: vi.fn(), activate: vi.fn(), update: vi.fn(),
    ...overrides,
  };
}

function makeStats(overrides = {}) {
  return {
    data: { tracking: false, require_email: false },
    loading: false,
    error: null,
    trackingBusy: false,
    reload: vi.fn(),
    setTracking: vi.fn(),
    setRequireEmail: vi.fn(),
    ...overrides,
  };
}

function openMenu(controller = makeController()) {
  render(<PublishMenu controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: /Share/ }));
  return screen.getByTestId('viewer-analytics-settings');
}

beforeEach(() => {
  vi.clearAllMocks();
  stats.calls = [];
  stats.value = makeStats();
});

describe('PublishMenu viewer analytics', () => {
  it('reads the settings only while the panel is open on a published artifact', () => {
    render(<PublishMenu controller={makeController()} />);
    expect(stats.calls.at(-1)).toMatchObject({ artifact: ARTIFACT, enabled: false });

    fireEvent.click(screen.getByRole('button', { name: /Share/ }));

    expect(stats.calls.at(-1)).toMatchObject({ artifact: ARTIFACT, enabled: true });
  });

  it('turns analytics on, says what it collects, and hides the email gate while off', () => {
    const settings = openMenu();

    const collect = within(settings).getByRole('switch', { name: 'Collect viewer analytics' });
    expect(collect).not.toBeChecked();
    expect(settings).toHaveTextContent('See who opens this page, how long they stay and which parts they read.');
    expect(within(settings).queryByRole('switch', { name: 'Ask for email before viewing' })).toBeNull();

    fireEvent.click(collect);

    expect(stats.value.setTracking).toHaveBeenCalledWith(true);
  });

  it.each(['public', 'password', 'restricted'])('offers no email gate on a %s link', (accessMode) => {
    stats.value = makeStats({ data: { tracking: true, require_email: false } });
    const settings = openMenu(makeController({ accessMode, accessPassword: accessMode === 'password' ? 'pw' : '' }));

    expect(within(settings).getByRole('switch', { name: 'Collect viewer analytics' })).toBeChecked();
    expect(within(settings).queryByRole('switch', { name: 'Ask for email before viewing' })).toBeNull();
  });

  it('offers no email gate even where one is already on', () => {
    stats.value = makeStats({ data: { tracking: true, require_email: true } });
    const settings = openMenu();

    expect(within(settings).queryByRole('switch', { name: 'Ask for email before viewing' })).toBeNull();
  });

  it('holds the switches while a change saves', () => {
    stats.value = makeStats({ data: { tracking: true, require_email: true }, trackingBusy: true });
    const settings = openMenu();

    expect(within(settings).getByRole('switch', { name: 'Collect viewer analytics' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('asks for credits with a link to add them when turning on is refused', () => {
    stats.value = makeStats({
      error: { status: 402, code: 'credits_required', message: 'Add credits to collect viewer analytics.' },
    });
    const settings = openMenu();

    expect(within(settings).getByRole('alert')).toHaveTextContent('Add credits to collect viewer analytics.');
    fireEvent.click(within(settings).getByRole('button', { name: 'Add credits' }));

    expect(host.openExternal).toHaveBeenCalledTimes(1);
    expect(host.openExternal.mock.calls[0][0]).toMatch(/^https:\/\//);
  });

  it('says to turn analytics on first when the email gate is refused for it', () => {
    stats.value = makeStats({ error: { status: 422, code: 'tracking_off', message: 'tracking_off' } });
    const settings = openMenu();

    expect(within(settings).getByRole('alert')).toHaveTextContent('Turn on viewer analytics first.');
    expect(within(settings).queryByRole('button', { name: 'Add credits' })).toBeNull();
  });

  it('offers Retry when the settings could not be read', () => {
    stats.value = makeStats({ data: null, error: { status: 502, code: null, message: 'down' } });
    const settings = openMenu();

    expect(settings).toHaveTextContent('Could not load analytics settings.');
    fireEvent.click(within(settings).getByRole('button', { name: 'Retry' }));

    expect(stats.value.reload).toHaveBeenCalledTimes(1);
  });

  it('says why the settings could not be read', () => {
    stats.value = makeStats({ data: null, error: { status: 502, code: null, message: 'Publishing is unavailable right now.' } });
    const settings = openMenu();

    expect(settings).toHaveTextContent('Publishing is unavailable right now.');
  });

  it('offers no Retry when trying again cannot help', () => {
    stats.value = makeStats({ data: null, error: { status: 403, code: 'stats_owned_by_other_account', message: 'nope' } });
    const settings = openMenu();

    expect(settings).toHaveTextContent('Stats are not available for this account.');
    expect(within(settings).queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

// The footer says the switches saved: Saving… while one saves, Saved for a
// moment, then Up to date again.
describe('PublishMenu analytics save status', () => {
  afterEach(() => vi.useRealTimers());

  it('goes Up to date → Saving… → Saved → Up to date', () => {
    stats.value = makeStats({ data: { tracking: false, require_email: false } });
    const controller = makeController();
    const view = render(<PublishMenu controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    expect(screen.getByText('Up to date')).toBeInTheDocument();

    stats.value = makeStats({ data: { tracking: false, require_email: false }, trackingBusy: true });
    view.rerender(<PublishMenu controller={controller} />);
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    vi.useFakeTimers();
    stats.value = makeStats({ data: { tracking: true, require_email: false } });
    view.rerender(<PublishMenu controller={controller} />);
    expect(screen.getByText('Saved')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1800); });
    expect(screen.getByText('Up to date')).toBeInTheDocument();
  });

  it('does not say Saved when the save failed', () => {
    stats.value = makeStats({ trackingBusy: true });
    const controller = makeController();
    const view = render(<PublishMenu controller={controller} />);
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));

    stats.value = makeStats({ error: { status: 402, code: 'credits_required', message: 'x' } });
    view.rerender(<PublishMenu controller={controller} />);

    expect(screen.queryByText('Saved')).toBeNull();
  });
});

// Analytics is its own setting: it stays on screen whatever access is picked
// or being changed (ENG-4455).
describe('PublishMenu viewer analytics beside an access change', () => {
  it('stays shown after picking another access from the dropdown', () => {
    openMenu();
    fireEvent.click(screen.getByTestId('access-dropdown'));
    fireEvent.click(screen.getByRole('radio', { name: /^Password protected/ }));

    expect(screen.getByText('Dismiss')).toBeInTheDocument();
    expect(within(screen.getByTestId('viewer-analytics-settings'))
      .getByRole('switch', { name: 'Collect viewer analytics' })).toBeInTheDocument();
  });

  it('is not offered for Only me, and comes back once another access is picked', () => {
    render(<PublishMenu controller={makeController({ accessMode: 'restricted', ownerOnly: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    expect(screen.queryByTestId('viewer-analytics-settings')).toBeNull();

    fireEvent.click(screen.getByTestId('access-dropdown'));
    fireEvent.click(screen.getByRole('radio', { name: /^Password protected/ }));
    expect(screen.getByTestId('viewer-analytics-settings')).toBeInTheDocument();
  });
});
