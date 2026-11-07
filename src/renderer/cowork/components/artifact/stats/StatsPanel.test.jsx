import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// chart.js needs a real canvas; the chart has its own test.
vi.mock('./StatsChart', () => ({
  StatsChart: ({ daily }) => <div data-testid="stats-chart" data-days={daily.length} />,
}));

import { StatsPanel } from './StatsPanel';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
const DAILY = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  views: i % 3,
}));
const DATA = {
  tracking: true,
  period_days: 30,
  total_views: 152,
  last_viewed: hoursAgo(2),
  views_in_period: 47,
  daily: DAILY,
  unique_viewers: 1,
  viewers: [{
    email: 'a@example.com',
    visits: 12,
    first_seen: hoursAgo(400),
    last_seen: hoursAgo(3),
    device: 'Desktop · Chrome',
  }],
};
const EMPTY = {
  ...DATA,
  total_views: 0,
  last_viewed: null,
  views_in_period: 0,
  daily: DAILY.map((d) => ({ ...d, views: 0 })),
  unique_viewers: 0,
  viewers: [],
};

function renderPanel(props = {}) {
  const handlers = { onToggleTracking: vi.fn(), onRetry: vi.fn(), onClose: vi.fn() };
  render(
    <StatsPanel
      data={DATA}
      accessMode="restricted"
      accessLoaded
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

const metric = (label) => screen.getByText(label).parentElement;
// Moves keyboard focus forward until it lands on `element`.
async function tabTo(user, element) {
  for (let i = 0; i < 20 && document.activeElement !== element; i += 1) await user.tab();
  return document.activeElement === element;
}
const RESTRICTED_NOTE = 'Viewer names are recorded only when sharing is restricted.';

describe('StatsPanel content', () => {
  it('shows a skeleton while the first load runs', () => {
    renderPanel({ data: null, loading: true });

    expect(screen.getByRole('status', { name: 'Loading stats' })).toBeInTheDocument();
  });

  it('shows the four numbers, the daily chart and the viewers', () => {
    renderPanel();

    expect(within(metric('Views (30 days)')).getByText('47')).toBeInTheDocument();
    expect(within(metric('Unique viewers (30 days)')).getByText('1')).toBeInTheDocument();
    expect(within(metric('Total views')).getByText('152')).toBeInTheDocument();
    expect(within(metric('Last viewed')).getByText('2h ago')).toBeInTheDocument();
    expect(screen.getByTestId('stats-chart')).toHaveAttribute('data-days', '30');
    expect(screen.getByText('Days in UTC')).toBeInTheDocument();

    const table = screen.getByRole('table');
    for (const name of ['Email', 'Visits (all time)', 'Last seen', 'Device']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByText('a@example.com')).toBeInTheDocument();
    expect(within(table).getByText('12')).toBeInTheDocument();
    expect(within(table).getByText('Desktop · Chrome')).toBeInTheDocument();
  });

  it('shows the exact last view time in a focusable tooltip', async () => {
    const { user } = renderPanel();
    const value = within(metric('Last viewed')).getByText('2h ago');

    expect(value).toHaveAttribute('tabindex', '0');
    await user.hover(value);

    expect(await screen.findByText(new Date(DATA.last_viewed).toLocaleString())).toBeInTheDocument();
  });

  it('shows the exact last seen time of a viewer in a tooltip, not a native title', async () => {
    const { user } = renderPanel();
    const value = within(screen.getByRole('table')).getByText('3h ago');

    expect(value).toHaveAttribute('tabindex', '0');
    expect(value.closest('td')).not.toHaveAttribute('title');
    await user.hover(value);

    expect(await screen.findByText(new Date(DATA.viewers[0].last_seen).toLocaleString())).toBeInTheDocument();
  });

  it('opens the last view tooltip from the keyboard', async () => {
    const { user } = renderPanel();
    const value = within(metric('Last viewed')).getByText('2h ago');

    expect(await tabTo(user, value)).toBe(true);

    expect(await screen.findByText(new Date(DATA.last_viewed).toLocaleString())).toBeInTheDocument();
  });

  it('opens a viewer\'s last seen tooltip from the keyboard', async () => {
    const { user } = renderPanel();
    const value = within(screen.getByRole('table')).getByText('3h ago');

    expect(await tabTo(user, value)).toBe(true);

    expect(await screen.findByText(new Date(DATA.viewers[0].last_seen).toLocaleString())).toBeInTheDocument();
  });

  it('hides unique viewers on a public link with no viewer list', () => {
    renderPanel({ data: { ...DATA, unique_viewers: 0, viewers: [] }, accessMode: 'public' });

    expect(screen.queryByText('Unique viewers (30 days)')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says tracking is off and still shows what was collected', () => {
    renderPanel({ data: { ...DATA, tracking: false } });

    expect(screen.getByText('Tracking is off. New views are not recorded.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Track views' })).not.toBeChecked();
    expect(within(metric('Total views')).getByText('152')).toBeInTheDocument();
  });

  it('explains viewer names on a public link once its access mode is known', () => {
    renderPanel({ data: { ...DATA, viewers: [] }, accessMode: 'public', accessLoaded: true });

    expect(screen.getByText(RESTRICTED_NOTE)).toBeInTheDocument();
  });

  // Before access loads usePublish reports 'public', so the note would flash
  // on a restricted artifact.
  it('keeps the viewer-names note back until the access mode loads', () => {
    renderPanel({ data: { ...DATA, viewers: [] }, accessMode: 'public', accessLoaded: false });

    expect(screen.queryByText(RESTRICTED_NOTE)).toBeNull();
  });

  it('shows no viewer-names note on a restricted artifact', () => {
    renderPanel({ data: { ...DATA, viewers: [] }, accessMode: 'restricted', accessLoaded: true });

    expect(screen.queryByText(RESTRICTED_NOTE)).toBeNull();
  });

  it('says No views yet when nobody opened the artifact', () => {
    renderPanel({ data: EMPTY });

    expect(screen.getByText('No views yet')).toBeInTheDocument();
    expect(screen.queryByTestId('stats-chart')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Track views' })).toBeChecked();
  });

  it('closes from the header button', async () => {
    const { onClose, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Close stats panel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StatsPanel errors', () => {
  it.each([
    ['stats_owned_by_other_account', 409, 'Stats are not available for this account.'],
    ['stats_unavailable', 404, 'Stats are not available for this artifact.'],
    ['publish_credential_missing', 400, 'Reconnect MindsHub to see stats.'],
    ['publish_credential_rejected', 502, 'Reconnect MindsHub to see stats.'],
  ])('shows %s without Retry', (code, status, message) => {
    renderPanel({ data: null, error: { status, code, message: 'server text' } });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('offers Retry when stats are temporarily unavailable', async () => {
    const { onRetry, user } = renderPanel({
      data: null,
      error: { status: 503, code: 'stats_temporarily_unavailable', message: 'server text' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Stats are temporarily unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows an uncoded failure with its message and Retry', () => {
    renderPanel({ data: null, error: { status: 502, code: null, message: 'Could not reach MindsHub.' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach MindsHub.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it.each([
    [402, 'upgrade_required', 'Upgrade your plan to see stats.'],
    [403, 'organization_inactive', 'Your organization is inactive.'],
  ])('shows a %i refusal with its own message and no Retry', (status, code, message) => {
    renderPanel({ data: null, error: { status, code, message } });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps Retry for a plain permission refusal', () => {
    renderPanel({
      data: null,
      error: { status: 403, code: 'permission_denied', message: 'Your current role does not allow this action.' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Your current role does not allow this action.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  // Retry reloads the stats; it would not repeat the refused change.
  it.each([
    [503, null, 'Publishing is busy right now. Try again in a moment.'],
    [503, 'stats_temporarily_unavailable', 'Stats are temporarily unavailable.'],
  ])('keeps the numbers on screen and offers no Retry when a tracking change fails (%i %s)', (status, code, message) => {
    renderPanel({ error: { status, code, message: 'Publishing is busy right now. Try again in a moment.' } });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(metric('Total views')).getByText('152')).toBeInTheDocument();
  });
});

describe('StatsPanel tracking switch', () => {
  it('asks for the opposite value when clicked', async () => {
    const { onToggleTracking, user } = renderPanel();

    await user.click(screen.getByRole('switch', { name: 'Track views' }));

    expect(onToggleTracking).toHaveBeenCalledWith(false);
  });

  it('ignores clicks while a change is saving', async () => {
    const { onToggleTracking, user } = renderPanel({ trackingBusy: true });

    await user.click(screen.getByRole('switch', { name: 'Track views' }));

    expect(onToggleTracking).not.toHaveBeenCalled();
  });
});
