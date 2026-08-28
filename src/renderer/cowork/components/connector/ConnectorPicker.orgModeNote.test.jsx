// The org-mode desktop-app note used to live in the dead ConnectWorkflowView
// (unreachable — CustomizeView always delegates "+ Connect" to this picker
// instead). This is the live surface now, so the note lives here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

vi.mock('../../api', () => ({
  fetchConnectors: vi.fn(() => Promise.resolve([
    { id: 'google_drive', label: 'Google Drive', category: 'files' },
    { id: 'gmail', label: 'Gmail', category: 'communication' },
  ])),
}));
const openExternal = vi.fn();
vi.mock('../../../platform/host', () => ({
  host: { openExternal: (...args) => openExternal(...args) },
}));

import ConnectorPicker from './ConnectorPicker';

const NOTE_TEXT = /The full range of connectors is coming soon to Cowork Cloud\./;

describe('ConnectorPicker org-mode desktop note', () => {
  beforeEach(() => {
    openExternal.mockClear();
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
});
