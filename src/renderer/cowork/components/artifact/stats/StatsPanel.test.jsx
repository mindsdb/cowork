import { act, render, screen, within } from '@testing-library/react';
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
    { key: 's3', index: 3, label: 'Team', avg_seconds: 0.4, reach: 0.25 },
  ],
  viewers: [
    {
      id: 'v_1', kind: 'email', email: 'a@example.com', visits: 3, total_seconds: 240,
      first_seen: hoursAgo(30), last_seen: hoursAgo(3), furthest: 2,
      last_device: 'desktop', last_os: 'macOS',
      last_location: { city: 'Lisbon', region: 'Lisbon', country: 'Portugal' },
      completion: 0.75,
    },
    // Recorded before the backend sent device, OS, location and completion.
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
      id: 'visit-1', started_at: '2026-11-17T10:42:00Z', seconds: 95, device: 'desktop', os: 'macOS',
      location: { city: 'Lisbon', region: 'Lisbon', country: 'Portugal' }, furthest: 2,
      sections: [
        { key: 's1', index: 1, label: 'Intro', seconds: 12 },
        { key: 's2', index: 2, label: 'Pricing', seconds: 83 },
      ],
    },
    {
      id: 'visit-2', started_at: '2026-11-18T09:05:00Z', seconds: 30.2, device: 'mobile', os: 'iOS',
      location: { city: 'Porto', region: null, country: 'Portugal' }, furthest: 2,
      sections: [
        { key: 's1', index: 1, label: 'Intro', seconds: 30 },
        { key: 's2', index: 2, label: 'Pricing', seconds: 0.2 },
      ],
    },
  ],
};
// One visit with nothing but its time: no OS, no location, no device.
const BARE_DETAIL = {
  viewer: ANALYTICS.viewers[1],
  visits: [{ id: 'visit-9', started_at: '2026-11-18T08:00:00Z', seconds: 84, sections: [{ key: 's1', index: 1, seconds: 84 }] }],
};
const opened = (id, data, extra = {}) => ({ viewer: { id, data, loading: false, error: null, ...extra } });

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

  it('charts the average time per page in page order, with the reach of each', () => {
    renderPanel();

    const chart = screen.getByRole('group', { name: 'Average time per page, all viewers' });
    const bars = within(chart).getAllByRole('button');
    expect(bars.map((bar) => bar.getAttribute('aria-label'))).toEqual([
      'Page 1 of 3, Intro: 42s on average, reached by 100% of visits',
      'Page 2 of 3, Pricing: 21s on average, reached by 50% of visits',
      'Page 3 of 3, Team: 0s on average, reached by 25% of visits',
    ]);
    // Heights scale to the y-axis top (an even 45s over the longest 42s).
    const fills = bars.map((bar) => bar.firstElementChild.style.height);
    expect(parseFloat(fills[0])).toBeCloseTo((42 / 45) * 100);
    expect(parseFloat(fills[1])).toBeCloseTo((21 / 45) * 100);
    // A glance too short to see still gets a sliver.
    expect(bars[2].firstElementChild.style.minHeight).toBe('2px');
  });

  it('shows a page\'s average time and reach on hover', async () => {
    const { user } = renderPanel();
    const chart = screen.getByRole('group', { name: 'Average time per page, all viewers' });

    await user.hover(within(chart).getAllByRole('button')[2]);

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Page 3 / 3');
    expect(tip).toHaveTextContent('Team');
    expect(tip).toHaveTextContent('Avg. time00:00.4');
    expect(tip).toHaveTextContent('Reached25%');
    expect(within(chart).getAllByRole('button')[2]).toHaveAttribute('aria-describedby', tip.id);
  });

  it('leaves the time-per-page chart and an unknown completion out, keeping the average time', () => {
    renderPanel({ data: { ...DATA, analytics: { ...ANALYTICS, sections: [], completion: null } } });

    expect(screen.queryByRole('group', { name: 'Average time per page, all viewers' })).toBeNull();
    expect(screen.queryByText('Completion')).toBeNull();
    expect(within(metric('Avg. time')).getByText('1m 25s')).toBeInTheDocument();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('lists every viewer with visits, last seen, total time and how much they saw', () => {
    renderPanel();

    const list = screen.getByRole('list', { name: 'All visits' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('a@example.com');
    expect(rows[0]).toHaveTextContent('3 visits · 3h ago');
    expect(rows[0]).toHaveTextContent('04:00');
    expect(rows[0]).toHaveAccessibleName(/Total time 4m/);
    expect(rows[1]).toHaveTextContent('Anonymous viewer');
    expect(rows[1]).toHaveTextContent('1 visit · 5h ago');
    expect(rows[1]).toHaveTextContent('01:24');
    expect(screen.getByText('2 viewers')).toBeInTheDocument();
  });

  it('draws a completion ring filled to the share each viewer saw', () => {
    renderPanel();

    const ring = screen.getByRole('img', { name: 'Viewed: 75%' });
    expect(ring).toHaveAttribute('data-completion', '0.75');
    const progress = ring.querySelectorAll('circle')[1];
    const circumference = Number(progress.getAttribute('stroke-dasharray'));
    expect(Number(progress.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.25);
    // No completion recorded for the anonymous viewer: no ring.
    expect(screen.getAllByRole('img', { name: /^Viewed:/ })).toHaveLength(1);
  });

  it('unfolds a viewer row in place', async () => {
    const { onOpenViewer, user } = renderPanel();
    const row = screen.getByRole('button', { name: /Anonymous viewer/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(row);

    expect(onOpenViewer).toHaveBeenCalledWith('v_2');
  });

  it('folds an open row back up', async () => {
    const { onCloseViewer, onOpenViewer, user } = renderPanel(opened('v_1', DETAIL));
    const row = screen.getByRole('button', { name: /a@example\.com/ });
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveAttribute('aria-controls', screen.getByRole('region', { name: 'a@example.com' }).id);

    await user.click(row);

    expect(onCloseViewer).toHaveBeenCalledTimes(1);
    expect(onOpenViewer).not.toHaveBeenCalled();
  });

  it('falls back to the recorded emails when there is no analytics yet', () => {
    renderPanel({ data: { ...DATA, analytics: null } });

    const table = screen.getByRole('table');
    expect(within(table).getByText('a@example.com')).toBeInTheDocument();
    // No timing without analytics: no empty tiles.
    expect(screen.queryByText('Avg. time')).toBeNull();
    expect(screen.queryByText('Completion')).toBeNull();
    expect(within(metric('Unique viewers')).getByText('1')).toBeInTheDocument();
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

// The panel shows what the data holds (ENG-4455): views, viewers, the chart
// and the visitor list always; time, completion and time per page only with
// timing data, never as empty tiles.
describe('StatsPanel without timing data', () => {
  // Views and viewers recorded, but no visit timed and no page read.
  const UNTIMED = {
    ...DATA,
    analytics: {
      visits: 0,
      avg_seconds: 0,
      completion: null,
      sections: [],
      viewers: [
        { id: 'v_1', kind: 'email', email: 'a@example.com', visits: 2, total_seconds: 0, last_seen: hoursAgo(3), completion: 0 },
        { id: 'v_2', kind: 'anonymous', email: null, visits: 1, total_seconds: 0, last_seen: hoursAgo(5) },
      ],
    },
  };

  it('shows views, unique viewers, the chart and the visitor list, and no timing tiles or charts', () => {
    renderPanel({ data: UNTIMED });

    expect(within(metric('Views')).getByText('152')).toBeInTheDocument();
    expect(within(metric('Unique viewers')).getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Avg. time')).toBeNull();
    expect(screen.queryByText('Completion')).toBeNull();
    expect(screen.queryByText('Time per page')).toBeNull();
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.getByTestId('stats-chart')).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'All visits' })).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('a@example.com'),
      expect.stringContaining('Anonymous viewer'),
    ]);
  });

  it('gives a viewer row no time or completion ring', () => {
    renderPanel({ data: UNTIMED });

    const row = screen.getByRole('button', { name: /a@example\.com/ });
    expect(row).not.toHaveTextContent('00:00');
    expect(row).not.toHaveAccessibleName(/Total time/);
    expect(screen.queryByRole('img', { name: /^Viewed:/ })).toBeNull();
  });

  it('opens a viewer on their device and place, with no page bars', () => {
    renderPanel({ data: UNTIMED, ...opened('v_1', DETAIL) });

    const region = screen.getByRole('region', { name: 'a@example.com' });
    expect(within(region).getByText('Desktop')).toBeInTheDocument();
    expect(within(region).queryByRole('group', { name: /^Time per page/ })).toBeNull();
  });

  it('keeps timing out when visits were counted but none was timed', () => {
    renderPanel({ data: { ...UNTIMED, analytics: { ...UNTIMED.analytics, visits: 4 } } });

    expect(screen.queryByText('Avg. time')).toBeNull();
    expect(screen.queryByText('Time per page')).toBeNull();
  });

  it('lists only the viewers the analytics recorded: no anonymous row it did not send', () => {
    renderPanel({ data: { ...UNTIMED, analytics: { ...UNTIMED.analytics, viewers: UNTIMED.analytics.viewers.slice(0, 1) } } });

    expect(screen.queryByText('Anonymous viewer')).toBeNull();
  });
});

describe('StatsPanel unique viewers', () => {
  it('counts the analytics viewers when they are more than the recorded emails', () => {
    renderPanel({ data: { ...DATA, unique_viewers: 1 } });
    expect(within(metric('Unique viewers')).getByText('2')).toBeInTheDocument();
  });

  it('counts the recorded emails when they are more than the analytics viewers', () => {
    renderPanel({ data: { ...DATA, unique_viewers: 5 } });
    expect(within(metric('Unique viewers')).getByText('5')).toBeInTheDocument();
  });
});

describe('StatsPanel open viewer', () => {
  const viewerChart = () => screen.getByRole('group', { name: 'Time per page, a@example.com' });
  const barLabels = (chart) => within(chart).getAllByRole('button').map((bar) => bar.getAttribute('aria-label'));

  it('shows the device, OS and location, and the time per page over every visit', () => {
    renderPanel(opened('v_1', DETAIL));

    const region = screen.getByRole('region', { name: 'a@example.com' });
    expect(within(region).getByText('Device, OS & location')).toBeInTheDocument();
    expect(within(region).getByText('Desktop')).toBeInTheDocument();
    expect(within(region).getByText('macOS')).toBeInTheDocument();
    expect(within(region).getByText('Lisbon, Lisbon, Portugal')).toBeInTheDocument();
    // One bar per section of the page, summed over both visits; Team was never reached.
    expect(barLabels(viewerChart())).toEqual([
      'Page 1 of 3, Intro: 42s',
      'Page 2 of 3, Pricing: 1m 23s',
      'Page 3 of 3, Team: 0s',
    ]);
    // The rest of the list stays where it was.
    expect(screen.getByRole('button', { name: /Anonymous viewer/ })).toBeInTheDocument();
  });

  it('shows a bar\'s page, heading and time on hover', async () => {
    const { user } = renderPanel(opened('v_1', DETAIL));

    await user.hover(within(viewerChart()).getAllByRole('button')[1]);

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Page 2 / 3');
    expect(tip).toHaveTextContent('Pricing');
    expect(tip).toHaveTextContent('Time spent01:23');
  });

  it('shows the same card on keyboard focus and moves between bars with the arrow keys', async () => {
    const { user } = renderPanel(opened('v_1', DETAIL));
    const bars = within(viewerChart()).getAllByRole('button');
    // One tab stop for the whole chart.
    expect(bars.map((bar) => bar.tabIndex)).toEqual([0, -1, -1]);

    act(() => bars[0].focus());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Page 1 / 3');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Intro');

    await user.keyboard('{ArrowRight}');
    expect(bars[1]).toHaveFocus();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Page 2 / 3');
    await user.keyboard('{End}');
    expect(bars[2]).toHaveFocus();
    expect(bars.map((bar) => bar.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('picks one visit from the list to see its bars, device and place', async () => {
    const { user } = renderPanel(opened('v_1', DETAIL));
    const picker = screen.getByRole('combobox', { name: 'Visit' });
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All 2 visits · 02:05',
      expect.stringMatching(/ · 01:35 · Desktop$/),
      expect.stringMatching(/ · 00:30 · Mobile$/),
    ]);

    await user.selectOptions(picker, 'visit-2');

    const chart = screen.getByRole('group', { name: /^Time per page, a@example\.com, visit of / });
    expect(barLabels(chart)).toEqual(['Page 1 of 3, Intro: 30s', 'Page 2 of 3, Pricing: 0s', 'Page 3 of 3, Team: 0s']);
    const region = screen.getByRole('region', { name: 'a@example.com' });
    expect(within(region).getByText('Mobile')).toBeInTheDocument();
    expect(within(region).getByText('iOS')).toBeInTheDocument();
    expect(within(region).getByText('Porto, Portugal')).toBeInTheDocument();

    // A glance under a minute keeps its tenth of a second.
    await user.hover(within(chart).getAllByRole('button')[1]);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Time spent00:00.2');
  });

  it('renders a visit with no OS, location or device', () => {
    renderPanel(opened('v_2', BARE_DETAIL));

    const region = screen.getByRole('region', { name: 'Anonymous viewer' });
    expect(within(region).getByText('Unknown device')).toBeInTheDocument();
    expect(within(region).queryByRole('combobox')).toBeNull();
    expect(barLabels(within(region).getByRole('group'))).toEqual([
      'Page 1 of 3, Intro: 1m 24s',
      'Page 2 of 3, Pricing: 0s',
      'Page 3 of 3, Team: 0s',
    ]);
  });

  it('shows the visits loading inside the row', () => {
    renderPanel(opened('v_2', null, { loading: true }));

    const region = screen.getByRole('region', { name: 'Anonymous viewer' });
    expect(within(region).getByRole('status', { name: 'Loading visits' })).toBeInTheDocument();
  });

  it('retries a failed viewer load for that viewer', async () => {
    const { onOpenViewer, user } = renderPanel(
      opened('v_2', null, { error: { status: 502, code: null, message: 'Could not reach MindsHub.' } }),
    );

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
