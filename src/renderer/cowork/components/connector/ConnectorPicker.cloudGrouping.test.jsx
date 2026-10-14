// Cloud grouping as the available set grows.
//
// Cloud used to run a handful of OAuth connectors, so one flat "Available
// here" block was the right shape. Databases add a second kind with its own
// category, and a flat list of mixed kinds is what the ticket calls an
// un-grouped growing capability set. Above a threshold the cloud side groups
// by category like desktop does; below it the flat block stays, because one
// tile per section reads worse than no sections at all.
//
// The desktop side is untouched by any of this and its own suite covers it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker from './ConnectorPicker';

const CLOUD_AVAILABLE_TITLE = 'Available here (MindsHub Cloud)';
const DESKTOP_ONLY_TITLE = 'Connectors available in Cowork Desktop App';

const POSTGRES = { id: 'postgres', label: 'PostgreSQL', category: 'database' };
const MYSQL = { id: 'mysql', label: 'MySQL', category: 'database' };
const GMAIL = { id: 'gmail', label: 'Gmail', category: 'communication' };
const DRIVE = { id: 'google_drive', label: 'Google Drive', category: 'files' };
const SLACK = { id: 'slack', label: 'Slack', category: 'communication' };
const NOTION = { id: 'notion', label: 'Notion', category: 'productivity' };
const DESKTOP_ONLY = { id: 'jira', label: 'Jira', category: 'productivity', cloud_available: false };

function section(title) {
  return screen.getByText(title, { exact: false }).closest('div').parentElement;
}

afterEach(() => {
  setOrgMode(false);
  fetchConnectors.mockReset();
});

describe('a cloud-available database', () => {
  it('is offered here rather than sent to the desktop download', async () => {
    setOrgMode(true);
    fetchConnectors.mockResolvedValue([{ ...POSTGRES, cloud_available: true }, DESKTOP_ONLY]);
    const onPick = vi.fn();
    render(<ConnectorPicker open onPick={onPick} onDesktopOnly={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
    expect(within(section(DESKTOP_ONLY_TITLE)).queryByText('PostgreSQL')).toBeNull();
    expect(within(section(DESKTOP_ONLY_TITLE)).getByText('Jira')).toBeInTheDocument();
  });
});

describe('cloud grouping', () => {
  it('groups by category once cloud runs enough connectors to sort through', async () => {
    setOrgMode(true);
    fetchConnectors.mockResolvedValue([POSTGRES, MYSQL, GMAIL, DRIVE, SLACK, NOTION]);
    render(<ConnectorPicker open onPick={vi.fn()} onDesktopOnly={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
    // The flat block is gone; the two databases sit together under their own
    // heading, and the count is what the desktop sections already show.
    expect(screen.queryByText(CLOUD_AVAILABLE_TITLE)).toBeNull();
    const databases = section('Databases');
    expect(within(databases).getByText('PostgreSQL')).toBeInTheDocument();
    expect(within(databases).getByText('MySQL')).toBeInTheDocument();
    expect(within(databases).getByText('2')).toBeInTheDocument();
    expect(within(section('Communication')).getByText('Gmail')).toBeInTheDocument();
  });

  it('keeps one flat block while cloud runs only a few', async () => {
    setOrgMode(true);
    fetchConnectors.mockResolvedValue([GMAIL, DRIVE]);
    render(<ConnectorPicker open onPick={vi.fn()} onDesktopOnly={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText('Gmail')).toBeInTheDocument();
    expect(screen.getByText(CLOUD_AVAILABLE_TITLE, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Communication')).toBeNull();
  });

  it('never groups on desktop, where Featured and every category already show', async () => {
    fetchConnectors.mockResolvedValue([POSTGRES, MYSQL, GMAIL, DRIVE, SLACK, NOTION]);
    render(<ConnectorPicker open onPick={vi.fn()} onDesktopOnly={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByText(CLOUD_AVAILABLE_TITLE)).toBeNull();
    expect(screen.getByText('Databases', { exact: false })).toBeInTheDocument();
  });
});
