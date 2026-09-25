// The org-mode desktop-app note used to live in the dead ConnectWorkflowView
// (unreachable — CustomizeView always delegates "+ Connect" to this picker
// instead). This is the live surface now, so the note lives here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
}));
const openExternal = vi.fn();
vi.mock('../../../platform/host', () => ({
  host: { openExternal: (...args) => openExternal(...args) },
}));

import ConnectorPicker from './ConnectorPicker';

const NOTE_TEXT = /More connectors are on the way here\./;

describe('ConnectorPicker org-mode desktop note', () => {
  beforeEach(() => {
    openExternal.mockClear();
    // Cloud's real shape: some connectors run here, the rest are desktop-only.
    fetchConnectors.mockResolvedValue([
      { id: 'google_drive', label: 'Google Drive', category: 'files' },
      { id: 'gmail', label: 'Gmail', category: 'communication' },
      { id: 'jira', label: 'Jira', category: 'productivity', cloud_available: false },
    ]);
  });

  afterEach(() => {
    setOrgMode(false);
  });

  it('renders the note and links to the desktop download page when org mode is on', async () => {
    setOrgMode(true);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    expect(await screen.findByText(NOTE_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cowork Desktop App'));
    expect(openExternal).toHaveBeenCalledWith('https://mindshub.ai/download');
  });

  it('does not render the note when org mode is off', async () => {
    setOrgMode(false);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('Google Drive');
    expect(screen.queryByText(NOTE_TEXT)).toBeNull();
  });

  it('says nothing about the desktop app once every connector runs here', async () => {
    setOrgMode(true);
    fetchConnectors.mockResolvedValue([
      { id: 'postgres', label: 'PostgreSQL', category: 'database' },
      { id: 'gmail', label: 'Gmail', category: 'communication' },
    ]);
    render(<ConnectorPicker open onPick={vi.fn()} onClose={vi.fn()} />);

    await screen.findByText('PostgreSQL');
    expect(screen.queryByText(NOTE_TEXT)).toBeNull();
  });
});
