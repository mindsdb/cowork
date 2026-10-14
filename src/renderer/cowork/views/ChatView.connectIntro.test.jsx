// Characterization tests for the connect-intro bubble ChatView renders for a
// `connect_intro` message: clicking it (or Enter / Space) re-opens the cached
// connection form, it stops offering that once the form is open, and in modify
// mode it carries Cancel and Disconnect. ConnectIntroBubble is not exported,
// so these go through ChatView like the other ChatView.*.test.jsx files.
import { describe, it, expect, vi, afterEach } from 'vitest';
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

import ChatView from './ChatView';
import { clearForm, getForm } from '../components/datavault/formStore';

const TASK_ID = 'conv-connect';
const SPEC = {
  form_id: 'form-pg',
  title: 'Connect PostgreSQL',
  fields: [{ name: 'host', label: 'Host', type: 'text' }],
};

const intro = (extra = {}) => ({
  role: 'assistant',
  _kind: 'connect_intro',
  connector: { id: 'postgres', label: 'PostgreSQL', logo: 'database' },
  content: 'Connect PostgreSQL',
  _client_only: true,
  ...extra,
});

const taskWith = (messages) => ({ id: TASK_ID, title: 'Connect task', status: 'idle', messages });

// The card is named by what it reads: its title plus the re-open prompt.
const reopenCard = () => screen.getByRole('button', { name: /Connect PostgreSQL.*re-open the form/ });

afterEach(() => {
  clearForm(TASK_ID);
});

describe('ConnectIntroBubble (via ChatView)', () => {
  it('re-opens the cached form on click, then stops offering to', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} />);

    expect(getForm(TASK_ID)).toBeNull();
    await user.click(reopenCard());
    expect(getForm(TASK_ID)).toEqual(SPEC);

    // With the form open there is nothing to re-open: the card goes inert.
    expect(screen.queryByRole('button', { name: /re-open the form/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Fill out the form on the side panel/)).toBeInTheDocument();
  });

  it.each([['Enter', '{Enter}'], ['Space', ' ']])('re-opens the form from the keyboard with %s', async (_, key) => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} />);

    reopenCard().focus();
    await user.keyboard(key);
    expect(getForm(TASK_ID)).toEqual(SPEC);
  });

  it('is not interactive when no form spec was cached', () => {
    render(<ChatView task={taskWith([intro()])} />);
    expect(screen.getByText('Connect PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /re-open the form/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Fill out the form on the side panel/)).toBeInTheDocument();
  });

  it('has no Cancel or Disconnect outside modify mode', () => {
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} onCancelModify={vi.fn()} onDisconnectModify={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });

  it('in modify mode, Cancel and Disconnect call back with the task and connection', async () => {
    const user = userEvent.setup();
    const onCancelModify = vi.fn();
    const onDisconnectModify = vi.fn();
    const modify = intro({
      content: 'Modify prod-db',
      _modify: true,
      _engine: 'postgres',
      _existing_name: 'prod-db',
    });
    render(
      <ChatView
        task={taskWith([modify])}
        onCancelModify={onCancelModify}
        onDisconnectModify={onDisconnectModify}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelModify).toHaveBeenCalledWith(TASK_ID);
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnectModify).toHaveBeenCalledWith(TASK_ID, 'postgres', 'prod-db');
  });

  it('in modify mode without a known connection, offers Cancel but not Disconnect', () => {
    render(
      <ChatView
        task={taskWith([intro({ content: 'Modify prod-db', _modify: true })])}
        onCancelModify={vi.fn()}
        onDisconnectModify={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  });
});
