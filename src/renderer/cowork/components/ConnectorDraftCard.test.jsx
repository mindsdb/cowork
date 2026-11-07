import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  saveConnectorDraft: vi.fn(),
  fetchConnectorDraftSaved: vi.fn(),
}));
vi.mock('../api', () => api);

import ConnectorDraftCard from './ConnectorDraftCard';
import drafted from '../lib/__fixtures__/connectorDrafted.json';

const connector = drafted.connector;

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchConnectorDraftSaved.mockResolvedValue(false);
  api.saveConnectorDraft.mockResolvedValue({});
});

describe('ConnectorDraftCard', () => {
  it('saves the template as sent and points to Connect Apps and Data', async () => {
    render(<ConnectorDraftCard connector={connector} />);
    expect(screen.getByText('Connector template · not saved')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Save connector' }));

    expect(api.saveConnectorDraft).toHaveBeenCalledWith(connector);
    expect(await screen.findByText('Saved. Add your credentials in Connect Apps and Data.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Saved' }).disabled).toBe(true);
  });

  it('shows the server refusal and lets the member try again', async () => {
    api.saveConnectorDraft.mockRejectedValue(new Error('label looks like it holds a credential value.'));
    render(<ConnectorDraftCard connector={connector} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save connector' }));

    expect(await screen.findByText('label looks like it holds a credential value.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save connector' }).disabled).toBe(false);
  });

  it('shows saved on reload when the member already keeps it', async () => {
    api.fetchConnectorDraftSaved.mockResolvedValue(true);
    render(<ConnectorDraftCard connector={connector} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved' }).disabled).toBe(true));
    expect(api.fetchConnectorDraftSaved).toHaveBeenCalledWith('acme_crm');
  });

  it('shows every model-written text as plain text, the help address not as a link', async () => {
    const marked = {
      ...connector,
      label: '**Acme** [crm](https://evil.example)',
      usage_notes: '<img src=x onerror=alert(1)> **bold**',
    };
    render(<ConnectorDraftCard connector={marked} />);
    await userEvent.click(screen.getByText(marked.label));

    expect(screen.getAllByText(marked.label).length).toBeGreaterThan(0);
    expect(screen.getByText(marked.usage_notes)).toBeTruthy();
    expect(screen.getByText(`Where to find them: ${connector.help_url}`)).toBeTruthy();
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});
