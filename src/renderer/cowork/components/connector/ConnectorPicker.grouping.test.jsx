// Directory grouping rules, which differ by build:
//   • desktop — Featured on top, then every category; a featured connector
//     appears in both, which reads as a shortcut across ~213 connectors
//   • cloud — too few connectors to bother with category sections, so the
//     available ones are one "Available here" block. The server already
//     scopes the response to the cloud allow-list, so nothing else is listed.

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

const GMAIL = {
  id: 'gmail', label: 'Gmail', category: 'communication', featured: true,
};
const DRIVE = {
  id: 'google_drive', label: 'Google Drive', category: 'files', featured: true,
};
const SLACK = { id: 'slack', label: 'Slack', category: 'communication' };

const CLOUD_AVAILABLE_TITLE = 'Available here (MindsHub Cloud)';

// The section heading and its grid are siblings, so scope tile lookups to the
// heading's parent rather than the whole dialog.
function section(title) {
  return screen.getByText(title, { exact: false }).closest('div').parentElement;
}

afterEach(() => {
  setOrgMode(false);
  fetchConnectors.mockReset();
});

describe('ConnectorPicker grouping', () => {
  it('keeps Featured and category sections on desktop, duplicates included', async () => {
    fetchConnectors.mockResolvedValue([GMAIL, DRIVE, SLACK]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    // Gmail is featured, so it shows twice: once under Featured, once under
    // its own category. That is deliberate on desktop.
    expect(await screen.findAllByText('Gmail')).toHaveLength(2);
    expect(within(section('Featured')).getByText('Gmail')).toBeInTheDocument();
    const communication = section('Communication');
    expect(within(communication).getByText('Gmail')).toBeInTheDocument();
    expect(within(communication).getByText('Slack')).toBeInTheDocument();
    expect(within(communication).getByText('2')).toBeInTheDocument();
  });

  it('lists every available connector once under "Available here" on cloud', async () => {
    fetchConnectors.mockResolvedValue([
      GMAIL,
      DRIVE,
      // Not flagged `featured` — it must still be listed, not swallowed.
      { ...SLACK, cloud_available: true },
    ]);
    setOrgMode(true);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Gmail');
    const availableHere = section(CLOUD_AVAILABLE_TITLE);
    expect(within(availableHere).getByText('Gmail')).toBeInTheDocument();
    expect(within(availableHere).getByText('Google Drive')).toBeInTheDocument();
    expect(within(availableHere).getByText('Slack')).toBeInTheDocument();
    // One tile each, and no per-category or "Featured" sections at all.
    expect(screen.getAllByText('Gmail')).toHaveLength(1);
    expect(screen.queryByText('Featured')).toBeNull();
    expect(screen.queryByText('Communication')).toBeNull();
    expect(screen.queryByText('Files')).toBeNull();
  });

  it('asks the server for the plain connector list regardless of mode', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);

    setOrgMode(true);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Gmail');
    expect(fetchConnectors).toHaveBeenCalledWith();

    fetchConnectors.mockClear();
    setOrgMode(false);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('Gmail');
    expect(fetchConnectors).toHaveBeenCalledWith();
  });

  it('never lists a desktop-only catalogue on cloud, even if the server sent one', async () => {
    fetchConnectors.mockResolvedValue([
      GMAIL,
      { ...SLACK, cloud_available: false },
    ]);
    setOrgMode(true);

    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Gmail');
    // Cloud's server-side allow-list already excludes anything it doesn't
    // support; the picker doesn't re-split or surface a desktop-only group.
    expect(within(section(CLOUD_AVAILABLE_TITLE)).getByText('Slack')).toBeInTheDocument();
    expect(screen.queryByText('Connectors available in Cowork Desktop App')).toBeNull();
  });
});
