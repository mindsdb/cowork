// What a cloud datasource form does with secrets and with its own values.
//
// Two separate guarantees:
//   • a field marked `secret` is masked whatever its declared type. Today
//     every secret in the registry is either a password (masked) or a
//     textarea (a PEM or JSON blob you have to see to paste), so this is the
//     guard for the next spec rather than a change to those.
//   • a cloud datasource form publishes no snapshot of its values. The chat
//     layer appends that snapshot to the next message the user sends, which
//     would put a host, database and username into the conversation and the
//     model.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataVaultForm } from './DataVaultForm';
import { clearForm, clearFormState, getFormState } from './formStore';

vi.mock('../../../platform/host', async (importOriginal) => ({
  ...(await importOriginal()),
  host: {
    openExternal: vi.fn(),
    isWeb: true,
    isElectron: false,
    getApiOrigin: () => 'http://127.0.0.1:26866',
    getAccessToken: async () => null,
  },
}));

const CID = 'conv-cloud-secrets';

const cloudSpec = (fields) => ({
  form_id: 'postgres-connector',
  title: 'Connect PostgreSQL',
  engine: 'postgres',
  _cloud_datasource: true,
  selected_method: 'host-port',
  methods: [{ id: 'host-port', label: 'Host and port', fields }],
});

afterEach(() => {
  clearForm(CID);
  clearFormState(CID);
  vi.restoreAllMocks();
});

describe('a secret field', () => {
  it('is masked when it is marked secret but typed as text', () => {
    render(
      <DataVaultForm
        conversationId={CID}
        spec={cloudSpec([{ name: 'password', label: 'Password', type: 'text', secret: true }])}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    // A hint to the browser, not a guarantee about what it stores.
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });

  it('keeps a secret textarea readable, because a PEM has to be pasted and seen', () => {
    render(
      <DataVaultForm
        conversationId={CID}
        spec={cloudSpec([{ name: 'ca_pem', label: 'CA certificate', type: 'textarea', secret: true }])}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('CA certificate').tagName).toBe('TEXTAREA');
  });

  it('still masks an ordinary password field and asks for no saved credential', () => {
    render(
      <DataVaultForm
        conversationId={CID}
        spec={cloudSpec([{ name: 'password', label: 'Password', type: 'password' }])}
        onAction={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
  });
});

describe('a cloud datasource form', () => {
  it('publishes no snapshot, so its values never reach the conversation', () => {
    render(
      <DataVaultForm
        conversationId={CID}
        spec={cloudSpec([{ name: 'host', label: 'Host', type: 'text', default: 'db.prod.example.com' }])}
        onAction={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Host')).toBeInTheDocument();
    expect(getFormState(CID)).toBeFalsy();
  });

  it('still publishes one for an ordinary connector form', () => {
    const spec = cloudSpec([{ name: 'project', label: 'Project', type: 'text', default: 'acme' }]);
    delete spec._cloud_datasource;
    render(<DataVaultForm conversationId={CID} spec={spec} onAction={vi.fn()} />);

    expect(getFormState(CID)?.fields).toEqual({ project: 'acme' });
  });
});
