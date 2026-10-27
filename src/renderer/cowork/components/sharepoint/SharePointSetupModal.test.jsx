import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createSharePointConnection: vi.fn(),
  editSharePointConnection: vi.fn(),
  fetchConnector: vi.fn(),
  fetchSavedConnection: vi.fn(),
}));

vi.mock('../../api', () => ({
  CONNECTIONS_VAULT_KEEP: 'ANTON_VAULT_KEEP',
  ...mocks,
}));

import SharePointSetupModal from './SharePointSetupModal';

const SECRET = 'typed-client-secret-7f3a';

function Harness({ name = null, onSaved = () => {} }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reopen</button>
      <SharePointSetupModal
        open={open}
        name={name}
        onClose={() => setOpen(false)}
        onSaved={(saved) => { onSaved(saved); setOpen(false); }}
      />
    </>
  );
}

async function fillKey(user, { secret = SECRET } = {}) {
  await user.type(screen.getByLabelText(/connection name/i), 'corp');
  await user.type(screen.getByLabelText(/tenant/i), 'contoso.onmicrosoft.com');
  await user.type(screen.getByLabelText(/client\) id/i), '11111111-2222-3333-4444-555555555555');
  if (secret) await user.type(screen.getByLabelText(/client secret/i), secret);
  await user.type(screen.getByLabelText(/site addresses/i), 'https://contoso.sharepoint.com/sites/team');
}

describe('SharePointSetupModal', () => {
  beforeEach(() => {
    mocks.fetchConnector.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
  });
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('creates a connection through the SharePoint route and announces it', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);
    mocks.createSharePointConnection.mockResolvedValue({ ok: true, name: 'corp', user_label: null });
    render(<Harness onSaved={onSaved} />);

    await fillKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ ok: true, name: 'corp', user_label: null }));
    expect(mocks.createSharePointConnection).toHaveBeenCalledWith({
      name: 'corp',
      userLabel: '',
      tenantId: 'contoso.onmicrosoft.com',
      clientId: '11111111-2222-3333-4444-555555555555',
      clientSecret: SECRET,
      siteUrls: 'https://contoso.sharepoint.com/sites/team',
    });
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener('anton:connections-changed', changed);
  });

  it('cannot save without a secret on a new connection', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await fillKey(user, { secret: '' });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('edits with the keep sentinel for an untouched secret and sends only the route fields', async () => {
    const user = userEvent.setup();
    mocks.fetchSavedConnection.mockResolvedValue({
      user_label: 'Corp',
      fields: {
        tenant_id: 'contoso.onmicrosoft.com',
        client_id: '11111111-2222-3333-4444-555555555555',
        client_secret: 'ANTON_VAULT_KEEP',
        site_urls: 'https://contoso.sharepoint.com/sites/team',
        _access_mode: 'read',
      },
    });
    mocks.editSharePointConnection.mockResolvedValue({ ok: true, name: 'corp', user_label: 'Corp' });
    render(<Harness name="corp" />);

    await waitFor(() => expect(screen.getByLabelText(/tenant/i)).toHaveValue('contoso.onmicrosoft.com'));
    expect(screen.queryByLabelText(/connection name/i)).toBeNull();
    expect(screen.getByLabelText(/client secret/i)).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.editSharePointConnection).toHaveBeenCalled());
    expect(mocks.fetchSavedConnection).toHaveBeenCalledWith('sharepoint', 'corp');
    expect(mocks.editSharePointConnection).toHaveBeenCalledWith('corp', {
      userLabel: 'Corp',
      tenantId: 'contoso.onmicrosoft.com',
      clientId: '11111111-2222-3333-4444-555555555555',
      clientSecret: 'ANTON_VAULT_KEEP',
      siteUrls: 'https://contoso.sharepoint.com/sites/team',
    });
  });

  it('a typed secret replaces the saved one on edit', async () => {
    const user = userEvent.setup();
    mocks.fetchSavedConnection.mockResolvedValue({
      user_label: null,
      fields: { tenant_id: 't.onmicrosoft.com', client_id: 'c', client_secret: 'ANTON_VAULT_KEEP', site_urls: 'https://t.sharepoint.com' },
    });
    mocks.editSharePointConnection.mockResolvedValue({ ok: true, name: 'corp', user_label: null });
    render(<Harness name="corp" />);

    await waitFor(() => expect(screen.getByLabelText(/tenant/i)).toHaveValue('t.onmicrosoft.com'));
    await user.type(screen.getByLabelText(/client secret/i), SECRET);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.editSharePointConnection).toHaveBeenCalled());
    expect(mocks.editSharePointConnection.mock.calls[0][1].clientSecret).toBe(SECRET);
  });

  it.each([
    [409, 'A SharePoint connection with this name already exists.'],
    [422, "Microsoft rejected the client secret. Check that it is right and hasn't expired."],
  ])("shows the server's %s message and keeps the form open", async (status, detail) => {
    const user = userEvent.setup();
    mocks.createSharePointConnection.mockRejectedValue(Object.assign(new Error(detail), { status }));
    render(<Harness />);

    await fillKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(screen.getByLabelText(/client secret/i)).toBeInTheDocument();
  });

  it('drops the typed secret when cancelled', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText(/client secret/i), SECRET);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'reopen' }));

    expect(screen.getByLabelText(/client secret/i)).toHaveValue('');
  });

  it('drops the typed secret after a save', async () => {
    const user = userEvent.setup();
    mocks.createSharePointConnection.mockResolvedValue({ ok: true, name: 'corp', user_label: null });
    render(<Harness />);

    await fillKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).toBeNull());
    await user.click(screen.getByRole('button', { name: 'reopen' }));

    expect(screen.getByLabelText(/client secret/i)).toHaveValue('');
  });

  it('offers the spec\'s setup steps when the server has them', async () => {
    mocks.fetchConnector.mockResolvedValue({ form: { methods: [{ id: 'app-key', how_to: '## Steps\n1. Register an app' }] } });
    render(<Harness />);

    expect(await screen.findByRole('button', { name: 'Setup steps' })).toBeInTheDocument();
  });
});
