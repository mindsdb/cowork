// A custom connector's connect form submits to its own route and never to the
// chat: not on Connect, not on a failure, and not on Cancel.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  connectCustomConnector: vi.fn(),
  submitDataVaultForm: vi.fn(),
}));
vi.mock('../../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('../../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: { openExternal: vi.fn(), isWeb: true, isElectron: false, getApiOrigin: () => 'http://x', getAccessToken: async () => null },
}));

import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, getForm, getFormState, setForm } from './formStore';
import { toCustomConnectSpec } from '../../lib/customConnect';

const CID = 'conv-custom-connect';
const KEY = 'sk_live_typed_by_the_member';

const SPEC = toCustomConnectSpec({
  form_id: 'acme_crm-connector',
  title: 'Connect Acme CRM',
  engine: 'acme_crm',
  _connector_id: 'acme_crm',
  fields: [{ name: 'api_key', label: 'API key', type: 'password', secret: true, required: true }],
}, { path: '/v1/me', headers: { Authorization: 'Bearer {api_key}' } }, 'Acme CRM');

function renderPanel() {
  const handlers = { onSubmit: vi.fn(), onContinue: vi.fn(), onClose: vi.fn() };
  render(<DataVaultFormPanel conversationId={CID} {...handlers} />);
  return handlers;
}

async function fillAndConnect() {
  await userEvent.type(await screen.findByLabelText(/^API address/i), 'api.acme.example');
  await userEvent.type(screen.getByLabelText(/^API key/i), KEY);
  await userEvent.click(screen.getByRole('button', { name: /connect/i }));
}

beforeEach(() => {
  setForm(CID, { ...SPEC });
});

afterEach(() => {
  clearForm(CID);
  vi.clearAllMocks();
});

describe('connecting a custom connector', () => {
  it('sends the address and values to the connect route and shows the stored connection', async () => {
    api.connectCustomConnector.mockResolvedValue({ id: 7, connector_id: 'acme_crm', name: 'Acme CRM', status: 'verified' });
    const changed = vi.fn();
    window.addEventListener('anton:connections-changed', changed);
    const { onSubmit, onContinue } = renderPanel();

    await fillAndConnect();

    await waitFor(() => expect(getForm(CID)?._is_success).toBe(true));
    expect(api.connectCustomConnector).toHaveBeenCalledWith('acme_crm', {
      name: 'Acme CRM', address: 'api.acme.example', values: { api_key: KEY },
    });
    expect(getForm(CID).title).toBe('Connected Acme CRM');
    // The success screen's own buttons, not the form's Connect and Cancel.
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View connectors/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Connect' })).toBeNull();
    expect(changed).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(api.submitDataVaultForm).not.toHaveBeenCalled();
    window.removeEventListener('anton:connections-changed', changed);
  });

  it('shows a failed check with the provider excerpt and sends nothing to the chat', async () => {
    api.connectCustomConnector.mockRejectedValue(Object.assign(new Error(''), {
      status: 422,
      code: 'authentication_failed',
      body: { detail: { code: 'authentication_failed', provider_status: 401, excerpt: '<b>bad key ***</b>' } },
    }));
    const { onSubmit, onContinue } = renderPanel();

    await fillAndConnect();

    const shown = await screen.findByText(/The provider refused these credentials/);
    // Plain text: the provider's markup is shown as typed, never rendered.
    expect(shown.textContent).toContain('It said: <b>bad key ***</b>');
    expect(getForm(CID)._is_success).toBeFalsy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('closes on Cancel without a message to the chat', async () => {
    const { onContinue, onClose } = renderPanel();

    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledWith(CID);
    expect(onContinue).not.toHaveBeenCalled();
    expect(api.connectCustomConnector).not.toHaveBeenCalled();
  });

  it('publishes no snapshot of its values for the conversation', async () => {
    renderPanel();

    await userEvent.type(await screen.findByLabelText(/^API key/i), KEY);

    expect(getFormState(CID)).toBeFalsy();
  });
});
