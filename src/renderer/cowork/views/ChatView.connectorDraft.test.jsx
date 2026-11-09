// A connector template a cloud turn built shows as a card under the answer,
// live and after a reload.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../platform/host', () => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
}));

const api = vi.hoisted(() => ({
  saveConnectorDraft: vi.fn(async () => ({})),
  fetchConnectorDraftSaved: vi.fn(async () => false),
}));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), ...api }));

import ChatView from './ChatView';
import { hydrateMessagesFromServerEvents } from '../lib/conversationHistory';
import drafted from '../lib/__fixtures__/connectorDrafted.json';

const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });

function reloadedMessages() {
  return hydrateMessagesFromServerEvents([
    { role: 'user', content: 'connect our Acme CRM' },
    {
      role: 'assistant',
      content: 'I built the template.',
      events: [{ type: 'response.created' }, drafted, { type: 'response.completed', response: {} }],
    },
  ]);
}

describe('connector template card under the answer', () => {
  it('shows the card after a reload from the saved events', () => {
    render(<ChatView task={taskWith(reloadedMessages())} />);

    expect(screen.getByText('Acme CRM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save connector' })).toBeInTheDocument();
  });

  it("hands the saved connector to the host's connect handler", async () => {
    const onConnectCustomConnector = vi.fn();
    render(<ChatView task={taskWith(reloadedMessages())} onConnectCustomConnector={onConnectCustomConnector} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save connector' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));

    expect(onConnectCustomConnector).toHaveBeenCalledWith({ id: 'acme_crm', label: 'Acme CRM' });
  });
});
