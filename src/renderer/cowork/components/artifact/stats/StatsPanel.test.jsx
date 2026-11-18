import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// chart.js needs a real canvas; the chart has its own test.
vi.mock('./StatsChart', () => ({
  StatsChart: ({ daily }) => <div data-testid="stats-chart" data-days={daily.length} />,
}));
const host = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../../../platform/host', () => ({ host }));
vi.mock('../../ConfirmModal', () => ({
  ConfirmModal: ({ open, title, confirmLabel, onConfirm, onClose }) => (open ? (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={onConfirm}>{confirmLabel}</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  ) : null),
}));

import { StatsPanel } from './StatsPanel';

const hoursAgo = (hours) => new Date(Date.now() - hours * 3_600_000).toISOString();
const DAILY = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, '0')}`,
  views: i % 3,
}));
const ANALYTICS = {
  visits: 12,
  avg_seconds: 84.5,
  completion: 0.42,
  sections: [
    { key: 's2', index: 2, label: 'Pricing', avg_seconds: 21, reach: 0.5 },
    { key: 's1', index: 1, label: 'Intro', avg_seconds: 42, reach: 1 },
  ],
  viewers: [
    {
      id: 'v_1', kind: 'email', email: 'a@example.com', visits: 3, total_seconds: 240,
      first_seen: hoursAgo(30), last_seen: hoursAgo(3), furthest: 2,
    },
    {
      id: 'v_2', kind: 'anonymous', email: null, visits: 1, total_seconds: 84,
      first_seen: hoursAgo(5), last_seen: hoursAgo(5), furthest: 1,
    },
  ],
};
const DATA = {
  tracking: true,
  require_email: false,
  period_days: 30,
  total_views: 152,
  last_viewed: hoursAgo(2),
  views_in_period: 47,
  daily: DAILY,
  unique_viewers: 1,
  viewers: [{ email: 'a@example.com', last_seen: hoursAgo(3) }],
  analytics: ANALYTICS,
};
const EMPTY = {
  ...DATA,
  total_views: 0,
  last_viewed: null,
  views_in_period: 0,
  daily: DAILY.map((d) => ({ ...d, views: 0 })),
  unique_viewers: 0,
  viewers: [],
  analytics: null,
};
const DETAIL = {
  viewer: ANALYTICS.viewers[0],
  visits: [
    {
      id: 'visit-1', started_at: '2026-11-17T10:42:00Z', seconds: 95, device: 'mobile', furthest: 2,
      sections: [
        { key: 's1', index: 1, label: 'Intro', seconds: 12 },
        { key: 's2', index: 2, label: 'Pricing', seconds: 83 },
      ],
    },
  ],
};

function renderPanel(props = {}) {
  const handlers = {
    onToggleTracking: vi.fn(),
    onOpenViewer: vi.fn(),
    onCloseViewer: vi.fn(),
    onDeleteAnalytics: vi.fn(async () => true),
    onRetry: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(
    <StatsPanel
      data={DATA}
      accessMode="restricted"
      accessLoaded
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, view, user: userEvent.setup() };
}

// A tile's label comes before any chart heading that shares its words.
const metric = (label) => screen.getAllByText(label)[0].parentElement;
const RESTRICTED_NOTE = 'Viewer names are recorded only when sharing is restricted.';

describe('StatsPanel overview', () => {
  it('shows a skeleton while the first load runs', () => {
    renderPanel({ data: null, loading: true });

    expect(screen.getByRole('status', { name: 'Loading stats' })).toBeInTheDocument();
  });

  it('shows views, unique viewers, average time and completion', () => {
    renderPanel();

    expect(within(metric('Views')).getByText('152')).toBeInTheDocument();
    expect(within(metric('Unique viewers')).getByText('2')).toBeInTheDocument();
    expect(within(metric('Avg. time')).getByText('1m 25s')).toBeInTheDocument();
    expect(within(metric('Completion')).getByText('42%')).toBeInTheDocument();
    expect(screen.getByTestId('stats-chart')).toHaveAttribute('data-days', '30');
    expect(screen.getByText('Views, last 30 days')).toBeInTheDocument();
  });

  it('charts time per section in page order, with the reach of each', () => {
    renderPanel();

    const list = screen.getByRole('list', { name: 'Time per section' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Intro: 42s on average, reached by 100% of visits',
      'Pricing: 21s on average, reached by 50% of visits',
    ]);
    // Bars scale to the longest section.
    const bars = within(list).getAllByTestId('section-bar');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '50%' });
  });

  it('leaves the sections chart out when the page has no sections', () => {
    renderPanel({ data: { ...DATA, analytics: { ...ANALYTICS, sections: [], completion: null } } });

    expect(screen.queryByRole('list', { name: 'Time per section' })).toBeNull();
    expect(within(metric('Completion')).getByText('—')).toBeInTheDocument();
  });

  it('lists viewers by email, or as an anonymous viewer, with visits and time', () => {
    renderPanel();

    const list = screen.getByRole('list', { name: 'Viewers' });
    const [first, second] = within(list).getAllByRole('button');
    expect(first).toHaveTextContent('a@example.com');
    expect(first).toHaveTextContent('3 visits · 4m');
    expect(first).toHaveTextContent('3h ago');
    expect(second).toHaveTextContent('Anonymous viewer');
    expect(second).toHaveTextContent('1 visit · 1m 24s');
  });

  it('opens a viewer from the list', async () => {
    const { onOpenViewer, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: /Anonymous viewer/ }));

    expect(onOpenViewer).toHaveBeenCalledWith('v_2');
  });

  it('falls back to the recorded emails when there is no analytics yet', () => {
    renderPanel({ data: { ...DATA, analytics: null } });

    const table = screen.getByRole('table');
    expect(within(table).getByText('a@example.com')).toBeInTheDocument();
    expect(within(metric('Avg. time')).getByText('—')).toBeInTheDocument();
  });

  it('explains viewer names on a public link with analytics off', () => {
    renderPanel({
      data: { ...DATA, tracking: false, viewers: [], analytics: null },
      accessMode: 'public',
      accessLoaded: true,
    });

    expect(screen.getByText(RESTRICTED_NOTE)).toBeInTheDocument();
  });

  it('says analytics is off, offers to turn it on, and still shows what was collected', async () => {
    const { onToggleTracking, user } = renderPanel({ data: { ...DATA, tracking: false } });

    expect(screen.getByText('Viewer analytics is off')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(onToggleTracking).toHaveBeenCalledWith(true);
    expect(within(metric('Views')).getByText('152')).toBeInTheDocument();
  });

  it('says No views yet when nobody opened the artifact', () => {
    renderPanel({ data: EMPTY });

    expect(screen.getByText('No views yet')).toBeInTheDocument();
    expect(screen.getByText('Views show up here once someone opens the link.')).toBeInTheDocument();
    expect(screen.queryByTestId('stats-chart')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete analytics' })).toBeNull();
  });

  it('closes from the header button', async () => {
    const { onClose, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Close stats panel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('StatsPanel viewer detail', () => {
  it('shows the viewer\'s visits with start, device, total and time per section', () => {
    renderPanel({ viewer: { id: 'v_1', data: DETAIL, loading: false, error: null } });

    expect(screen.getByRole('heading', { name: 'a@example.com' })).toBeInTheDocument();
    expect(screen.getByText(/3 visits · 4m total · last seen 3h ago/)).toBeInTheDocument();
    const visits = screen.getByRole('list', { name: 'Visits' });
    const visit = within(visits).getAllByRole('listitem')[0];
    expect(visit).toHaveTextContent(new Date(DETAIL.visits[0].started_at).toLocaleString('en'));
    expect(visit).toHaveTextContent('Mobile');
    expect(visit).toHaveTextContent('1m 35s');
    const sections = within(visit).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'));
    expect(sections).toEqual(['Intro: 12s', 'Pricing: 1m 23s']);
    // The overview is replaced, not stacked under it.
    expect(screen.queryByRole('list', { name: 'Viewers' })).toBeNull();
  });

  it('goes back to the overview', async () => {
    const { onCloseViewer, user } = renderPanel({ viewer: { id: 'v_1', data: DETAIL, loading: false, error: null } });

    await user.click(screen.getByRole('button', { name: 'All viewers' }));

    expect(onCloseViewer).toHaveBeenCalledTimes(1);
  });

  it('names the viewer from the list while the visits load', () => {
    renderPanel({ viewer: { id: 'v_2', data: null, loading: true, error: null } });

    expect(screen.getByRole('heading', { name: 'Anonymous viewer' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading visits' })).toBeInTheDocument();
  });

  it('retries a failed viewer load for that viewer', async () => {
    const { onOpenViewer, user } = renderPanel({
      viewer: { id: 'v_2', data: null, loading: false, error: { status: 502, code: null, message: 'Could not reach MindsHub.' } },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not reach MindsHub.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onOpenViewer).toHaveBeenCalledWith('v_2');
  });
});

describe('StatsPanel delete', () => {
  it('deletes analytics only after confirming', async () => {
    const { onDeleteAnalytics, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Delete analytics' }));
    expect(onDeleteAnalytics).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Delete viewer analytics?' });

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(onDeleteAnalytics).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps analytics when the confirmation is cancelled', async () => {
    const { onDeleteAnalytics, user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Delete analytics' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onDeleteAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it.each([
    [402, 'upgrade_required', 'Upgrade your plan to see stats.'],
    [403, 'organization_inactive', 'Your organization is inactive.'],
  ])('shows a %i refusal with its own message and no Retry', (status, code, message) => {
    renderPanel({ data: null, error: { status, code, message } });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  // Retry reloads the stats; it would not repeat the refused action.
  it('keeps the numbers on screen and offers no Retry when an action fails', () => {
    renderPanel({ error: { status: 503, code: null, message: 'Publishing is busy right now.' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Publishing is busy right now.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(metric('Views')).getByText('152')).toBeInTheDocument();
  });

  it('asks for credits, with a link to add them, when turning analytics on is refused', async () => {
    const { user } = renderPanel({
      data: { ...DATA, tracking: false },
      error: { status: 402, code: 'credits_required', message: 'Add credits to collect viewer analytics.' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Add credits to collect viewer analytics.');
    await user.click(screen.getByRole('button', { name: 'Add credits' }));

    expect(host.openExternal).toHaveBeenCalledTimes(1);
    expect(host.openExternal.mock.calls[0][0]).toMatch(/^https:\/\//);
  });
});
