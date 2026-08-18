import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('skipping a field after a required error clears the error and allows submission', async () => {
    setForm(CID, {
      form_id: 'f4',
      fields: [{ name: 'project_id', label: 'Project ID', type: 'text', required: true }],
    });
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    // Trip the required error first — without the check in place this
    // submit would already succeed, so the assertion below only holds
    // with the new validation.
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Project ID is required.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'skip' }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ skipped: ['project_id'] }));
    expect(screen.queryByText('Project ID is required.')).not.toBeInTheDocument();
  });

  it('clears a required error from one method when the user switches to another', async () => {
    setForm(CID, {
      form_id: 'f5',
      methods: [
        { id: 'method_a', label: 'Method A', fields: [{ name: 'field_a', label: 'Field A', type: 'text', required: true }] },
        { id: 'method_b', label: 'Method B', fields: [{ name: 'field_b', label: 'Field B', type: 'text', required: true }] },
      ],
    });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /method a/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(screen.getByText('Field A is required.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to options/i }));
    await user.click(screen.getByRole('button', { name: /method b/i }));

    expect(screen.queryByText('Field A is required.')).not.toBeInTheDocument();
  });

  it('focuses the offending field even when it is a select, which takes no input ref', async () => {
    setForm(CID, {
      form_id: 'f6',
      fields: [{
        name: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        options: [{ value: 'us', label: 'US' }],
      }],
    });
    render(<DataVaultFormPanel conversationId={CID} onSubmit={vi.fn()} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /submit/i }));

    const error = await screen.findByText('Region is required.');
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement.contains(error)).toBe(true);
    });
  });
});
