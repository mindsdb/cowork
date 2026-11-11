import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { browserInsteadRequest, connectorWebsite } from '../../lib/connectorWebsites';

const CID = 'conv-browser-instead';
const methods = [
  { id: 'browser_oauth_builtin', label: 'Sign in with Google', recommended: true, fields: [] },
  { id: 'app_password', label: 'App password', fields: [{ name: 'password', label: 'Password', type: 'password' }] },
];

describe('the connect form offers the browser instead', () => {
  beforeEach(() => clearForm(CID));

  it("among the ways to connect a service with a website, saying what it means", async () => {
    setForm(CID, { form_id: 'f1', engine: 'gmail', title: 'Connect Gmail', methods });
    const onUseBrowser = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onUseBrowser={onUseBrowser} />);

    await userEvent.setup().click(screen.getByRole('button', { name: /Use the browser instead/ }));

    expect(onUseBrowser).toHaveBeenCalledWith({ name: 'Gmail', url: 'https://mail.google.com' });
  });

  it('under a single-method form too', () => {
    setForm(CID, { form_id: 'f2', engine: 'notion', title: 'Connect Notion', fields: [] });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onUseBrowser={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Use the browser instead/ })).toBeInTheDocument();
  });

  it('not for a service with no website everyone shares, or where the browser cannot be used', () => {
    setForm(CID, { form_id: 'f3', engine: 'postgres', title: 'Connect PostgreSQL', fields: [] });
    const { unmount } = render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} onUseBrowser={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Use the browser instead/ })).not.toBeInTheDocument();
    unmount();

    setForm(CID, { form_id: 'f4', engine: 'gmail', title: 'Connect Gmail', methods });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Use the browser instead/ })).not.toBeInTheDocument();
  });

  it('asks the agent to work on the website', () => {
    expect(connectorWebsite('jira')).toBeNull();
    expect(connectorWebsite('toString')).toBeNull();
    expect(browserInsteadRequest('Gmail', 'https://mail.google.com')).toBe(
      "Don't connect Gmail. Use Gmail's website in the browser instead (https://mail.google.com). If it asks me to sign in, hand the browser to me.",
    );
  });
});
