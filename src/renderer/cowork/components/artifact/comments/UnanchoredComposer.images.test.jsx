// Images pasted into the inbox's comment composer (ENG-4410).
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { UnanchoredComposer } from './UnanchoredComposer';

beforeAll(() => {
  URL.createObjectURL ||= () => 'blob:thumb';
  URL.revokeObjectURL ||= () => {};
});

function paste(target, files) {
  fireEvent.paste(target, {
    clipboardData: {
      files,
      items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      types: ['Files'],
      getData: () => '',
    },
  });
}

describe('UnanchoredComposer images', () => {
  it('attaches a pasted image and posts it, with no words needed', async () => {
    const onCreate = vi.fn(async () => true);
    render(<UnanchoredComposer onCreate={onCreate} />);
    const box = screen.getByRole('textbox');
    const shot = new File(['png'], 'shot.png', { type: 'image/png' });

    paste(box, [shot]);
    expect(await screen.findByRole('button', { name: 'Remove attachment' })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ selector: null, text: '' }));
    const [{ images }] = onCreate.mock.calls[0];
    expect(images).toHaveLength(1);
    expect(images[0].type).toBe('image/png');
    expect(screen.queryByRole('button', { name: 'Remove attachment' })).toBeNull();
  });

  it('says why a pasted file was left out', async () => {
    render(<UnanchoredComposer onCreate={vi.fn()} />);

    paste(screen.getByRole('textbox'), [new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Only PNG, JPEG, GIF and WebP images can be attached.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
