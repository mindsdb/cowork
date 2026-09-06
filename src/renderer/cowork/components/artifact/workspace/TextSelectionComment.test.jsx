// Both false returns and thrown submit failures must re-enable the composer without losing its
// draft.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TextSelectionComment } from './TextSelectionComment';

const SELECTION = { quote: 'the third paragraph', start: 10, end: 29 };

const type = async (user, value) => {
  await user.type(screen.getByRole('textbox', { name: 'Comment on selected text' }), value);
};

describe('TextSelectionComment', () => {
  it('keeps the draft and the button usable when onCreate rejects', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockRejectedValue(new Error('boom'));
    const onCancel = vi.fn();
    render(<TextSelectionComment selection={SELECTION} onCreate={onCreate} onCancel={onCancel} />);

    await type(user, 'tighten this');
    await user.click(screen.getByRole('button', { name: /Comment/ }));

    await waitFor(() => expect(screen.getByRole('button', { name: /Comment/ })).toBeEnabled());
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Comment on selected text' })).toHaveValue('tighten this');
  });

  it('closes only once the comment is actually created', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onCancel = vi.fn();
    render(<TextSelectionComment selection={SELECTION} onCreate={onCreate} onCancel={onCancel} />);

    await type(user, 'tighten this');
    await user.click(screen.getByRole('button', { name: /Comment/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Comment/ })).toBeEnabled());
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Comment/ }));

    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenNthCalledWith(2, {
      selector: JSON.stringify(SELECTION),
      text: 'tighten this',
      kind: 'review',
    });
  });
});
