import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchSubmissionReplaces = vi.fn();
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchSubmissionReplaces: (...args) => fetchSubmissionReplaces(...args),
}));

const { DataVaultFormPanel } = await import('./DataVaultFormPanel');
const { clearForm, setForm } = await import('./formStore');

const CID = 'conv-datavault-replace';
const ROAM_FORM = { form_id: 'roam_research-connector', _connector_id: 'roam_research', title: 'Connect Roam Research', fields: [] };

async function submit(onSubmit, spec = ROAM_FORM) {
  setForm(CID, spec);
  render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /submit/i }));
  return user;
}

describe('DataVaultFormPanel — replacing a saved connection', () => {
  beforeEach(() => {
    clearForm(CID);
    fetchSubmissionReplaces.mockReset();
  });

  it('asks before a new connection overwrites a saved one, and replaces it only on Replace', async () => {
    fetchSubmissionReplaces.mockResolvedValue({ name: 'mindshub_test', label: 'Team graph' });
    const onSubmit = vi.fn();

    const user = await submit(onSubmit);

    expect(await screen.findByText(/already exists \(“Team graph”\)/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'mindshub_test' }));
    expect(fetchSubmissionReplaces).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it('Cancel keeps the saved connection: nothing is submitted', async () => {
    fetchSubmissionReplaces.mockResolvedValue({ name: 'mindshub_test', label: '' });
    const onSubmit = vi.fn();

    const user = await submit(onSubmit);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a new connection without asking when nothing would be replaced', async () => {
    fetchSubmissionReplaces.mockResolvedValue(null);
    const onSubmit = vi.fn();

    await submit(onSubmit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '' })));
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
  });

  it('does not ask when editing a connection, which targets it by name', async () => {
    const onSubmit = vi.fn();

    await submit(onSubmit, { ...ROAM_FORM, _existing_name: 'mindshub_test' });

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'mindshub_test' })));
    expect(fetchSubmissionReplaces).not.toHaveBeenCalled();
  });

  it('still submits when the check itself fails', async () => {
    fetchSubmissionReplaces.mockRejectedValue(new Error('network down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSubmit = vi.fn();

    await submit(onSubmit);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: '' })));
    warn.mockRestore();
  });
});
