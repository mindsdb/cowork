// Desktop repeats featured connectors as category entries; Cloud separates available connectors
// from desktop-only download links.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

const DESKTOP_ONLY_TITLE = 'Connectors available in Cowork Desktop App';
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
    expect(screen.getAllByText('Gmail')).toHaveLength(1);
    expect(screen.queryByText('Featured')).toBeNull();
    expect(screen.queryByText('Communication')).toBeNull();
    expect(screen.queryByText('Files')).toBeNull();
  });

  it('asks the server for desktop-only connectors in cloud mode only', async () => {
    fetchConnectors.mockResolvedValue([GMAIL]);

    setOrgMode(true);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findByText('Gmail');
    expect(fetchConnectors).toHaveBeenCalledWith({ includeUnavailable: true });

    fetchConnectors.mockClear();
    setOrgMode(false);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);
    await screen.findAllByText('Gmail');
    expect(fetchConnectors).toHaveBeenCalledWith({ includeUnavailable: false });
  });

  it('groups cloud-unavailable connectors and routes their pick to onDesktopOnly', async () => {
    const onPick = vi.fn();
    const onDesktopOnly = vi.fn();
    fetchConnectors.mockResolvedValue([
      GMAIL,
      { ...SLACK, cloud_available: false },
    ]);
    setOrgMode(true);

    render(
      <ConnectorPicker open onPick={onPick} onDesktopOnly={onDesktopOnly} onClose={vi.fn()} />,
    );

    await screen.findByText('Gmail');
    const desktop = section(DESKTOP_ONLY_TITLE);
    expect(within(desktop).getByText('Slack')).toBeInTheDocument();
    // Gmail is available on cloud, so it must not be in the desktop-only group.
    expect(within(desktop).queryByText('Gmail')).toBeNull();

    fireEvent.click(within(desktop).getByText('Slack'));
    expect(onDesktopOnly).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'slack' }),
    );
    expect(onPick).not.toHaveBeenCalled();
  });

  it('shows no desktop-only group when every connector is available', async () => {
    fetchConnectors.mockResolvedValue([GMAIL, SLACK]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    // Featured + category on desktop, so Gmail matches more than once.
    await screen.findAllByText('Gmail');
    expect(screen.queryByText(DESKTOP_ONLY_TITLE)).toBeNull();
  });
});
