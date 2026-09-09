import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GitIdentityCard, looksLikeEmail } from './GitIdentityCard';


describe('looksLikeEmail', () => {
  it('accepts an address and rejects the obviously wrong', () => {
    expect(looksLikeEmail('ian@example.com')).toBe(true);
    expect(looksLikeEmail(' ian@example.com ')).toBe(true);
    expect(looksLikeEmail('ian')).toBe(false);
    expect(looksLikeEmail('@example.com')).toBe(false);
    expect(looksLikeEmail('ian@')).toBe(false);
    expect(looksLikeEmail('ian @example.com')).toBe(false);
  });
});


describe('GitIdentityCard', () => {
  it('prefills the account identity and saves trimmed values, then the commit runs again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => {});
    render(<GitIdentityCard setup={{ name: 'Ian Unsworth', email: 'ian@example.com', onSubmit }} />);

    expect(screen.getByRole('region', { name: 'Git needs to know who you are' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name for Git commits' })).toHaveValue('Ian Unsworth');
    expect(screen.getByRole('textbox', { name: 'Email for Git commits' })).toHaveValue('ian@example.com');

    await user.clear(screen.getByRole('textbox', { name: 'Name for Git commits' }));
    await user.type(screen.getByRole('textbox', { name: 'Name for Git commits' }), '  Ian U ');
    await user.click(screen.getByRole('button', { name: 'Save and commit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Ian U', 'ian@example.com'));
  });

  it('waits for a name and a plausible email before it can save', async () => {
    const user = userEvent.setup();
    render(<GitIdentityCard setup={{ name: '', email: '', onSubmit: vi.fn(async () => {}) }} />);

    const save = screen.getByRole('button', { name: 'Save and commit' });
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Name for Git commits' }), 'Ian');
    await user.type(screen.getByRole('textbox', { name: 'Email for Git commits' }), 'ian');
    expect(save).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Email for Git commits' }), '@example.com');
    expect(save).toBeEnabled();
  });

  it('shows what went wrong and lets the user try again', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => { throw new Error('Git could not run'); });
    render(<GitIdentityCard setup={{ name: 'Ian', email: 'ian@example.com', onSubmit }} />);

    await user.click(screen.getByRole('button', { name: 'Save and commit' }));

    expect(await screen.findByText('Git could not run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and commit' })).toBeEnabled();
  });
});
