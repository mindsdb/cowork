import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../lib/skillsStore', () => ({ useSkillNames: () => new Set() }));

import { MarkdownContent } from './MarkdownContent';
import { MarkdownCode } from './MarkdownCode';
import { clearForm, getForm, setForm } from '../datavault/formStore';

// ```chartjs and ```chart used to have their own renderers. Both are gone:
// old assistant messages that still carry these fences must render as
// ordinary code blocks, with the config text readable and copyable.
describe('MarkdownCode retired chart fences', () => {
  const CASES = [
    ['chartjs', "{ type: 'bar', data: { labels: ['a'], datasets: [{ data: [1] }] } }"],
    ['chart', '{"type":"bar","x":"month","y":"revenue"}'],
  ];

  it.each(CASES)('renders an assistant ```%s fence as a plain code block', (lang, body) => {
    const { container } = render(
      <MarkdownContent text={`Here it is:\n\n\`\`\`${lang}\n${body}\n\`\`\``} complete isAssistant />,
    );
    const block = container.querySelector('.anton-code-block');
    expect(block).not.toBeNull();
    const code = block.querySelector('code');
    expect(code.textContent).toBe(body);
    expect(code.getAttribute('data-source')).toBe(body);
    expect(block.querySelector('[data-copy-code]')).not.toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.textContent).not.toMatch(/ERROR:/);
  });

  it('renders a still-streaming ```chartjs fence as a code block, not a spinner', () => {
    const body = "{ type: 'line' }";
    const { container } = render(
      <MarkdownContent text={`\`\`\`chartjs\n${body}\n\`\`\``} complete={false} isAssistant />,
    );
    expect(container.querySelector('.anton-code-block code').textContent).toBe(body);
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});

// A ```data-vault-form fence draws a ChatCardShell card that opens the form,
// in place of the old hand-rolled pointer that sent the user to a "side panel"
// the app never had (the form is a centred modal).
describe('MarkdownCode data-vault-form card', () => {
  const CID = 'conv-form-card';
  const SPEC = { form_id: 'connect-pg', title: 'Connect PostgreSQL', subtitle: 'Read-only access.', fields: [] };
  const fence = (body) => <MarkdownCode className="language-data-vault-form" conversationId={CID} complete>{body}</MarkdownCode>;

  afterEach(() => clearForm(CID));

  it('shows the form title and subtitle on a connection card with Open form', () => {
    const { container } = render(fence(JSON.stringify(SPEC)));
    expect(container.querySelector('.chat-card-shell')).not.toBeNull();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Connect PostgreSQL')).toBeInTheDocument();
    expect(screen.getByText('Read-only access.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open form' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/side panel/i);
  });

  it('opens a closed form, and leaves an open one alone', async () => {
    const user = userEvent.setup();
    render(fence(JSON.stringify(SPEC)));
    // Mounted complete = a historical message, so nothing opened on its own.
    expect(getForm(CID)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open form' }));
    expect(getForm(CID)).toEqual(SPEC);

    const typed = { ...SPEC, user_label: 'typed by the user' };
    setForm(CID, typed);
    await user.click(screen.getByRole('button', { name: 'Open form' }));
    expect(getForm(CID)).toBe(typed);
  });

  it('shows a placeholder card while the fence streams', () => {
    render(<MarkdownCode className="language-data-vault-form" conversationId={CID} complete={false}>{'{"title":'}</MarkdownCode>);
    expect(screen.getByText('Preparing form…')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a failed card for a fence that does not parse, without "side panel"', () => {
    const { container } = render(fence('{ "title": "Connect PostgreSQL", '));
    const card = container.querySelector('.chat-card-shell');
    expect(card.getAttribute('data-state')).toBe('failed');
    expect(screen.getByText('Form did not parse')).toBeInTheDocument();
    expect(screen.getByText(/Ask the agent to send the form again/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/side panel/i);
  });
});
