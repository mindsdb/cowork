import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSharePointConnection: vi.fn(),
  editSharePointConnection: vi.fn(),
  fetchConnector: vi.fn(),
  fetchSavedConnection: vi.fn(),
  listSharePointLibraries: vi.fn(),
  listSharePointChildren: vi.fn(),
  importSharePointFiles: vi.fn(),
}));

vi.mock('../../api', () => ({ CONNECTIONS_VAULT_KEEP: 'ANTON_VAULT_KEEP', ...mocks }));

import { useSharePointImport } from './useSharePointImport';

const SITE = 'https://contoso.sharepoint.com/sites/team';

function Launcher({ connections, orgMode = false, onConnectionsChanged }) {
  const { startSharePointImport, sharePointModals } = useSharePointImport({ connections, orgMode, onConnectionsChanged });
  return (
    <>
      {startSharePointImport
        ? <button type="button" onClick={() => startSharePointImport('Sales')}>Add from SharePoint</button>
        : <span>No SharePoint here</span>}
      {sharePointModals}
    </>
  );
}

beforeEach(() => {
  mocks.fetchConnector.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  mocks.fetchSavedConnection.mockResolvedValue({ fields: { site_urls: SITE } });
  mocks.listSharePointLibraries.mockResolvedValue({ libraries: [{ id: 'b!Lib', name: 'Documents' }] });
  mocks.listSharePointChildren.mockResolvedValue({ items: [], cursor: null });
});
afterEach(() => {
  vi.resetAllMocks();
});

describe('useSharePointImport', () => {
  it('opens the import for an existing SharePoint connection', async () => {
    const user = userEvent.setup();
    render(<Launcher connections={[{ engine: 'sharepoint', name: 'corp' }, { engine: 'github', name: 'gh' }]} />);

    await user.click(screen.getByRole('button', { name: 'Add from SharePoint' }));

    expect(await screen.findByRole('dialog', { name: 'Add files from SharePoint' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchSavedConnection).toHaveBeenCalledWith('sharepoint', 'corp'));
  });

  it('sets up a connection first when there is none, then opens the import with it', async () => {
    const user = userEvent.setup();
    const onConnectionsChanged = vi.fn();
    mocks.createSharePointConnection.mockResolvedValue({ ok: true, name: 'corp', user_label: null });
    render(<Launcher connections={[]} onConnectionsChanged={onConnectionsChanged} />);

    await user.click(screen.getByRole('button', { name: 'Add from SharePoint' }));
    expect(await screen.findByRole('dialog', { name: 'Connect SharePoint' })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/connection name/i), 'corp');
    await user.type(screen.getByLabelText(/tenant/i), 'contoso.onmicrosoft.com');
    await user.type(screen.getByLabelText(/client\) id/i), '11111111-2222-3333-4444-555555555555');
    await user.type(screen.getByLabelText(/client secret/i), 'secret');
    await user.type(screen.getByLabelText(/site addresses/i), SITE);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('dialog', { name: 'Add files from SharePoint' })).toBeInTheDocument();
    expect(onConnectionsChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.fetchSavedConnection).toHaveBeenCalledWith('sharepoint', 'corp'));
  });

  it('offers nothing in org mode', () => {
    render(<Launcher connections={[{ engine: 'sharepoint', name: 'corp' }]} orgMode />);

    expect(screen.getByText('No SharePoint here')).toBeInTheDocument();
  });
});
