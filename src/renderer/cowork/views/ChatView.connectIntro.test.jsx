// Characterization tests for the connect-intro bubble ChatView renders for a
// `connect_intro` message: clicking it (or Enter / Space) re-opens the cached
// connection form, it stops offering that once the form is open, Escape closes
// the form and leaves the bubble able to re-open it, and in modify mode it
// carries Cancel and Disconnect. ConnectIntroBubble is not exported,
// so these go through ChatView like the other ChatView.*.test.jsx files.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

// Opens the form and puts the caret in its first text box, where a user
// pressing Escape would be. (Initial focus lands on the X, whose Base UI
// tooltip trigger keeps Escape from the dialog under happy-dom only;
// Chromium closes from there too.)
const openedDialog = async (user) => {
  const dialog = await screen.findByRole('dialog', { name: 'Connection form' });
  await user.click(within(dialog).getAllByRole('textbox')[0]);
  return dialog;
};

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
    expect(screen.queryByRole('button', { name: /re-open the form/, hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('Fill out the form to connect')).toBeInTheDocument();
  });

  // Regression: the form opens as a centred modal, not a side panel.
  it('never says "side panel"', () => {
    render(<ChatView task={taskWith([intro()])} />);
    expect(screen.queryByText(/side panel/i)).not.toBeInTheDocument();
  });

  // Regression: Escape did nothing; the modal stayed over the bubble.
  it('closes the form on Escape, and the bubble can open it again', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} />);

    await user.click(reopenCard());
    await openedDialog(user);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(getForm(TASK_ID)).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reopenCard()).toBeInTheDocument();
  });

  it('hands Escape to the host dismissal when there is one', async () => {
    const user = userEvent.setup();
    const onDismissConnectForm = vi.fn();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} onDismissConnectForm={onDismissConnectForm} />);

    await user.click(reopenCard());
    await openedDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDismissConnectForm).toHaveBeenCalledWith(TASK_ID));
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
    expect(screen.queryByRole('button', { name: /re-open the form/, hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('Fill out the form to connect')).toBeInTheDocument();
  });

  // Regression: the form opens as a centred modal, not a side panel.
  it('never says "side panel"', () => {
    render(<ChatView task={taskWith([intro()])} />);
    expect(screen.queryByText(/side panel/i)).not.toBeInTheDocument();
  });

  // Regression: Escape did nothing; the modal stayed over the bubble.
  it('closes the form on Escape, and the bubble can open it again', async () => {
    const user = userEvent.setup();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} />);

    await user.click(reopenCard());
    await openedDialog(user);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(getForm(TASK_ID)).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(reopenCard()).toBeInTheDocument();
  });

  it('hands Escape to the host dismissal when there is one', async () => {
    const user = userEvent.setup();
    const onDismissConnectForm = vi.fn();
    render(<ChatView task={taskWith([intro({ _form_spec: SPEC })])} onDismissConnectForm={onDismissConnectForm} />);

    await user.click(reopenCard());
    await openedDialog(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDismissConnectForm).toHaveBeenCalledWith(TASK_ID));
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
