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
    '%s directs the tester to the operator without settings or credit offers', (code) => {
      const onOpenSettings = vi.fn();
      const { container } = render(
        <ChatView task={taskWith(code, { failedModel: 'sonnet' })} onOpenSettings={onOpenSettings} />,
      );
      expect(screen.getByText(code === 'model_restricted'
        ? 'Sonnet is restricted' : "Sonnet isn't available right now")).toBeInTheDocument();
      expect(screen.getByText('Ask your operator to check the configured model and its access.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
      expect(onOpenSettings).not.toHaveBeenCalled();
      expect(container).not.toHaveTextContent(/MindsHub|credits|top up|billing/i);
    },
  );

  it.each([
    ['model_not_found', 'removed-model'],
    ['model_not_found', null],
    ['unknown_model', 'removed-model'],
    ['unknown_model', null],
  ])('%s names the operator when the failed model is %s', (code, failedModel) => {
    const onOpenSettings = vi.fn();
    const { container } = render(<ChatView task={taskWith(code, { failedModel })} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(failedModel ? `"${failedModel}" isn't a model we can use` : "That model isn't available")).toBeInTheDocument();
    expect(screen.getByText('The provider cannot serve the configured model. Ask your operator to check the model configuration.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(container).not.toHaveTextContent(/Pick a model|Switch to another model|Your settings point/i);
  });

  it.each([
    ['with a message to retry', true],
    ['with nothing to retry', false],
  ])('model_timeout names the operator %s without offering settings', (_label, canRetry) => {
    const onSend = vi.fn();
    const onOpenSettings = vi.fn();
    const task = taskWith('model_timeout');
    if (!canRetry) task.messages = task.messages.filter((message) => message.role !== 'user');
    const { container } = render(<ChatView task={task} onSend={onSend} onOpenSettings={onOpenSettings} />);
    const title = screen.getByText("The model didn't respond");
    const card = within(title.parentElement);
    expect(card.getByText('The model stopped sending anything, so this turn was ended. Try again. If it keeps happening, ask your operator to check the model configuration.')).toBeInTheDocument();
    expect(card.queryAllByRole('button').map((button) => button.textContent)).toEqual(canRetry ? ['Try again'] : []);
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(container).not.toHaveTextContent(/pick another model in Settings/i);
    if (canRetry) {
      fireEvent.click(card.getByRole('button', { name: 'Try again' }));
      expect(onSend).toHaveBeenCalledWith('Summarize sales', attachments);
    } else {
      expect(onSend).not.toHaveBeenCalled();
    }
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

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

  it.each([true, false])('names the operator when provider credentials fail and reconnectable is %s', (reconnectable) => {
    const onOpenSettings = vi.fn();
    const { container } = render(
      <ChatView task={taskWith('provider_auth', { reconnectable })} onOpenSettings={onOpenSettings} />,
    );
    expect(screen.getByText('The provider could not authenticate')).toBeInTheDocument();
    expect(screen.getByText('The model provider rejected its credentials. Ask your operator to check the provider configuration.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(container).not.toHaveTextContent(/MindsHub|sign in again|Reconnect to continue|Update your API key|Update it in Settings/i);
    expect(hostMock.host.mindshubFinalize).not.toHaveBeenCalled();
    expect(hostMock.host.mindshubLogin).not.toHaveBeenCalled();
  });

  it('asks the operator to configure a missing provider without settings or signup offers', () => {
    const onOpenSettings = vi.fn();
    render(<ChatView task={{ id: 'task-1', messages: [{ role: 'provider_required' }] }} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText('Provider setup is required')).toBeInTheDocument();
    expect(screen.getByText('Ask your operator to configure the model provider before starting a task.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start for free' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
    expect(onOpenSettings).not.toHaveBeenCalled();
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
