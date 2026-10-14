import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));
const hostMock = vi.hoisted(() => ({
  host: {
    isElectron: false,
    isMac: () => false,
    getApiOrigin: () => 'http://localhost:1',
    isLocalApiOrigin: () => false,
    openExternal: vi.fn(),
    mindshubFinalize: vi.fn(),
    mindshubLogin: vi.fn(),
  },
  getAccessToken: vi.fn(async () => null),
  isElectron: false,
  isWeb: true,
}));
vi.mock('../../platform/host', () => hostMock);

import ChatView from './ChatView';

const attachments = [{ id: 'file-1', name: 'sales.csv' }];
const taskWith = (code, extra = {}) => ({
  id: 'task-1', title: 'Quarterly report', status: 'idle',
  messages: [
    { role: 'user', content: 'Summarize sales', attachments },
    { role: 'error', code, content: 'MindsHub billing message', ...extra },
  ],
});

beforeEach(() => vi.clearAllMocks());

describe('ChatView with platform UI disabled', () => {
  it.each(['token_limit', 'included_allowance_exhausted', 'free_serving_paused'])(
    'keeps a useful failure for %s without a billing offer', (code) => {
      const { container } = render(<ChatView task={taskWith(code)} />);
      expect(screen.getByText(code === 'free_serving_paused'
        ? 'The provider is temporarily unavailable' : 'Task stopped')).toBeInTheDocument();
      expect(screen.getByText(/contact your administrator/i)).toBeInTheDocument();
      expect(container).not.toHaveTextContent(/MindsHub|credits|billing|allowance|add funds|top up/i);
      expect(hostMock.host.openExternal).not.toHaveBeenCalled();
    },
  );

  it.each(['model_access_denied', 'model_disabled', 'model_restricted'])(
    '%s retains the settings action without a credit offer', (code) => {
      const onOpenSettings = vi.fn();
      const { container } = render(
        <ChatView task={taskWith(code, { failedModel: 'sonnet' })} onOpenSettings={onOpenSettings} />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
      expect(onOpenSettings).toHaveBeenCalledWith('agent');
      expect(container).not.toHaveTextContent(/MindsHub|credits|top up|billing/i);
    },
  );

  it.each([
    ['provider_overloaded', false],
    ['provider_overloaded', true],
    ['policy_unavailable', true],
  ])('%s retains retry when reconnectable is %s', (code, reconnectable) => {
    const onSend = vi.fn();
    const { container } = render(<ChatView task={taskWith(code, { reconnectable })} onSend={onSend} />);
    const title = screen.getByText(code === 'provider_overloaded'
      ? 'The model provider is having a temporary issue' : 'The provider is temporarily unavailable');
    const card = within(title.parentElement);
    expect(card.getAllByRole('button').map((button) => button.textContent)).toEqual(['Try again']);
    fireEvent.click(card.getByRole('button', { name: 'Try again' }));
    expect(onSend).toHaveBeenCalledWith('Summarize sales', attachments);
    expect(container).not.toHaveTextContent(/MindsHub|billing|set up MindsHub/i);
  });

  it('offers provider configuration without platform sign-in when credentials fail', () => {
    const onOpenSettings = vi.fn();
    const { container } = render(
      <ChatView task={taskWith('provider_auth', { reconnectable: true })} onOpenSettings={onOpenSettings} />,
    );
    expect(screen.getByText('Update your API key')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
    expect(container).not.toHaveTextContent(/MindsHub|sign in again|Reconnect to continue/i);
    expect(hostMock.host.mindshubFinalize).not.toHaveBeenCalled();
    expect(hostMock.host.mindshubLogin).not.toHaveBeenCalled();
  });

  it('offers settings for a missing provider without the free signup offer', () => {
    const onOpenSettings = vi.fn();
    render(<ChatView task={{ id: 'task-1', messages: [{ role: 'provider_required' }] }} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/Add an API key or configure an endpoint in Settings/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start for free' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledWith('agent');
    expect(hostMock.host.openExternal).not.toHaveBeenCalled();
  });

  it('does not restore billing notices from a saved conversation', () => {
    const { container } = render(<ChatView task={{
      id: 'task-1', title: 'Report', status: 'idle',
      messages: [
        { role: 'user', id: 'u1', content: 'Summarize sales' },
        { role: 'assistant', content: 'Here is the report.' },
      ],
      usageNotices: ['free_low', 'free_used', 'auto_top_up_failed'].map((kind) => ({ kind, anchorId: 'u1' })),
    }} />);
    expect(screen.getByText('Here is the report.')).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/allowance|top up|View usage|funds/i);
  });
});
