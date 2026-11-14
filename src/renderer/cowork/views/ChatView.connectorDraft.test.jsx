// A connector template a cloud turn built shows as a card under the answer,
// live and after a reload.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

import ChatView from './ChatView';
import { hydrateMessagesFromServerEvents } from '../lib/conversationHistory';
import drafted from '../lib/__fixtures__/connectorDrafted.json';

const taskWith = (messages) => ({ id: 'conv-a', title: 'Alpha task', status: 'active', messages });

describe('connector template card under the answer', () => {
  it('shows the card after a reload from the saved events', () => {
    const messages = hydrateMessagesFromServerEvents([
      { role: 'user', content: 'connect our Acme CRM' },
      {
        role: 'assistant',
        content: 'I built the template.',
        events: [{ type: 'response.created' }, drafted, { type: 'response.completed', response: {} }],
      },
    ]);
    render(<ChatView task={taskWith(messages)} />);

    expect(screen.getByText('Acme CRM')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save connector' })).toBeInTheDocument();
  });
});
