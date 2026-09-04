// Directory grouping rules:
//   • a Featured connector is listed once, not again under its category
//   • cloud-only: connectors the hosted build can't run are listed under
//     their own group and hand the pick to the download-the-app path
// Both were visible in Cowork Cloud, where the available list is a handful
// of tiles and every duplicate reads as a bug.

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
  it('lists a featured connector once, not again under its category', async () => {
    fetchConnectors.mockResolvedValue([GMAIL, DRIVE, SLACK]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findAllByText('Gmail')).toHaveLength(1);
    expect(screen.getAllByText('Google Drive')).toHaveLength(1);
    // The non-featured connector still shows under its category.
    expect(within(section('Communication')).getByText('Slack')).toBeInTheDocument();
    // …and that category no longer counts the featured Gmail.
    expect(within(section('Communication')).getByText('1')).toBeInTheDocument();
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

    await screen.findByText('Gmail');
    expect(screen.queryByText(DESKTOP_ONLY_TITLE)).toBeNull();
  });
});
