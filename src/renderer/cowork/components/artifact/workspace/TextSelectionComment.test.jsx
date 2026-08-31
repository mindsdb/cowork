// The composer disables itself while a submit is in flight, so every exit from
// that submit has to re-enable it. `onCreate` answering false is the ordinary
// failure (the comments hook shows the reason in the panel); a throw is not
// supposed to happen, and precisely because of that it must not be the one path
// that locks the user out of their own draft.
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
    // Still open, still holding the text: a retry is one more click.
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
