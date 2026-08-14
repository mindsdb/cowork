import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';

const CID = 'conv-datavault-user-label';

describe('DataVaultFormPanel — user_label', () => {
  beforeEach(() => {
    clearForm(CID);
  });

  it('includes user_label in submitted values', async () => {
    setForm(CID, { form_id: 'f1', fields: [] });
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/label/i), 'prod-db');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ user_label: 'prod-db' }) })
    );
  });

  it('pre-fills the label from spec.user_label for a modify-flow spec', () => {
    setForm(CID, { form_id: 'f2', fields: [], user_label: 'Support', _existing_name: 'acct1' });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/label/i)).toHaveValue('Support');
  });

  it('blocks submission and marks whitespace-only required fields inline', async () => {
    setForm(CID, {
      form_id: 'f3',
      fields: [{ name: 'project_id', label: 'Project ID', type: 'text', required: true }],
    });
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getAllByRole('textbox')[1], ' ');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Project ID is required.')).toBeInTheDocument();
  });

  it('allows explicitly skipped required fields through', async () => {
    setForm(CID, {
      form_id: 'f4',
      fields: [{ name: 'project_id', label: 'Project ID', type: 'text', required: true }],
    });
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'skip' }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skipped: ['project_id'] }));
  });
});
