// The org-mode desktop-app note now renders from one shared component used
// by both the main connectors list and the connectors directory modal —
// this covers both call sites so a future refactor can't silently drop one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { setOrgMode } from '../../lib/orgMode';

vi.mock('../api', () => ({
  fetchIntegrations: vi.fn(() => Promise.resolve({ items: [] })),
  startConnectorOAuth: vi.fn(),
  pollConnectorOAuth: vi.fn(),
}));
vi.mock('../lib/analytics', () => ({
  trackDataSourceConnected: vi.fn(),
}));
const openExternal = vi.fn();
vi.mock('../../platform/host', () => ({
  host: { openExternal: (...args) => openExternal(...args) },
}));

import ConnectWorkflowView from './ConnectWorkflowView';

const NOTE_TEXT = /More connectors are not available on Cloud just yet\./;

describe('ConnectWorkflowView org-mode desktop note', () => {
  beforeEach(() => {
    openExternal.mockClear();
  });

  afterEach(() => {
    setOrgMode(false);
  });

  it('renders the note and CTA on the main connectors list, and links to the desktop download page', async () => {
    setOrgMode(true);
    render(<ConnectWorkflowView onClose={vi.fn()} />);

    expect(await screen.findByText(NOTE_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByText('use other connectors in the desktop app'));
    expect(openExternal).toHaveBeenCalledWith('https://mindshub.ai/download');
  });

  it('renders the same note and CTA in the connectors directory modal', async () => {
    setOrgMode(true);
    render(<ConnectWorkflowView onClose={vi.fn()} />);
    await screen.findByText(NOTE_TEXT);

    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }));
    const dialog = screen.getByRole('dialog', { name: 'Customize directory' });

    expect(within(dialog).getByText(NOTE_TEXT)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText('use other connectors in the desktop app'));
    expect(openExternal).toHaveBeenCalledWith('https://mindshub.ai/download');
  });

  it('does not render the note when org mode is off', async () => {
    setOrgMode(false);
    render(<ConnectWorkflowView onClose={vi.fn()} />);

    await screen.findByRole('button', { name: 'Add connector' });
    expect(screen.queryByText(NOTE_TEXT)).toBeNull();
  });
});
